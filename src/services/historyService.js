/**
 * Longitudinal Engineering Intelligence Client Service
 * Checkpoint 10 Phase E
 *
 * Interfaces with backend historical trajectory, metric deltas,
 * snapshot comparison, and duplication APIs.
 */

import { getLatestSnapshotForRepo } from './snapshotHelper.js';

function getActiveRepoId(repoId) {
  if (repoId && typeof repoId === 'string') return repoId;
  try {
    return localStorage.getItem('gitlab_active_repo_id') || null;
  } catch (e) {
    return null;
  }
}

export const historyService = {
  /**
   * Retrieves full historical timeline across snapshots for a repository
   * @param {string} [repoId]
   * @returns {Promise<Object|null>}
   */
  async getRepositoryHistory(repoId) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return null;

    try {
      const response = await fetch(`/api/repositories/${targetRepoId}/history`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.warn('Failed to fetch repository history:', err);
    }
    return null;
  },

  /**
   * Retrieves time-series metric series for charting
   * @param {string} [repoId]
   * @returns {Promise<Object|null>}
   */
  async getHistoryMetrics(repoId) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return null;

    try {
      const response = await fetch(`/api/repositories/${targetRepoId}/history/metrics`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.warn('Failed to fetch history metrics series:', err);
    }
    return null;
  },

  /**
   * Compares two snapshots and returns all differential metric deltas
   * @param {string} repoId
   * @param {string} baseSnapshotId
   * @param {string} targetSnapshotId
   * @returns {Promise<Object|null>}
   */
  async compareSnapshots(repoId, baseSnapshotId, targetSnapshotId) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId || !targetSnapshotId) return null;

    try {
      const baseParam = baseSnapshotId || 'none';
      const response = await fetch(
        `/api/repositories/${targetRepoId}/history/compare/${baseParam}/${targetSnapshotId}`,
        {
          headers: { 'Accept': 'application/json' },
          credentials: 'include',
          cache: 'no-store'
        }
      );
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.warn('Failed to compare snapshots:', err);
    }
    return null;
  },

  /**
   * Retrieves detailed duplication findings and clone clusters for a snapshot
   * @param {string} repoId
   * @param {string} [snapshotId]
   * @returns {Promise<Object|null>}
   */
  async getSnapshotDuplication(repoId, snapshotId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return null;

    let snapId = snapshotId;
    if (!snapId) {
      const latest = await getLatestSnapshotForRepo(targetRepoId);
      snapId = latest?.id;
    }
    if (!snapId) return null;

    try {
      const response = await fetch(
        `/api/repositories/${targetRepoId}/snapshots/${snapId}/duplication`,
        {
          headers: { 'Accept': 'application/json' },
          credentials: 'include',
          cache: 'no-store'
        }
      );
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.warn('Failed to fetch snapshot duplication:', err);
    }
    return null;
  },

  /**
   * Retrieves duplication trajectory across all snapshots
   * @param {string} [repoId]
   * @returns {Promise<Object|null>}
   */
  async getDuplicationTrajectory(repoId) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return null;

    try {
      const response = await fetch(`/api/repositories/${targetRepoId}/history/duplication`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.warn('Failed to fetch duplication trajectory:', err);
    }
    return null;
  },

  /**
   * Retrieves dependency evolution history across snapshots
   * @param {string} [repoId]
   * @returns {Promise<Object|null>}
   */
  async getDependencyEvolution(repoId) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return null;

    try {
      const response = await fetch(`/api/repositories/${targetRepoId}/history/dependencies`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.warn('Failed to fetch dependency evolution:', err);
    }
    return null;
  }
};
