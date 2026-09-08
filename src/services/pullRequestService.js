/**
 * Pull Request API Service
 * Connects frontend interface to backend Checkpoint 8 PR Intelligence endpoints:
 * - GET  /api/repositories/:id/pulls
 * - GET  /api/repositories/:id/pulls/:prId
 * - POST /api/repositories/:id/pulls/analyze
 */

/**
 * Normalizes a pull request object returned from backend APIs
 * @param {Object} pr
 * @returns {Object}
 */
export function formatPullRequest(pr) {
  if (!pr) return null;
  return {
    id: pr.id,
    repositoryId: pr.repositoryId || pr.repository_id,
    prNumber: pr.prNumber || pr.pr_number,
    title: pr.title || 'Untitled Pull Request',
    description: pr.description || '',
    author: pr.author || 'Unknown Author',
    sourceBranch: pr.sourceBranch || pr.source_branch,
    targetBranch: pr.targetBranch || pr.target_branch,
    sourceCommitSha: pr.sourceCommitSha || pr.source_commit_sha,
    targetCommitSha: pr.targetCommitSha || pr.target_commit_sha,
    status: (pr.status || 'open').toLowerCase(),
    createdAt: pr.createdAt || pr.created_at,
    updatedAt: pr.updatedAt || pr.updated_at,
    latestAnalysisId: pr.latestAnalysisId || pr.latest_analysis_id,
    analysisStatus: pr.analysisStatus || pr.analysis_status,
    riskScore: typeof pr.riskScore === 'number' ? pr.riskScore : (typeof pr.risk_score === 'number' ? pr.risk_score : null),
    riskCategory: pr.riskCategory || pr.risk_category || null,
    qualityGate: pr.qualityGate || pr.quality_gate || null,
    analysisSummary: pr.analysisSummary || pr.analysis_summary || pr.summary || null,
    analysisCompletedAt: pr.analysisCompletedAt || pr.analysis_completed_at || pr.completed_at || null
  };
}

export const pullRequestService = {
  /**
   * Fetch paginated list of pull requests for a repository with optional filtering & sorting
   * @param {string} repositoryId - UUID of the repository
   * @param {Object} [filter={}] - Query options { page, perPage, status, risk, sortBy, sortOrder, search }
   * @returns {Promise<{ pullRequests: Array<Object>, pagination: Object }>}
   */
  async getPullRequests(repositoryId, filter = {}) {
    if (!repositoryId) {
      return { pullRequests: [], pagination: { page: 1, perPage: 20, totalCount: 0, totalPages: 0 } };
    }

    const params = new URLSearchParams();
    if (filter.page) params.set('page', String(filter.page));
    if (filter.perPage) params.set('perPage', String(filter.perPage));
    if (filter.status && filter.status !== 'all') params.set('status', filter.status);
    if (filter.risk && filter.risk !== 'all') params.set('risk', filter.risk);
    if (filter.sortBy) params.set('sortBy', filter.sortBy);
    if (filter.sortOrder) params.set('sortOrder', filter.sortOrder);

    const url = `/api/repositories/${repositoryId}/pulls${params.toString() ? `?${params.toString()}` : ''}`;

    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Failed to fetch pull requests (HTTP ${response.status})`);
      }

      const data = await response.json();
      let list = Array.isArray(data.pullRequests) ? data.pullRequests.map(formatPullRequest) : [];

      // Client-side search refinement if title/branch keyword provided
      if (filter.search) {
        const q = filter.search.toLowerCase();
        list = list.filter(pr =>
          pr.title.toLowerCase().includes(q) ||
          pr.sourceBranch.toLowerCase().includes(q) ||
          pr.targetBranch.toLowerCase().includes(q) ||
          String(pr.prNumber).includes(q) ||
          pr.author.toLowerCase().includes(q)
        );
      }

      return {
        pullRequests: list,
        pagination: data.pagination || {
          page: filter.page || 1,
          perPage: filter.perPage || 20,
          totalCount: list.length,
          totalPages: Math.ceil(list.length / (filter.perPage || 20))
        }
      };
    } catch (err) {
      throw err;
    }
  },

  /**
   * Fetch single pull request details, latest analysis findings, and diffs
   * @param {string} repositoryId - UUID of the repository
   * @param {string|number} prId - PR UUID or integer PR number
   * @returns {Promise<{ pullRequest: Object, analysis: Object|null, diffs: Array<Object> }>}
   */
  async getPullRequestById(repositoryId, prId) {
    if (!repositoryId || !prId) {
      throw new Error('Both repositoryId and prId are required to fetch pull request details.');
    }

    const response = await fetch(`/api/repositories/${repositoryId}/pulls/${prId}`, {
      headers: { 'Accept': 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Pull request not found (HTTP ${response.status})`);
    }

    const data = await response.json();
    return {
      pullRequest: formatPullRequest(data.pullRequest),
      analysis: data.analysis || null,
      diffs: Array.isArray(data.diffs) ? data.diffs : []
    };
  },

  /**
   * Trigger manual or simulated PR analysis
   * @param {string} repositoryId - UUID of the repository
   * @param {Object} payload - PR payload { prNumber, title, sourceBranch, targetBranch, diffText, ... }
   * @returns {Promise<{ pullRequest: Object, analysis: Object }>}
   */
  async analyzePullRequest(repositoryId, payload = {}) {
    if (!repositoryId) {
      throw new Error('repositoryId is required to analyze a pull request.');
    }

    const response = await fetch(`/api/repositories/${repositoryId}/pulls/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      credentials: 'include',
      cache: 'no-store',
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Failed to analyze pull request (HTTP ${response.status})`);
    }

    const data = await response.json();
    return {
      pullRequest: formatPullRequest(data.pullRequest),
      analysis: data.analysis || null
    };
  }
};
