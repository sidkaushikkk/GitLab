/**
 * Longitudinal Engineering Intelligence REST API Routes
 * Checkpoint 10 Phase D
 *
 * Mounted at /api/repositories/:id/history
 * Enforces strict tenant isolation and exposes:
 * - GET /: Repository engineering health timeline across snapshots
 * - GET /metrics: Time-series metrics for historical trend charts
 * - GET /compare/:fromSnapshot/:toSnapshot: Differential comparison between two snapshots
 * - GET /compare: Differential comparison via ?base=...&target=...
 * - GET /dependencies: Dependency evolution history across snapshots
 * - GET /security: Security trajectory timeline (CP9 integration)
 * - GET /duplication: Duplication timeline across snapshots
 * - GET /duplication/:snapshotId: Detailed clone clusters for a snapshot
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import {
  getRepositoryHistory,
  compareSnapshotsDetailed,
  getChronologicalSnapshots,
  getSnapshotMetricsProfile
} from '../services/intelligence/historyEngine.js';
import {
  detectAndPersistSnapshotDuplication
} from '../services/intelligence/duplicationEngine.js';
import { getRepositorySecurityTrajectory } from '../services/intelligence/trajectoryEngine.js';
import { defaultStorageProvider } from '../services/ingestion/storage/LocalStorageProvider.js';

export const historyRouter = express.Router({ mergeParams: true });

/**
 * Validates repository existence and ownership for the authenticated tenant.
 * Returns 404 (not 403) to preserve privacy and prevent tenant enumeration.
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
    const err = new Error('Repository not found or access denied.');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

/**
 * Validates that a snapshot exists and belongs to the given repository
 * @param {string} snapshotId
 * @param {string} repositoryId
 * @returns {Promise<Object>}
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
 * GET /api/repositories/:id/history
 * Returns the full engineering health trajectory timeline for a repository
 */
historyRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    await verifyRepositoryOwnership(id, req.user.id);

    const history = await getRepositoryHistory(id, {}, pool);
    return res.status(200).json(history);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/history/metrics
 * Returns time-series metric datapoints formatted for longitudinal charts
 */
