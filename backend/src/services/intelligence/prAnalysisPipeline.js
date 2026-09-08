/**
 * Pull Request Analysis Pipeline Service
 * Orchestrates the analysis lifecycle (queued -> running -> completed / failed),
 * executes the deterministic PR risk engine, and ensures idempotent execution.
 */

import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';
import { analyzePullRequest } from './prRiskEngine.js';
import { defaultStorageProvider } from '../ingestion/storage/LocalStorageProvider.js';
import { extractRelationships } from './relationshipExtractor.js';
import { dispatchAndParseFile } from './dispatcher.js';

export const prAnalysisPipeline = {
  /**
   * Orchestrates the complete PR analysis pipeline with lifecycle state management.
   *
   * @param {Object} params
   * @param {string} params.pullRequestId - UUID of pull_requests
   * @param {string} params.commitSha - Head commit SHA
   * @param {string} [params.baseSnapshotId] - Base snapshot UUID if available
   * @param {string} [params.diffText] - Unified diff text
   * @param {Array<Object>} [params.baseFiles] - Base snapshot files
   * @param {Array<Object>} [params.headFiles] - Head snapshot files
   * @param {Array<Object>} [params.relationships] - Dependency relationships
   * @param {number} [params.maxDepth=3] - Graph traversal depth
   * @param {boolean} [params.forceReanalyze=false] - Skip idempotency check
   * @param {Object} [params.storageProvider] - Storage provider instance
   * @returns {Promise<Object>} Completed analysis summary
   */
  async runAnalysis({
    pullRequestId,
    commitSha,
    baseSnapshotId = null,
    diffText = '',
    baseFiles = [],
    headFiles = [],
    relationships = [],
    maxDepth = 3,
    forceReanalyze = false,
    storageProvider = defaultStorageProvider
  }) {
    if (!pullRequestId || !commitSha) {
      throw new Error('pullRequestId and commitSha are required for PR analysis');
    }

    // 1. Idempotency Check: Return existing completed analysis if identical commit analyzed
    if (!forceReanalyze) {
      const { rows: existing } = await pool.query(
        `SELECT id, status, risk_score, risk_category, quality_gate, summary, completed_at
         FROM pull_request_analyses
         WHERE pull_request_id = $1 AND commit_sha = $2 AND status = 'completed'
         ORDER BY completed_at DESC
         LIMIT 1`,
        [pullRequestId, commitSha]
      );

      if (existing.length > 0) {
        logger.info({ pullRequestId, commitSha, analysisId: existing[0].id }, 'Reusing existing completed PR analysis (idempotent)');
        return {
          id: existing[0].id,
          pullRequestId,
          commitSha,
          status: 'completed',
          riskScore: existing[0].risk_score,
          riskCategory: existing[0].risk_category,
          qualityGate: existing[0].quality_gate,
          summary: existing[0].summary,
          reused: true
        };
      }
    }

    // 2. Lifecycle: Insert in 'queued' status
    const { rows: queuedRows } = await pool.query(
      `INSERT INTO pull_request_analyses (
         pull_request_id, base_snapshot_id, commit_sha, status, created_at
       ) VALUES ($1, $2, $3, 'queued', NOW())
       RETURNING id`,
      [pullRequestId, baseSnapshotId, commitSha]
    );

    const analysisId = queuedRows[0].id;
    logger.info({ analysisId, pullRequestId, commitSha }, 'PR analysis queued');

    // 3. Lifecycle: Transition to 'running'
    await pool.query(
      `UPDATE pull_request_analyses SET status = 'running' WHERE id = $1`,
      [analysisId]
    );
    logger.info({ analysisId }, 'PR analysis running');

    try {
      // 4. Resolve Base and Head files if not provided
      let resolvedBaseFiles = [...baseFiles];
      let resolvedHeadFiles = [...headFiles];
      let resolvedRelationships = [...relationships];

      if (baseSnapshotId && resolvedBaseFiles.length === 0) {
        try {
          const snapshotPayload = await storageProvider.getSnapshot(baseSnapshotId);
          if (Array.isArray(snapshotPayload?.files)) {
            resolvedBaseFiles = snapshotPayload.files.map(f => ({
              filePath: f.path || f.filePath,
              content: f.content || '',
              language: f.language || ''
            }));
          }
        } catch (err) {
          logger.warn({ baseSnapshotId, err: err.message }, 'Failed to load base snapshot files from storage');
        }
      }

      // If relationships not provided, query from database or extract from base files
      if (resolvedRelationships.length === 0 && baseSnapshotId) {
        const { rows: relRows } = await pool.query(
          `SELECT 
             r.source_file_path AS "sourceFilePath",
             r.target_file_path AS "targetFilePath",
             r.relationship_type AS "relationshipType",
             r.symbols_imported AS "symbolsImported"
           FROM relationships r
           JOIN analysis_runs ar ON r.analysis_run_id = ar.id
           WHERE ar.snapshot_id = $1
           LIMIT 1000`,
          [baseSnapshotId]
        );
        resolvedRelationships = relRows;
      }

      if (resolvedRelationships.length === 0 && resolvedBaseFiles.length > 0) {
        const parsedBase = resolvedBaseFiles.map(f => dispatchAndParseFile({ path: f.filePath, content: f.content, language: f.language }));
        const allSyms = parsedBase.flatMap(p => p.symbols || []);
        const relExtract = extractRelationships(parsedBase, allSyms);
        resolvedRelationships = relExtract.relationships || [];
      }

      // 5. Run PR Risk Engine
      const analysisResult = analyzePullRequest({
        diffText,
        baseFiles: resolvedBaseFiles,
        headFiles: resolvedHeadFiles,
        relationships: resolvedRelationships,
        maxDepth
      });

      // 6. Persist results in pull_request_analyses
      await pool.query(
        `UPDATE pull_request_analyses SET
           status = 'completed',
           analysis_version = $2,
           risk_score = $3,
           risk_category = $4,
           quality_gate = $5,
           churn_metrics = $6,
           blast_radius = $7,
           findings = $8,
           summary = $9,
           completed_at = NOW()
         WHERE id = $1`,
        [
          analysisId,
          analysisResult.analysisVersion,
          analysisResult.riskScore,
          analysisResult.riskCategory,
          analysisResult.qualityGate,
          JSON.stringify(analysisResult.churnMetrics || {}),
          JSON.stringify(analysisResult.blastRadius || {}),
          JSON.stringify(analysisResult.findings || []),
          analysisResult.summary
        ]
      );

      // 7. Persist diffs in pull_request_diffs
      const parsedDiff = analysisResult.churnMetrics; // Has file counts
      // Extract files from raw diffText if available
      const parsedDiffObj = analyzePullRequest({ diffText }).changedFiles;
      
      // Persist individual diff records from analysisResult if present
      const filesFromAnalysis = analysisResult.changedFiles || [];
      for (const filePath of filesFromAnalysis) {
        const fileFinding = analysisResult.findings.filter(f => f.filePath === filePath);
        await pool.query(
          `INSERT INTO pull_request_diffs (
             pull_request_id, analysis_id, file_path, change_type,
             additions, deletions, changed_line_ranges, touched_symbols
           ) VALUES (
             $1, $2, $3, 'modified',
             $4, $5, '[]'::jsonb, $6
           )`,
          [
            pullRequestId,
            analysisId,
            filePath,
            0,
            0,
            JSON.stringify(fileFinding)
          ]
        );
      }

      logger.info({ analysisId, riskScore: analysisResult.riskScore, qualityGate: analysisResult.qualityGate }, 'PR analysis completed successfully');

      return {
        id: analysisId,
        pullRequestId,
        commitSha,
        status: 'completed',
        riskScore: analysisResult.riskScore,
        riskCategory: analysisResult.riskCategory,
        qualityGate: analysisResult.qualityGate,
        summary: analysisResult.summary,
        churnMetrics: analysisResult.churnMetrics,
        blastRadius: analysisResult.blastRadius,
        cp7Signals: analysisResult.cp7Signals,
        findings: analysisResult.findings,
        scoreBreakdown: analysisResult.scoreBreakdown,
        decisionReasons: analysisResult.decisionReasons,
        reused: false
      };
    } catch (err) {
      logger.error({ analysisId, err: err.message }, 'PR analysis pipeline execution failed');

      // 8. Lifecycle: Transition to 'failed' with error_message
      await pool.query(
        `UPDATE pull_request_analyses SET
           status = 'failed',
           error_message = $2,
           completed_at = NOW()
         WHERE id = $1`,
        [analysisId, err.message]
      );

      throw err;
    }
  }
};
