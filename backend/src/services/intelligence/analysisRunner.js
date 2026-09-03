import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';
import { defaultStorageProvider } from '../ingestion/storage/LocalStorageProvider.js';
import { dispatchAndParseFile } from './dispatcher.js';
import { extractRelationships } from './relationshipExtractor.js';
import { detectCodeSmells } from './codeSmells.js';
import { extractFeatures, FEATURE_SCHEMA_VERSION } from './featureExtractor.js';

/**
 * Service orchestrating AST code intelligence analysis and ML-ready feature extraction
 */
export const codeIntelligenceService = {
  /**
   * Runs AST analysis on a CP5 repository snapshot
   * @param {Object} params
   * @param {string} params.repositoryId - Repository UUID
   * @param {string} params.snapshotId - Snapshot UUID
   * @param {string} params.userId - Authenticated user UUID
   * @param {boolean} [params.forceReanalyze=false] - Whether to re-run analysis
   * @param {Object} [params.storageProvider] - Storage provider instance
   * @returns {Promise<Object>} Analysis run summary
   */
  async analyzeSnapshot({
    repositoryId,
    snapshotId,
    userId,
    forceReanalyze = false,
    storageProvider = defaultStorageProvider
  }) {
    // 1. Verify repository ownership
    const { rows: repoRows } = await pool.query(
      'SELECT * FROM repositories WHERE id = $1 AND user_id = $2',
      [repositoryId, userId]
    );

    if (repoRows.length === 0) {
      const err = new Error('Repository not found or you do not have permission to access it.');
      err.status = 404;
      throw err;
    }

    const repo = repoRows[0];

    // 2. Verify snapshot belongs to this repository
    const { rows: snapshotRows } = await pool.query(
      'SELECT * FROM repository_snapshots WHERE id = $1 AND repository_id = $2',
      [snapshotId, repositoryId]
    );

    if (snapshotRows.length === 0) {
      const err = new Error('Snapshot not found for this repository.');
      err.status = 404;
      throw err;
    }

    const snapshot = snapshotRows[0];
    if (snapshot.status !== 'completed') {
      const err = new Error(`Cannot analyze snapshot in status '${snapshot.status}'. Snapshot must be 'completed'.`);
      err.status = 400;
      throw err;
    }

    // 3. Idempotency Check: Return existing completed analysis run if available
    if (!forceReanalyze) {
      const { rows: existingRuns } = await pool.query(
        'SELECT * FROM analysis_runs WHERE repository_id = $1 AND snapshot_id = $2 AND status = \'completed\' ORDER BY completed_at DESC LIMIT 1',
        [repositoryId, snapshotId]
      );

      if (existingRuns.length > 0) {
        logger.info(
          { repositoryId, snapshotId, analysisRunId: existingRuns[0].id },
          'Reusing existing completed analysis run (idempotent)'
        );
        return this.getAnalysisRunSummary(existingRuns[0].id, userId, { reused: true });
      }
    }

    // 4. Create analysis run in database
    const { rows: newRunRows } = await pool.query(
      `INSERT INTO analysis_runs (
        repository_id, snapshot_id, commit_sha, status, started_at
      ) VALUES ($1, $2, $3, 'running', NOW())
      RETURNING *`,
      [repositoryId, snapshotId, snapshot.commit_sha]
    );

    const runId = newRunRows[0].id;
    logger.info({ runId, repositoryId, snapshotId }, 'Started AST code intelligence analysis');

    try {
      // 5. Load snapshot payload from storage provider
      const snapshotPayload = await storageProvider.getSnapshot(snapshotId);
      const files = Array.isArray(snapshotPayload.files) ? snapshotPayload.files : [];

      // 6. Dispatch and parse files
      const parsedFiles = [];
      let totalFailed = 0;

      for (const file of files) {
        const parsed = dispatchAndParseFile(file);
        parsedFiles.push(parsed);
        if (parsed.status === 'parse_failed') {
          totalFailed++;
        }
      }

      // 7. Persist analysis_files and symbols in PostgreSQL
      const allSymbols = [];

      for (const file of parsedFiles) {
        const { rows: fileRows } = await pool.query(
          `INSERT INTO analysis_files (
            analysis_run_id, file_path, language, status, line_count, error_message
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id`,
          [
            runId,
            file.filePath,
            file.language,
            file.status,
            file.lineCount,
            file.error || null
          ]
        );

        const fileDbId = fileRows[0].id;

        for (const sym of file.symbols) {
          const { rows: symRows } = await pool.query(
            `INSERT INTO symbols (
              analysis_run_id, file_id, symbol_type, name, file_path, start_line, end_line
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id`,
            [
              runId,
              fileDbId,
              sym.symbolType,
              sym.name,
              sym.filePath,
              sym.startLine || 1,
              sym.endLine || 1
            ]
          );

          allSymbols.push({
            ...sym,
            id: symRows[0].id,
            fileDbId
          });
        }
      }

      // 8. Extract relationships & calculate graph metrics (fan-in, fan-out, circular deps)
      const { relationships, graphMetrics } = extractRelationships(parsedFiles, allSymbols);

      for (const rel of relationships) {
        await pool.query(
          `INSERT INTO relationships (
            analysis_run_id, source_symbol_id, source_file_path, target_symbol_id, target_file_path, relationship_type, symbols_imported
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            runId,
            rel.sourceSymbolId,
            rel.sourceFilePath,
            rel.targetSymbolId,
            rel.targetFilePath,
            rel.relationshipType,
            rel.symbolsImported
          ]
        );
      }

      // 9. Detect deterministic code smells
      const codeSmells = detectCodeSmells(parsedFiles, graphMetrics);

      for (const smell of codeSmells) {
        await pool.query(
          `INSERT INTO code_smells (
            analysis_run_id, rule_id, severity, file_path, symbol_name, line, measured_value, threshold, message
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            runId,
            smell.ruleId,
            smell.severity,
            smell.filePath,
            smell.symbolName,
            smell.line,
            smell.measuredValue,
            smell.threshold,
            smell.message
          ]
        );
      }

      // 10. Compute and persist entity metrics
      for (const file of parsedFiles) {
        for (const [mName, mVal] of Object.entries(file.fileMetrics)) {
          await pool.query(
            `INSERT INTO metrics (
              analysis_run_id, entity_type, entity_id, metric_name, metric_value
            ) VALUES ($1, 'file', $2, $3, $4)`,
            [runId, file.filePath, mName, mVal]
          );
        }

        for (const fn of file.functionMetrics) {
          const fnEntityId = `${file.filePath}::${fn.symbolName}#${fn.startLine}`;
          for (const [mName, mVal] of Object.entries(fn)) {
            if (mName === 'symbolName') continue;
            await pool.query(
              `INSERT INTO metrics (
                analysis_run_id, entity_type, entity_id, metric_name, metric_value
              ) VALUES ($1, 'function', $2, $3, $4)`,
              [runId, fnEntityId, mName, Number(mVal)]
            );
          }
        }
      }

      // 11. Extract and persist ML-ready numerical features
      const features = extractFeatures(parsedFiles, allSymbols, graphMetrics, codeSmells);

      for (const feat of features) {
        await pool.query(
          `INSERT INTO features (
            analysis_run_id, entity_type, entity_id, feature_schema_version, feature_name, feature_value
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            runId,
            feat.entityType,
            feat.entityId,
            feat.featureSchemaVersion || FEATURE_SCHEMA_VERSION,
            feat.featureName,
            feat.featureValue
          ]
        );
      }

      // 12. Complete analysis run in database
      const totalSymbolsCount = allSymbols.length;
      const totalRelsCount = relationships.length;
      const totalSmellsCount = codeSmells.length;

      await pool.query(
        `UPDATE analysis_runs
        SET status = 'completed',
            total_files_analyzed = $1,
            total_files_failed = $2,
            total_symbols = $3,
            total_relationships = $4,
            total_smells = $5,
            completed_at = NOW()
        WHERE id = $6`,
        [
          parsedFiles.length,
          totalFailed,
          totalSymbolsCount,
          totalRelsCount,
          totalSmellsCount,
          runId
        ]
      );

      logger.info(
        {
          runId,
          filesAnalyzed: parsedFiles.length,
          symbols: totalSymbolsCount,
          relationships: totalRelsCount,
          smells: totalSmellsCount
        },
        'Analysis run completed successfully'
      );

      return this.getAnalysisRunSummary(runId, userId, { reused: false });
    } catch (analysisErr) {
      logger.error({ runId, err: analysisErr.message }, 'Analysis run failed');
      await pool.query(
        'UPDATE analysis_runs SET status = \'failed\', error_message = $1, completed_at = NOW() WHERE id = $2',
        [analysisErr.message, runId]
      );
      throw analysisErr;
    }
  },

  /**
   * Retrieves summary details of an analysis run
   */
  async getAnalysisRunSummary(runId, userId, extra = {}) {
    const query = `
      SELECT a.*, r.user_id, s.branch
      FROM analysis_runs a
      JOIN repositories r ON a.repository_id = r.id
      JOIN repository_snapshots s ON a.snapshot_id = s.id
      WHERE a.id = $1 AND r.user_id = $2
    `;

    const { rows } = await pool.query(query, [runId, userId]);
    if (rows.length === 0) {
      const err = new Error('Analysis run not found or access denied.');
      err.status = 404;
      throw err;
    }

    const row = rows[0];

    // Query high-level summary counts and top smells
    const { rows: smellRows } = await pool.query(
      'SELECT rule_id, severity, file_path, symbol_name, line, message FROM code_smells WHERE analysis_run_id = $1 ORDER BY line ASC LIMIT 50',
      [runId]
    );

    return {
      id: row.id,
      repositoryId: row.repository_id,
      snapshotId: row.snapshot_id,
      commitSha: row.commit_sha,
      branch: row.branch,
      status: row.status,
      totalFilesAnalyzed: row.total_files_analyzed,
      totalFilesFailed: row.total_files_failed,
      totalSymbols: row.total_symbols,
      totalRelationships: row.total_relationships,
      totalSmells: row.total_smells,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      codeSmells: smellRows,
      ...extra
    };
  },

  /**
   * Retrieves ML-ready feature dataset for a snapshot analysis
   */
  async getAnalysisFeatures(snapshotId, userId) {
    const query = `
      SELECT f.entity_type, f.entity_id, f.feature_schema_version, f.feature_name, f.feature_value
      FROM features f
      JOIN analysis_runs a ON f.analysis_run_id = a.id
      JOIN repositories r ON a.repository_id = r.id
      WHERE a.snapshot_id = $1 AND r.user_id = $2 AND a.status = 'completed'
      ORDER BY f.entity_type, f.entity_id, f.feature_name
    `;

    const { rows } = await pool.query(query, [snapshotId, userId]);
    if (rows.length === 0) {
      const err = new Error('Completed analysis features not found for this snapshot.');
      err.status = 404;
      throw err;
    }

    // Group features by entity
    const grouped = {};
    for (const r of rows) {
      const key = `${r.entity_type}::${r.entity_id}`;
      if (!grouped[key]) {
        grouped[key] = {
          entityType: r.entity_type,
          entityId: r.entity_id,
          featureSchemaVersion: r.feature_schema_version,
          features: {}
        };
      }
      grouped[key].features[r.feature_name] = r.feature_value;
    }

    return {
      snapshotId,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      totalEntities: Object.keys(grouped).length,
      dataset: Object.values(grouped)
    };
  },

  /**
   * Retrieves dependency and call graph nodes and edges
   */
  async getAnalysisGraph(snapshotId, userId) {
    const query = `
      SELECT r.source_file_path, r.target_file_path, r.relationship_type, r.symbols_imported,
             s1.name as source_symbol_name, s2.name as target_symbol_name
      FROM relationships r
      JOIN analysis_runs a ON r.analysis_run_id = a.id
      JOIN repositories repo ON a.repository_id = repo.id
      LEFT JOIN symbols s1 ON r.source_symbol_id = s1.id
      LEFT JOIN symbols s2 ON r.target_symbol_id = s2.id
      WHERE a.snapshot_id = $1 AND repo.user_id = $2 AND a.status = 'completed'
    `;

    const { rows } = await pool.query(query, [snapshotId, userId]);

    // Build unique nodes and edges
    const nodeSet = new Set();
    const edges = [];

    for (const r of rows) {
      if (r.source_file_path) nodeSet.add(r.source_file_path);
      if (r.target_file_path) nodeSet.add(r.target_file_path);

      edges.push({
        source: r.source_file_path,
        target: r.target_file_path,
        type: r.relationship_type,
        sourceSymbol: r.source_symbol_name,
        targetSymbol: r.target_symbol_name,
        symbols: r.symbols_imported
      });
    }

    return {
      snapshotId,
      nodes: Array.from(nodeSet).map(id => ({ id, label: id })),
      edges
    };
  }
};
