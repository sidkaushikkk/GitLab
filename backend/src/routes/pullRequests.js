/**
 * Pull Request REST Routes
 * Mounted at /api/repositories/:id/pulls
 * Enforces repository-scoped tenant authorization and provides PR listing, details, and analysis triggers.
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pool } from '../db/pool.js';
import { prAnalysisPipeline } from '../services/intelligence/prAnalysisPipeline.js';
import { logger } from '../utils/logger.js';

export const pullRequestsRouter = express.Router({ mergeParams: true });

/**
 * Validates that the repository exists and belongs to the authenticated user.
 * @param {string} repositoryId
 * @param {string} userId
 * @returns {Promise<Object>}
 */
async function verifyRepositoryOwnership(repositoryId, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM repositories WHERE id = $1 AND user_id = $2',
    [repositoryId, userId]
  );
  if (rows.length === 0) {
    const err = new Error('Repository not found or you do not have permission to access it.');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

/**
 * GET /api/repositories/:id/pulls
 * Lists all pull requests for the repository with optional filtering, sorting, and pagination.
 */
pullRequestsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.perPage || '20', 10)));
    const offset = (page - 1) * perPage;

    const { status, risk, sortBy = 'updated_at', sortOrder = 'desc' } = req.query;

    const conditions = ['pr.repository_id = $1'];
    const params = [repositoryId];

    if (status) {
      params.push(status.toLowerCase());
      conditions.push(`pr.status = $${params.length}`);
    }

    if (risk) {
      params.push(risk.toUpperCase());
      conditions.push(`pa.risk_category = $${params.length}`);
    }

    const allowedSortFields = {
      updated_at: 'pr.updated_at',
      created_at: 'pr.created_at',
      pr_number: 'pr.pr_number',
      risk_score: 'pa.risk_score'
    };
    const sortCol = allowedSortFields[sortBy] || 'pr.updated_at';
    const direction = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const whereClause = conditions.join(' AND ');

    // Total count query
    const countSql = `
      SELECT count(*) AS total
      FROM pull_requests pr
      LEFT JOIN LATERAL (
        SELECT risk_category FROM pull_request_analyses
        WHERE pull_request_id = pr.id
        ORDER BY created_at DESC LIMIT 1
      ) pa ON true
      WHERE ${whereClause}
    `;
    const { rows: countRows } = await pool.query(countSql, params);
    const totalCount = parseInt(countRows[0]?.total || '0', 10);

    // Data query
    const dataSql = `
      SELECT 
        pr.id,
        pr.repository_id AS "repositoryId",
        pr.pr_number AS "prNumber",
        pr.title,
        pr.description,
        pr.author,
        pr.source_branch AS "sourceBranch",
        pr.target_branch AS "targetBranch",
        pr.source_commit_sha AS "sourceCommitSha",
        pr.target_commit_sha AS "targetCommitSha",
        pr.status,
        pr.created_at AS "createdAt",
        pr.updated_at AS "updatedAt",
        pa.id AS "latestAnalysisId",
        pa.status AS "analysisStatus",
        pa.risk_score AS "riskScore",
        pa.risk_category AS "riskCategory",
        pa.quality_gate AS "qualityGate",
        pa.summary AS "analysisSummary",
        pa.completed_at AS "analysisCompletedAt"
      FROM pull_requests pr
      LEFT JOIN LATERAL (
        SELECT id, status, risk_score, risk_category, quality_gate, summary, completed_at
        FROM pull_request_analyses
        WHERE pull_request_id = pr.id
        ORDER BY created_at DESC LIMIT 1
      ) pa ON true
      WHERE ${whereClause}
      ORDER BY ${sortCol} ${direction} NULLS LAST
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const { rows: prRows } = await pool.query(dataSql, [...params, perPage, offset]);

    return res.status(200).json({
      pullRequests: prRows,
      pagination: {
        page,
        perPage,
        totalCount,
        totalPages: Math.ceil(totalCount / perPage)
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/pulls/:prId
 * Returns a single pull request with its latest full analysis and findings.
 */
pullRequestsRouter.get('/:prId', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId, prId } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);

    // Support lookup by UUID or integer pr_number
    const isInteger = /^[0-9]+$/.test(prId);
    let prQuery;
    let prParams;

    if (isInteger) {
      prQuery = 'SELECT * FROM pull_requests WHERE repository_id = $1 AND (id::text = $2 OR pr_number = $3)';
      prParams = [repositoryId, prId, parseInt(prId, 10)];
    } else {
      prQuery = 'SELECT * FROM pull_requests WHERE repository_id = $1 AND id::text = $2';
      prParams = [repositoryId, prId];
    }

    const { rows: prRows } = await pool.query(prQuery, prParams);
    if (prRows.length === 0) {
      return res.status(404).json({
        error: {
          message: 'Pull request not found for this repository.',
          status: 404
        }
      });
    }

    const pr = prRows[0];

    // Fetch latest analysis
    const { rows: analysisRows } = await pool.query(
      `SELECT * FROM pull_request_analyses
       WHERE pull_request_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [pr.id]
    );

    const analysis = analysisRows[0] || null;

    // Fetch associated diffs
    let diffs = [];
    if (analysis) {
      const { rows: diffRows } = await pool.query(
        `SELECT 
           id, file_path AS "filePath", old_path AS "oldPath",
           change_type AS "changeType", additions, deletions,
           changed_line_ranges AS "changedLineRanges",
           patch, touched_symbols AS "touchedSymbols"
         FROM pull_request_diffs
         WHERE analysis_id = $1
         ORDER BY file_path ASC`,
        [analysis.id]
      );
      diffs = diffRows;
    }

    return res.status(200).json({
      pullRequest: {
        id: pr.id,
        repositoryId: pr.repository_id,
        prNumber: pr.pr_number,
        title: pr.title,
        description: pr.description,
        author: pr.author,
        sourceBranch: pr.source_branch,
        targetBranch: pr.target_branch,
        sourceCommitSha: pr.source_commit_sha,
        targetCommitSha: pr.target_commit_sha,
        status: pr.status,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at
      },
      analysis: analysis ? {
        id: analysis.id,
        status: analysis.status,
        analysisVersion: analysis.analysis_version,
        riskScore: analysis.risk_score,
        riskCategory: analysis.risk_category,
        qualityGate: analysis.quality_gate,
        summary: analysis.summary,
        churnMetrics: analysis.churn_metrics,
        blastRadius: analysis.blast_radius,
        findings: analysis.findings,
        errorMessage: analysis.error_message,
        createdAt: analysis.created_at,
        completedAt: analysis.completed_at
      } : null,
      diffs
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/repositories/:id/pulls/analyze
 * Manual or simulation analysis trigger endpoint.
 */
pullRequestsRouter.post('/analyze', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId } = req.params;
    const repo = await verifyRepositoryOwnership(repositoryId, req.user.id);

    const {
      prNumber: inputPrNumber,
      title = 'Manual PR Analysis Simulation',
      description = '',
      author = req.user.login || 'manual-analyst',
      sourceBranch = 'feature/branch',
      targetBranch = repo.default_branch || 'main',
      sourceCommitSha: inputSourceSha,
      targetCommitSha: inputTargetSha,
      headCommitSha,
      baseCommitSha,
      baseSnapshotId = null,
      diffText = '',
      baseFiles = [],
      headFiles = [],
      relationships = [],
      maxDepth = 3,
      forceReanalyze = false
    } = req.body;

    const sourceCommitSha = inputSourceSha || headCommitSha || '1111111111111111111111111111111111111111';
    const targetCommitSha = inputTargetSha || baseCommitSha || '0000000000000000000000000000000000000000';

    // Determine PR number
    let prNumber = inputPrNumber;
    if (!prNumber) {
      const { rows: maxRow } = await pool.query(
        'SELECT COALESCE(MAX(pr_number), 0) + 1 AS next_num FROM pull_requests WHERE repository_id = $1',
        [repositoryId]
      );
      prNumber = parseInt(maxRow[0]?.next_num || '1', 10);
    }

    // Upsert pull request record
    const { rows: prRows } = await pool.query(
      `INSERT INTO pull_requests (
         repository_id, pr_number, title, description, author,
         source_branch, target_branch, source_commit_sha, target_commit_sha, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', NOW())
       ON CONFLICT (repository_id, pr_number) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         source_branch = EXCLUDED.source_branch,
         target_branch = EXCLUDED.target_branch,
         source_commit_sha = EXCLUDED.source_commit_sha,
         target_commit_sha = EXCLUDED.target_commit_sha,
         updated_at = NOW()
       RETURNING *`,
      [
        repositoryId,
        prNumber,
        title,
        description,
        author,
        sourceBranch,
        targetBranch,
        sourceCommitSha,
        targetCommitSha
      ]
    );

    const pullRequest = prRows[0];

    // Run pipeline
    const analysisResult = await prAnalysisPipeline.runAnalysis({
      pullRequestId: pullRequest.id,
      commitSha: sourceCommitSha,
      baseSnapshotId,
      diffText,
      baseFiles,
      headFiles,
      relationships,
      maxDepth,
      forceReanalyze
    });

    return res.status(200).json({
      pullRequest: {
        id: pullRequest.id,
        repositoryId: pullRequest.repository_id,
        prNumber: pullRequest.pr_number,
        title: pullRequest.title,
        status: pullRequest.status,
        sourceBranch: pullRequest.source_branch,
        targetBranch: pullRequest.target_branch,
        sourceCommitSha: pullRequest.source_commit_sha,
        targetCommitSha: pullRequest.target_commit_sha
      },
      analysis: analysisResult
    });
  } catch (err) {
    next(err);
  }
});