historyRouter.get('/metrics', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    await verifyRepositoryOwnership(id, req.user.id);

    const history = await getRepositoryHistory(id, {}, pool);

    const series = history.timeline.map(point => ({
      snapshotId: point.snapshotId,
      commitSha: point.commitSha ? point.commitSha.substring(0, 7) : null,
      fullSha: point.commitSha,
      branch: point.branch,
      timestamp: point.timestamp,
      isBaseline: point.isBaseline,
      linesOfCode: point.metrics.totalLines,
      complexity: point.metrics.avgComplexity,
      maxComplexity: point.metrics.maxComplexity,
      maintainability: point.metrics.maintainability,
      codeSmells: point.metrics.totalSmells,
      duplicationRatio: point.metrics.duplicationRatio,
      duplicationPercentage: Number((point.metrics.duplicationRatio * 100).toFixed(2)),
      duplicatedLines: point.metrics.duplicatedLines,
      securityScore: point.metrics.securityScore,
      totalVulnerabilities: point.metrics.totalVulnerabilities,
      criticalVulnerabilities: point.metrics.criticalVulnerabilities,
      totalDependencies: point.metrics.totalDependencies,
      testGuardPercentage: point.metrics.testGuardPercentage,
      deltas: point.deltas
    }));

    return res.status(200).json({
      repositoryId: id,
      state: history.state,
      snapshotCount: history.snapshotCount,
      series
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/history/compare/:fromSnapshot/:toSnapshot
 * Compares two snapshots by route parameters
 */
historyRouter.get('/compare/:fromSnapshot/:toSnapshot', requireAuth, async (req, res, next) => {
  try {
    const { id, fromSnapshot, toSnapshot } = req.params;
    await verifyRepositoryOwnership(id, req.user.id);

    // Validate both snapshots belong to this repository
    await verifySnapshotBelongsToRepo(toSnapshot, id);
    if (fromSnapshot && fromSnapshot !== 'none') {
      await verifySnapshotBelongsToRepo(fromSnapshot, id);
    }

    if (fromSnapshot && fromSnapshot !== 'none' && fromSnapshot === toSnapshot) {
      return res.status(400).json({
        error: {
          message: 'Base and target snapshots must be distinct snapshots.',
          status: 400
        }
      });
    }

    const comparison = await compareSnapshotsDetailed(
      id,
      fromSnapshot === 'none' ? null : fromSnapshot,
      toSnapshot,
      pool
    );

    return res.status(200).json(comparison);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/history/compare
 * Compares two snapshots by query parameters (?base=...&target=...)
 */
historyRouter.get('/compare', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { base, target } = req.query;

    if (!target) {
      return res.status(400).json({
        error: {
          message: 'Query parameter "target" snapshot ID is required.',
          status: 400
        }
      });
    }

    await verifyRepositoryOwnership(id, req.user.id);
    await verifySnapshotBelongsToRepo(target, id);
    if (base && base !== 'none') {
      await verifySnapshotBelongsToRepo(base, id);
    }

    if (base && base !== 'none' && base === target) {
      return res.status(400).json({
        error: {
          message: 'Base and target snapshots must be distinct snapshots.',
          status: 400
        }
      });
    }

    const comparison = await compareSnapshotsDetailed(
      id,
      base === 'none' || !base ? null : base,
      target,
      pool
    );

    return res.status(200).json(comparison);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/history/dependencies
 * Exposes dependency transitions across historical snapshots
 */
historyRouter.get('/dependencies', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    await verifyRepositoryOwnership(id, req.user.id);

    const snapshots = await getChronologicalSnapshots(id, pool);
    if (snapshots.length < 2) {
      return res.status(200).json({
        repositoryId: id,
        snapshotCount: snapshots.length,
        state: snapshots.length === 1 ? 'BASELINE' : 'NO_SNAPSHOTS',
        message: 'Dependency evolution requires at least two snapshots.',
        timeline: []
      });
    }

    // Compare consecutive snapshots along the timeline
    const timeline = [];
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1];
      const curr = snapshots[i];

      const diff = await compareSnapshotsDetailed(id, prev.id, curr.id, pool);
      timeline.push({
        baseSnapshotId: prev.id,
        targetSnapshotId: curr.id,
        commitSha: curr.commit_sha,
        timestamp: curr.commit_timestamp || curr.created_at,
        dependencies: diff.deltas.dependencies
      });
    }

    return res.status(200).json({
      repositoryId: id,
      snapshotCount: snapshots.length,
      timeline
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/history/security
 * Reuses CP9 security trajectory timeline
 */
historyRouter.get('/security', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    await verifyRepositoryOwnership(id, req.user.id);

    const trajectory = await getRepositorySecurityTrajectory(id, pool);
    return res.status(200).json({
      repositoryId: id,
      trajectory
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/history/duplication
 * Returns duplication trajectory across all snapshots
 */
historyRouter.get('/duplication', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { snapshotId } = req.query;
    await verifyRepositoryOwnership(id, req.user.id);

    // If a specific snapshot is requested via query param
    if (snapshotId) {
      await verifySnapshotBelongsToRepo(snapshotId, id);
      const dupData = await getSnapshotDuplicationData(snapshotId, id);
      return res.status(200).json(dupData);
    }

    // Otherwise return timeline across snapshots
    const snapshots = await getChronologicalSnapshots(id, pool);
    const { rows: summaries } = await pool.query(
      'SELECT * FROM snapshot_duplication_summaries WHERE repository_id = $1',
      [id]
    );

    const summaryMap = new Map(summaries.map(s => [s.snapshot_id, s]));
    const timeline = snapshots.map(snap => {
      const s = summaryMap.get(snap.id);
      return {
        snapshotId: snap.id,
        commitSha: snap.commit_sha,
        timestamp: snap.commit_timestamp || snap.created_at,
        totalSourceLines: s ? s.total_source_lines : 0,
        duplicatedLines: s ? s.duplicated_lines : 0,
        duplicationRatio: s ? Number(s.duplication_ratio) : 0,
        cloneCount: s ? s.clone_count : 0,
        cloneGroupCount: s ? s.clone_group_count : 0
      };
    });

    return res.status(200).json({
      repositoryId: id,
      timeline
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/history/duplication/:snapshotId
 * Returns detailed clone clusters for a snapshot
 */
historyRouter.get('/duplication/:snapshotId', requireAuth, async (req, res, next) => {
  try {
    const { id, snapshotId } = req.params;
    await verifyRepositoryOwnership(id, req.user.id);
    await verifySnapshotBelongsToRepo(snapshotId, id);

    const dupData = await getSnapshotDuplicationData(snapshotId, id);
    return res.status(200).json(dupData);
  } catch (err) {
    next(err);
  }
});

/**
 * Helper to fetch or dynamically compute duplication data for a snapshot
 */
async function getSnapshotDuplicationData(snapshotId, repositoryId) {
  // Query existing summary
  const { rows: summaryRows } = await pool.query(
    'SELECT * FROM snapshot_duplication_summaries WHERE snapshot_id = $1',
    [snapshotId]
  );

  if (summaryRows.length > 0) {
    const summary = summaryRows[0];
    const { rows: cloneRows } = await pool.query(
      'SELECT clone_hash, clone_type, token_count, line_count, is_intra_file, instances FROM snapshot_duplications WHERE snapshot_id = $1 ORDER BY token_count DESC',
      [snapshotId]
    );

    return {
      snapshotId,
      repositoryId,
      summary: {
        totalSourceLines: summary.total_source_lines,
        duplicatedLines: summary.duplicated_lines,
        duplicationRatio: Number(summary.duplication_ratio),
        duplicationPercentage: Number((Number(summary.duplication_ratio) * 100).toFixed(2)),
        cloneCount: summary.clone_count,
        cloneGroupCount: summary.clone_group_count,
        intraFileClones: summary.intra_file_clones,
        interFileClones: summary.inter_file_clones
      },
      clones: cloneRows.map(r => ({
        cloneHash: r.clone_hash,
        cloneType: r.clone_type,
        tokenCount: r.token_count,
        lineCount: r.line_count,
        isIntraFile: r.is_intra_file,
        instances: r.instances
      }))
    };
  }

  // If not yet computed, load snapshot files and compute idempotently
  try {
    const payload = await defaultStorageProvider.getSnapshot(snapshotId);
    const files = Array.isArray(payload?.files) ? payload.files : [];
    const result = await detectAndPersistSnapshotDuplication(snapshotId, repositoryId, files, {}, pool);
    return {
      snapshotId,
      repositoryId,
      summary: {
        ...result.summary,
        duplicationPercentage: Number((result.summary.duplicationRatio * 100).toFixed(2))
      },
      clones: result.clones
    };
  } catch (err) {
    logger.warn({ snapshotId, err: err.message }, 'Could not dynamically compute duplication for snapshot');
    return {
      snapshotId,
      repositoryId,
      summary: {
        totalSourceLines: 0,
        duplicatedLines: 0,
        duplicationRatio: 0,
        duplicationPercentage: 0,
        cloneCount: 0,
        cloneGroupCount: 0,
        intraFileClones: 0,
        interFileClones: 0
      },
      clones: []
    };
  }
}
