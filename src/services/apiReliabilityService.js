/**
 * API Reliability & Endpoint Contract Intelligence Client Service
 * Checkpoint 11 Phase H & I
 *
 * Interfaces with backend API discovery, contracts, static reliability findings,
 * scoring, and longitudinal trajectory APIs.
 */

function getActiveRepoId(repoId) {
  if (repoId && typeof repoId === 'string') return repoId;
  try {
    return localStorage.getItem('gitlab_active_repo_id') || null;
  } catch {
    return null;
  }
}

export const apiReliabilityService = {
  /**
   * Retrieves overview of API reliability intelligence for a repository snapshot
   * @param {string} [repoId]
   * @param {string} [snapshotId]
   * @returns {Promise<Object|null>}
   */
  async getOverview(repoId, snapshotId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return null;

    try {
      const url = snapshotId
        ? `/api/repositories/${targetRepoId}/api-reliability?snapshotId=${snapshotId}`
        : `/api/repositories/${targetRepoId}/api-reliability`;

      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.warn('Failed to fetch API reliability overview:', err);
    }
    return null;
  },

  /**
   * Retrieves aggregate API reliability summary metrics
   * @param {string} [repoId]
   * @param {string} [snapshotId]
   * @returns {Promise<Object|null>}
   */
  async getSummary(repoId, snapshotId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return null;

    try {
      const url = snapshotId
        ? `/api/repositories/${targetRepoId}/api-reliability/summary?snapshotId=${snapshotId}`
        : `/api/repositories/${targetRepoId}/api-reliability/summary`;

      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.warn('Failed to fetch API reliability summary:', err);
    }
    return null;
  },

  /**
   * Retrieves filterable list of discovered API endpoints
   * @param {string} [repoId]
   * @param {Object} [filters={}]
   * @returns {Promise<Array|null>}
   */
  async getEndpoints(repoId, filters = {}) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return [];

    try {
      const queryParams = new URLSearchParams();
      if (filters.snapshotId) queryParams.set('snapshotId', filters.snapshotId);
      if (filters.method) queryParams.set('method', filters.method);
      if (filters.auth !== undefined) queryParams.set('auth', String(filters.auth));
      if (filters.completeness) queryParams.set('completeness', filters.completeness);

      const qs = queryParams.toString();
      const url = `/api/repositories/${targetRepoId}/api-reliability/endpoints${qs ? `?${qs}` : ''}`;

      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        const data = await response.json();
        return data.endpoints || [];
      }
    } catch (err) {
      console.warn('Failed to fetch API endpoints:', err);
    }
    return [];
  },

  /**
   * Retrieves detailed single endpoint contracts and findings
   * @param {string} repoId
   * @param {string} endpointId
   * @returns {Promise<Object|null>}
   */
  async getEndpointDetail(repoId, endpointId) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId || !endpointId) return null;

    try {
      const response = await fetch(
        `/api/repositories/${targetRepoId}/api-reliability/endpoints/${endpointId}`,
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
      console.warn('Failed to fetch endpoint detail:', err);
    }
    return null;
  },

  /**
   * Retrieves static reliability findings for a repository
   * @param {string} [repoId]
   * @param {Object} [filters={}]
   * @returns {Promise<Array>}
   */
  async getFindings(repoId, filters = {}) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return [];

    try {
      const queryParams = new URLSearchParams();
      if (filters.snapshotId) queryParams.set('snapshotId', filters.snapshotId);
      if (filters.severity) queryParams.set('severity', filters.severity);
      if (filters.category) queryParams.set('category', filters.category);
      if (filters.ruleId) queryParams.set('ruleId', filters.ruleId);

      const qs = queryParams.toString();
      const url = `/api/repositories/${targetRepoId}/api-reliability/findings${qs ? `?${qs}` : ''}`;

      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        const data = await response.json();
        return data.findings || [];
      }
    } catch (err) {
      console.warn('Failed to fetch reliability findings:', err);
    }
    return [];
  },

  /**
   * Retrieves multi-snapshot timeline of API reliability trajectory
   * @param {string} [repoId]
   * @returns {Promise<Object|null>}
   */
  async getHistory(repoId) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return null;

    try {
      const response = await fetch(`/api/repositories/${targetRepoId}/api-reliability/history`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.warn('Failed to fetch API reliability history:', err);
    }
    return null;
  },

  /**
   * Compares API inventories and contracts between two snapshots
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
        `/api/repositories/${targetRepoId}/api-reliability/compare/${baseParam}/${targetSnapshotId}`,
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
      console.warn('Failed to compare snapshot APIs:', err);
    }
    return null;
  }
};
