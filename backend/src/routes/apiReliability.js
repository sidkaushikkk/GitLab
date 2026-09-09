/**
 * API Reliability & Endpoint Contract Intelligence REST API Routes
 * Checkpoint 11 Phase G & H
 *
 * Mounted at /api/repositories/:id/api-reliability
 * Enforces strict tenant isolation and exposes:
 * - GET /: API reliability overview, score, and inventory
 * - GET /summary: Aggregate API reliability summary
 * - GET /endpoints: Filterable endpoint inventory
 * - GET /endpoints/:endpointId: Endpoint details, contracts, and findings
 * - GET /findings: Static reliability findings
 * - GET /history: Longitudinal API evolution trajectory across snapshots
 * - GET /compare/:fromSnapshot/:toSnapshot: Differential snapshot comparison
 * - GET /compare: Differential snapshot comparison via query params
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { compareSnapshotApis } from '../services/intelligence/apiDiscoveryEngine.js';

export const apiReliabilityRouter = express.Router({ mergeParams: true });

/**
 * Validates repository existence and ownership for the authenticated tenant.
 * Returns 404 to preserve privacy and prevent tenant enumeration.
 */
async function verifyRepositoryOwnership(repositoryId, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM repositories WHERE id = $1 AND user_id = $2',
    [repositoryId, userId]
  );
  if (rows.length === 0) {
    const err = new Error('Repository not found or access denied.');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

/**
 * Validates that a snapshot exists and belongs to the given repository
 */
async function verifySnapshotBelongsToRepo(snapshotId, repositoryId) {
  const { rows } = await pool.query(
    'SELECT * FROM repository_snapshots WHERE id = $1 AND repository_id = $2',
    [snapshotId, repositoryId]
  );
  if (rows.length === 0) {
    const err = new Error('Snapshot not found for this repository.');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

/**
 * Gets the latest completed snapshot for a repository
 */
async function getLatestSnapshot(repositoryId) {
  const { rows } = await pool.query(
    `SELECT id, commit_sha, created_at, commit_timestamp
     FROM repository_snapshots
     WHERE repository_id = $1 AND status = 'completed'
     ORDER BY COALESCE(commit_timestamp, created_at) DESC, id DESC
     LIMIT 1`,
    [repositoryId]
  );
  return rows[0] || null;
}

/**
 * GET /api/repositories/:id/api-reliability
 * Overview of API reliability intelligence for the latest (or specified) snapshot
 */
apiReliabilityRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);

    let targetSnapshotId = req.query.snapshotId;
    if (targetSnapshotId) {
      await verifySnapshotBelongsToRepo(targetSnapshotId, repositoryId);
    } else {
      const latest = await getLatestSnapshot(repositoryId);
      if (!latest) {
        return res.status(200).json({
          repositoryId,
          state: 'NO_SNAPSHOTS',
          snapshotId: null,
          summary: null,
          endpoints: [],
          findings: []
        });
      }
      targetSnapshotId = latest.id;
    }

    // Query summary
    const { rows: sumRows } = await pool.query(
      'SELECT * FROM snapshot_api_summaries WHERE snapshot_id = $1 AND repository_id = $2',
      [targetSnapshotId, repositoryId]
    );

    // Query endpoints
    const { rows: epRows } = await pool.query(
      'SELECT * FROM snapshot_api_endpoints WHERE snapshot_id = $1 AND repository_id = $2 ORDER BY route_path ASC, method ASC',
      [targetSnapshotId, repositoryId]
    );

    // Query findings
    const { rows: findRows } = await pool.query(
      'SELECT * FROM snapshot_api_findings WHERE snapshot_id = $1 AND repository_id = $2 ORDER BY CASE severity WHEN \'HIGH\' THEN 1 WHEN \'MEDIUM\' THEN 2 WHEN \'LOW\' THEN 3 ELSE 4 END ASC',
      [targetSnapshotId, repositoryId]
    );

    const summary = sumRows[0] || {
      total_endpoints: epRows.length,
      method_distribution: {},
      authenticated_count: epRows.filter(e => e.is_authenticated).length,
      unauthenticated_count: epRows.filter(e => !e.is_authenticated).length,
      complete_contract_count: epRows.filter(e => e.contract_completeness === 'COMPLETE').length,
      partial_contract_count: epRows.filter(e => e.contract_completeness === 'PARTIAL').length,
      unknown_contract_count: epRows.filter(e => e.contract_completeness === 'UNKNOWN').length,
      total_findings: findRows.length,
      findings_by_severity: {},
      reliability_score: epRows.length === 0 ? 100.0 : 85.0
    };

    return res.status(200).json({
      repositoryId,
      snapshotId: targetSnapshotId,
      state: 'ACTIVE',
      summary,
      endpoints: epRows,
      findings: findRows
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/api-reliability/summary
 * Aggregate API reliability summary
 */
apiReliabilityRouter.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);

    let targetSnapshotId = req.query.snapshotId;
    if (targetSnapshotId) {
      await verifySnapshotBelongsToRepo(targetSnapshotId, repositoryId);
    } else {
      const latest = await getLatestSnapshot(repositoryId);
      if (!latest) {
        return res.status(200).json({
          repositoryId,
          snapshotId: null,
          summary: null
        });
      }
      targetSnapshotId = latest.id;
    }

    const { rows } = await pool.query(
      'SELECT * FROM snapshot_api_summaries WHERE snapshot_id = $1 AND repository_id = $2',
      [targetSnapshotId, repositoryId]
    );

    return res.status(200).json({
      repositoryId,
      snapshotId: targetSnapshotId,
      summary: rows[0] || null
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/api-reliability/endpoints
 * Filterable endpoint inventory
 */
apiReliabilityRouter.get('/endpoints', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);

    let targetSnapshotId = req.query.snapshotId;
    if (targetSnapshotId) {
      await verifySnapshotBelongsToRepo(targetSnapshotId, repositoryId);
    } else {
      const latest = await getLatestSnapshot(repositoryId);
      if (!latest) {
        return res.status(200).json({ repositoryId, snapshotId: null, endpoints: [] });
      }
      targetSnapshotId = latest.id;
    }

    let query = 'SELECT * FROM snapshot_api_endpoints WHERE snapshot_id = $1 AND repository_id = $2';
    const params = [targetSnapshotId, repositoryId];

    if (req.query.method) {
      params.push(req.query.method.toUpperCase());
      query += ` AND method = $${params.length}`;
    }

    if (req.query.auth !== undefined) {
      const isAuth = req.query.auth === 'true';
      params.push(isAuth);
      query += ` AND is_authenticated = $${params.length}`;
    }

    if (req.query.completeness) {
      params.push(req.query.completeness.toUpperCase());
      query += ` AND contract_completeness = $${params.length}`;
    }

    query += ' ORDER BY route_path ASC, method ASC';

    const { rows } = await pool.query(query, params);

    return res.status(200).json({
      repositoryId,
      snapshotId: targetSnapshotId,
      count: rows.length,
      endpoints: rows
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/api-reliability/endpoints/:endpointId
 * Detailed single endpoint contract and findings
 */
apiReliabilityRouter.get('/endpoints/:endpointId', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId, endpointId } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);

    const { rows: epRows } = await pool.query(
      'SELECT * FROM snapshot_api_endpoints WHERE id = $1 AND repository_id = $2',
      [endpointId, repositoryId]
    );

    if (epRows.length === 0) {
      const err = new Error('API endpoint not found for this repository.');
      err.status = 404;
      throw err;
    }

    const endpoint = epRows[0];

    const { rows: findRows } = await pool.query(
      'SELECT * FROM snapshot_api_findings WHERE endpoint_id = $1 AND repository_id = $2',
      [endpointId, repositoryId]
    );

    return res.status(200).json({
      endpoint,
      findings: findRows
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/api-reliability/findings
 * Static reliability findings
 */
apiReliabilityRouter.get('/findings', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);

    let targetSnapshotId = req.query.snapshotId;
    if (targetSnapshotId) {
      await verifySnapshotBelongsToRepo(targetSnapshotId, repositoryId);
    } else {
      const latest = await getLatestSnapshot(repositoryId);
      if (!latest) {
        return res.status(200).json({ repositoryId, snapshotId: null, findings: [] });
      }
      targetSnapshotId = latest.id;
    }

    let query = 'SELECT * FROM snapshot_api_findings WHERE snapshot_id = $1 AND repository_id = $2';
    const params = [targetSnapshotId, repositoryId];

    if (req.query.severity) {
      params.push(req.query.severity.toUpperCase());
      query += ` AND severity = $${params.length}`;
    }

    if (req.query.category) {
      params.push(req.query.category.toUpperCase());
      query += ` AND category = $${params.length}`;
    }

    if (req.query.ruleId) {
      params.push(req.query.ruleId);
      query += ` AND rule_id = $${params.length}`;
    }

    query += ' ORDER BY CASE severity WHEN \'HIGH\' THEN 1 WHEN \'MEDIUM\' THEN 2 WHEN \'LOW\' THEN 3 ELSE 4 END ASC';

    const { rows } = await pool.query(query, params);

    return res.status(200).json({
      repositoryId,
      snapshotId: targetSnapshotId,
      count: rows.length,
      findings: rows
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/api-reliability/history
 * Multi-snapshot timeline of API reliability metrics and contract drift
 */
apiReliabilityRouter.get('/history', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);

    // Fetch chronological completed snapshots
    const { rows: snapshots } = await pool.query(
      `SELECT id, commit_sha, created_at, commit_timestamp
       FROM repository_snapshots
       WHERE repository_id = $1 AND status = 'completed'
       ORDER BY COALESCE(commit_timestamp, created_at) ASC, id ASC`,
      [repositoryId]
    );

    if (snapshots.length === 0) {
      return res.status(200).json({
        repositoryId,
        state: 'NO_SNAPSHOTS',
        snapshotCount: 0,
        timeline: []
      });
    }

    const { rows: summaries } = await pool.query(
      'SELECT * FROM snapshot_api_summaries WHERE repository_id = $1',
      [repositoryId]
    );

    const sumMap = new Map(summaries.map(s => [s.snapshot_id, s]));

    const timeline = snapshots.map((s, idx) => {
      const sum = sumMap.get(s.id);
      return {
        snapshotId: s.id,
        commitSha: s.commit_sha,
        timestamp: s.commit_timestamp || s.created_at,
        isBaseline: idx === 0,
        metrics: {
          totalEndpoints: sum ? sum.total_endpoints : 0,
          reliabilityScore: sum ? Number(sum.reliability_score) : 100.0,
          authenticatedCount: sum ? sum.authenticated_count : 0,
          completeContracts: sum ? sum.complete_contract_count : 0,
          totalFindings: sum ? sum.total_findings : 0
        }
      };
    });

    const state = snapshots.length === 1 ? 'BASELINE' : 'TRAJECTORY_AVAILABLE';

    return res.status(200).json({
      repositoryId,
      state,
      snapshotCount: snapshots.length,
      timeline
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Helper to run snapshot comparison with validation
 */
async function handleComparison(repositoryId, fromSnapshot, toSnapshot, res) {
  if (!toSnapshot) {
    const err = new Error('Target snapshot is required.');
    err.status = 400;
    throw err;
  }

  // Reject self-comparison
  if (fromSnapshot && fromSnapshot !== 'none' && fromSnapshot === toSnapshot) {
    const err = new Error('Base and target snapshots must be distinct snapshots.');
    err.status = 400;
    throw err;
  }

  // Validate target snapshot belongs to this repository
  await verifySnapshotBelongsToRepo(toSnapshot, repositoryId);

  // If base snapshot provided, validate it belongs to this repository
  if (fromSnapshot && fromSnapshot !== 'none') {
    await verifySnapshotBelongsToRepo(fromSnapshot, repositoryId);
  }

  const comparison = await compareSnapshotApis(fromSnapshot, toSnapshot, repositoryId, pool);
  return res.status(200).json(comparison);
}

/**
 * GET /api/repositories/:id/api-reliability/compare/:fromSnapshot/:toSnapshot
 */
apiReliabilityRouter.get('/compare/:fromSnapshot/:toSnapshot', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId, fromSnapshot, toSnapshot } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);
    await handleComparison(repositoryId, fromSnapshot, toSnapshot, res);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/api-reliability/compare?base=...&target=...
 */
apiReliabilityRouter.get('/compare', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId } = req.params;
    const { base, target } = req.query;
    await verifyRepositoryOwnership(repositoryId, req.user.id);
    await handleComparison(repositoryId, base, target, res);
  } catch (err) {
    next(err);
  }
});
