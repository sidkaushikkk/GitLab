import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { githubService } from '../services/github.js';
import { ingestionService } from '../services/ingestion/repositoryIngestion.js';
import { codeIntelligenceService } from '../services/intelligence/analysisRunner.js';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

export const repositoriesRouter = express.Router();

/**
 * Format a database repository row into a clean JSON API object
 */
function mapRepoRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    owner: row.owner,
    name: row.name,
    fullName: row.full_name,
    description: row.description,
    defaultBranch: row.default_branch,
    language: row.language,
    private: row.private,
    providerRepoId: row.provider_repo_id ? String(row.provider_repo_id) : null,
    status: row.status,
    lastAnalyzedAt: row.last_analyzed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * GET /api/repositories/github
 * Discovers and lists repositories accessible to the authenticated user on GitHub
 */
repositoriesRouter.get('/github', requireAuth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const perPage = parseInt(req.query.perPage || '100', 10);

    // Fetch repositories from GitHub
    const githubRepos = await githubService.getUserRepositories(req.user.id, { page, perPage });

    // Query already connected repositories for this user
    const { rows: connectedRows } = await pool.query(
      'SELECT provider_repo_id, full_name FROM repositories WHERE user_id = $1',
      [req.user.id]
    );

    const connectedMap = new Set(connectedRows.map(r => r.full_name.toLowerCase()));

    // Mark repositories as imported if they already exist in PostgreSQL
    const enrichedRepos = githubRepos.map(repo => ({
      ...repo,
      isImported: connectedMap.has(repo.fullName.toLowerCase())
    }));

    return res.status(200).json({
      repositories: enrichedRepos
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/repositories
 * Verifies repository ownership/access against GitHub and persists it in PostgreSQL
 */
repositoriesRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const { owner, name, provider = 'github' } = req.body;

    if (!owner || !name) {
      return res.status(400).json({
        error: {
          message: 'Both owner and name are required to connect a repository.',
          status: 400
        }
      });
    }

    // 1. Verify that the authenticated user has access to this repository on GitHub
    logger.info({ userId: req.user.id, owner, name }, 'Verifying repository access on GitHub...');
    const verifiedRepo = await githubService.verifyAndGetRepository(req.user.id, owner, name);

    // 2. Persist or update repository in PostgreSQL (prevents duplicates via UNIQUE constraint)
    const upsertQuery = `
      INSERT INTO repositories (
        user_id,
        provider,
        owner,
        name,
        full_name,
        description,
        default_branch,
        language,
        private,
        provider_repo_id,
        status,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'connected', NOW(), NOW()
      )
      ON CONFLICT (user_id, provider, owner, name) DO UPDATE SET
        description = EXCLUDED.description,
        default_branch = EXCLUDED.default_branch,
        language = EXCLUDED.language,
        private = EXCLUDED.private,
        provider_repo_id = EXCLUDED.provider_repo_id,
        updated_at = NOW()
      RETURNING *;
    `;

    const { rows } = await pool.query(upsertQuery, [
      req.user.id,
      provider,
      verifiedRepo.owner,
      verifiedRepo.name,
      verifiedRepo.fullName,
      verifiedRepo.description,
      verifiedRepo.defaultBranch,
      verifiedRepo.language,
      verifiedRepo.private,
      verifiedRepo.providerRepoId
    ]);

    const connectedRepo = mapRepoRow(rows[0]);
    logger.info({ repoId: connectedRepo.id, fullName: connectedRepo.fullName }, 'Repository successfully connected and persisted in PostgreSQL');

    return res.status(201).json({
      repository: connectedRepo
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories
 * Lists all connected repositories belonging to the authenticated user
 */
repositoriesRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM repositories WHERE user_id = $1 ORDER BY updated_at DESC',
      [req.user.id]
    );

    return res.status(200).json({
      repositories: rows.map(mapRepoRow)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id
 * Fetches a single connected repository ensuring user authorization
 */
repositoriesRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      'SELECT * FROM repositories WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: {
          message: 'Repository not found or you do not have permission to view it.',
          status: 404
        }
      });
    }

    return res.status(200).json({
      repository: mapRepoRow(rows[0])
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/repositories/:id/ingest
 * Ingests repository files and generates a normalized repository snapshot
 */
repositoriesRouter.post('/:id/ingest', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { branch } = req.body || {};

    const snapshot = await ingestionService.ingestRepository({
      repositoryId: id,
      userId: req.user.id,
      branch
    });

    const statusCode = snapshot.reused ? 200 : 201;
    return res.status(statusCode).json({
      snapshot
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/snapshots
 * Lists all snapshots for a connected repository
 */
repositoriesRouter.get('/:id/snapshots', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const snapshots = await ingestionService.getRepositorySnapshots(id, req.user.id);

    return res.status(200).json({
      snapshots
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/snapshots/:snapshotId
 * Retrieves metadata (and optional payload) for a specific snapshot
 */
repositoriesRouter.get('/:id/snapshots/:snapshotId', requireAuth, async (req, res, next) => {
  try {
    const { snapshotId } = req.params;
    const includePayload = req.query.includePayload === 'true';

    const snapshot = await ingestionService.getSnapshotById(snapshotId, req.user.id, {
      includePayload
    });

    return res.status(200).json({
      snapshot
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/repositories/:id/snapshots/:snapshotId/analyze
 * Triggers AST-based code intelligence analysis and ML feature extraction
 */
repositoriesRouter.post('/:id/snapshots/:snapshotId/analyze', requireAuth, async (req, res, next) => {
  try {
    const { id, snapshotId } = req.params;
    const forceReanalyze = req.body?.force === true;

    const summary = await codeIntelligenceService.analyzeSnapshot({
      repositoryId: id,
      snapshotId,
      userId: req.user.id,
      forceReanalyze
    });

    const statusCode = summary.reused ? 200 : 201;
    return res.status(statusCode).json({
      analysis: summary
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/snapshots/:snapshotId/analysis
 * Retrieves latest analysis run summary for a snapshot
 */
repositoriesRouter.get('/:id/snapshots/:snapshotId/analysis', requireAuth, async (req, res, next) => {
  try {
    const { id, snapshotId } = req.params;

    // Find latest completed analysis run
    const { rows } = await pool.query(
      `SELECT a.id 
       FROM analysis_runs a
       JOIN repositories r ON a.repository_id = r.id
       WHERE a.repository_id = $1 AND a.snapshot_id = $2 AND r.user_id = $3
       ORDER BY a.created_at DESC
       LIMIT 1`,
      [id, snapshotId, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: {
          message: 'No analysis run found for this snapshot.',
          status: 404
        }
      });
    }

    const summary = await codeIntelligenceService.getAnalysisRunSummary(rows[0].id, req.user.id);
    return res.status(200).json({
      analysis: summary
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/snapshots/:snapshotId/analysis/features
 * Retrieves ML-ready feature vectors for custom Python model ingestion (CP7)
 */
repositoriesRouter.get('/:id/snapshots/:snapshotId/analysis/features', requireAuth, async (req, res, next) => {
  try {
    const { snapshotId } = req.params;
    const features = await codeIntelligenceService.getAnalysisFeatures(snapshotId, req.user.id);

    return res.status(200).json(features);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/snapshots/:snapshotId/analysis/graph
 * Retrieves dependency & call graph nodes and edges for code architecture mapping
 */
repositoriesRouter.get('/:id/snapshots/:snapshotId/analysis/graph', requireAuth, async (req, res, next) => {
  try {
    const { snapshotId } = req.params;
    const graph = await codeIntelligenceService.getAnalysisGraph(snapshotId, req.user.id);

    return res.status(200).json(graph);
  } catch (err) {
    next(err);
  }
});
