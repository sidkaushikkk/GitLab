/**
 * Format a real connected repository database record
 */
function formatRepository(repo) {
  if (!repo) return null;
  return {
    id: repo.id,
    name: repo.name,
    organization: repo.owner || repo.organization || 'HitachiSystems',
    description: repo.description || '',
    primaryLanguage: repo.language || repo.primaryLanguage || 'Unknown',
    defaultBranch: repo.defaultBranch || 'main',
    visibility: repo.private ? 'Private' : 'Public',
    status: repo.status || 'connected',
    lastAnalyzed: repo.lastAnalyzedAt ? new Date(repo.lastAnalyzedAt).toLocaleTimeString() : 'Not analyzed yet',
    createdAt: repo.createdAt,
    updatedAt: repo.updatedAt
  };
}

export const repositoryService = {
  /**
   * Get all connected repositories from backend /api/repositories
   */
  async getRepositories(filter = {}) {
    let result = [];

    try {
      const response = await fetch('/api/repositories', {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.repositories) && data.repositories.length > 0) {
          result = data.repositories.map(formatRepository);
        }
      }
    } catch (err) {
      // Backend not running or network failure
    }

    // Apply client-side filters
    if (filter.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(r =>
        r.name.toLowerCase().includes(q) ||
        (r.description && r.description.toLowerCase().includes(q)) ||
        (r.primaryLanguage && r.primaryLanguage.toLowerCase().includes(q))
      );
    }
    if (filter.language && filter.language !== 'All') {
      result = result.filter(r => r.primaryLanguage === filter.language);
    }
    if (filter.sortBy) {
      if (filter.sortBy === 'name') {
        result.sort((a, b) => a.name.localeCompare(b.name));
      }
    }

    return result;
  },

  /**
   * Get a single repository by ID
   */
  async getRepositoryById(id) {
    try {
      const response = await fetch(`/api/repositories/${id}`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.repository) {
          return formatRepository(data.repository);
        }
      }
    } catch (err) {
      // Fallback
    }

    return null;
  },

  /**
   * List GitHub repositories available for import via GET /api/repositories/github
   */
  async getAvailableGithubRepos(search = '') {
    let repos = [];

    try {
      const response = await fetch('/api/repositories/github', {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.repositories) && data.repositories.length > 0) {
          repos = data.repositories.map(r => ({
            name: r.name,
            organization: r.owner,
            primaryLanguage: r.language || 'Unknown',
            visibility: r.visibility || (r.private ? 'Private' : 'Public'),
            lastUpdated: r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : 'Recently',
            stars: r.stars || 0,
            isImported: !!r.isImported
          }));
        }
      }
    } catch (err) {
      // Unauthenticated or network error
    }

    if (search) {
      const q = search.toLowerCase();
      repos = repos.filter(r =>
        r.name.toLowerCase().includes(q) ||
        (r.primaryLanguage && r.primaryLanguage.toLowerCase().includes(q)) ||
        (r.organization && r.organization.toLowerCase().includes(q))
      );
    }

    return repos;
  },

  /**
   * Connect and persist a new repository in PostgreSQL via POST /api/repositories
   */
  async connectRepository({ owner, name, provider = 'github' }) {
    const response = await fetch('/api/repositories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      credentials: 'include',
      cache: 'no-store',
      body: JSON.stringify({ owner, name, provider })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to connect repository.');
    }

    const data = await response.json();
    return formatRepository(data.repository);
  },

  /**
   * Trigger ingestion pipeline for a connected repository to produce a normalized snapshot
   */
  async ingestRepository(repositoryId, branch = null) {
    const response = await fetch(`/api/repositories/${repositoryId}/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      credentials: 'include',
      cache: 'no-store',
      body: JSON.stringify({ branch })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to ingest repository.');
    }

    const data = await response.json();
    return data.snapshot;
  },

  /**
   * Get all snapshots for a connected repository
   */
  async getSnapshots(repositoryId) {
    try {
      const response = await fetch(`/api/repositories/${repositoryId}/snapshots`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });

      if (response.ok) {
        const data = await response.json();
        return data.snapshots || [];
      }
    } catch (err) {
      // Fallback
    }
    return [];
  },

  /**
   * Get all snapshots for a connected repository (alias for getSnapshots)
   */
  async getRepositorySnapshots(repositoryId) {
    return this.getSnapshots(repositoryId);
  },

  /**
   * Get single snapshot details
   */
  async getSnapshotById(repositoryId, snapshotId, includePayload = false) {
    const response = await fetch(`/api/repositories/${repositoryId}/snapshots/${snapshotId}?includePayload=${includePayload}`, {
      headers: { 'Accept': 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to fetch snapshot.');
    }

    const data = await response.json();
    return data.snapshot;
  },

  /**
   * Trigger AST-based code intelligence analysis and ML feature extraction for a snapshot
   */
  async analyzeSnapshot(repositoryId, snapshotId, force = false) {
    const response = await fetch(`/api/repositories/${repositoryId}/snapshots/${snapshotId}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      credentials: 'include',
      cache: 'no-store',
      body: JSON.stringify({ force })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to analyze snapshot.');
    }

    const data = await response.json();
    return data.analysis;
  },

  /**
   * Get latest completed analysis summary for a snapshot
   */
  async getAnalysis(repositoryId, snapshotId) {
    const response = await fetch(`/api/repositories/${repositoryId}/snapshots/${snapshotId}/analysis`, {
      headers: { 'Accept': 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to fetch analysis.');
    }

    const data = await response.json();
    return data.analysis;
  },

  /**
   * Get ML-ready feature vectors for snapshot
   */
  async getAnalysisFeatures(repositoryId, snapshotId) {
    const response = await fetch(`/api/repositories/${repositoryId}/snapshots/${snapshotId}/analysis/features`, {
      headers: { 'Accept': 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to fetch analysis features.');
    }

    return response.json();
  },

  /**
   * Get dependency and call graph for snapshot
   */
  async getAnalysisGraph(repositoryId, snapshotId) {
    const response = await fetch(`/api/repositories/${repositoryId}/snapshots/${snapshotId}/analysis/graph`, {
      headers: { 'Accept': 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to fetch analysis graph.');
    }

    return response.json();
  }
};
