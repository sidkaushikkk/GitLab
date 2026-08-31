import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { githubService } from '../services/github.js';
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
