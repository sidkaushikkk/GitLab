import { mockHealthTrends, mockRiskHotspots, mockRecentActivities, mockComplexityDistribution, mockCodeHealthFiles } from '../data/metricsData';
import { getLatestSnapshotForRepo } from './snapshotHelper';

function getActiveRepoId(repoId) {
  if (repoId && typeof repoId === 'string') return repoId;
  try {
    return localStorage.getItem('gitlab_active_repo_id') || null;
  } catch (e) {
    return null;
  }
}

export const analysisService = {
  /**
   * Get latest completed analysis summary from backend
   */
  async getAnalysisSummary(repoId, snapshotId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return null;

    let snapId = snapshotId;
    if (!snapId) {
      const snap = await getLatestSnapshotForRepo(targetRepoId);
      snapId = snap?.id;
    }
    if (!snapId) return null;

    try {
      const response = await fetch(`/api/repositories/${targetRepoId}/snapshots/${snapId}/analysis`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        const data = await response.json();
        return data.analysis;
      }
    } catch (err) {
      // Fallback
    }
    return null;
  },

  /**
   * Get granular file and function metrics from backend
   */
  async getCodeMetrics(repoId, query = {}) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return null;

    const snap = await getLatestSnapshotForRepo(targetRepoId);
    if (!snap) return null;

    const params = new URLSearchParams();
    if (query.entityType) params.set('entityType', query.entityType);
    if (query.sortBy) params.set('sortBy', query.sortBy);
    if (query.sortDir) params.set('sortDir', query.sortDir);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    if (query.filePath) params.set('filePath', query.filePath);

    try {
      const response = await fetch(`/api/repositories/${targetRepoId}/snapshots/${snap.id}/analysis/metrics?${params.toString()}`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      // Fallback
    }
    return null;
  },

  /**
   * Get code smells from backend
   */
  async getCodeSmells(repoId, query = {}) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return [];

    const snap = await getLatestSnapshotForRepo(targetRepoId);
    if (!snap) return [];

    const params = new URLSearchParams();
    if (query.ruleId) params.set('ruleId', query.ruleId);
    if (query.severity) params.set('severity', query.severity);
    if (query.filePath) params.set('filePath', query.filePath);
    if (query.limit) params.set('limit', String(query.limit));

    try {
      const response = await fetch(`/api/repositories/${targetRepoId}/snapshots/${snap.id}/analysis/smells?${params.toString()}`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        const data = await response.json();
        return data.smells || [];
      }
    } catch (err) {
      // Fallback
    }
    return [];
  },

  /**
   * Get health history trends for a repository
   */
  async getHealthTrends(repoId = 'payment-service') {
    return mockHealthTrends[repoId] || mockHealthTrends['payment-service'];
  },

  /**
   * Get risk hotspots from real analysis or fallback to mock
   */
  async getRiskHotspots(repoId = 'payment-service') {
    const targetRepoId = getActiveRepoId(repoId);
    if (targetRepoId) {
      const metricsData = await this.getCodeMetrics(targetRepoId, {
        entityType: 'function',
        sortBy: 'complexity',
        sortDir: 'desc',
        limit: 10
      });

      if (metricsData && Array.isArray(metricsData.metrics) && metricsData.metrics.length > 0) {
        return metricsData.metrics.map((m, idx) => ({
          id: `hotspot-${idx + 1}`,
          file: m.entityId.split('::')[0] || m.entityId,
          symbolName: m.entityId.split('::')[1]?.split('#')[0] || 'function',
          complexity: `${m.complexity > 10 ? 'High' : m.complexity > 5 ? 'Medium' : 'Low'} (Cyclomatic: ${m.complexity})`,
          rawComplexity: m.complexity,
          issuesCount: m.codeSmellCount || 0,
          category: m.maxNestingDepth > 3 ? 'Deep Control Flow' : 'Cyclomatic Complexity Hotspot',
          description: `Function exhibits cyclomatic complexity of ${m.complexity} with nesting depth ${m.maxNestingDepth} and ${m.callCount} calls.`,
          riskLevel: m.complexity > 15 ? 'CRITICAL' : m.complexity > 8 ? 'HIGH' : 'MEDIUM',
          findingsCount: m.codeSmellCount || 0
        }));
      }
    }

    return mockRiskHotspots[repoId] || mockRiskHotspots['payment-service'];
  },

  /**
   * Get recent activities
   */
  async getRecentActivities(repoId = 'payment-service') {
    return mockRecentActivities[repoId] || mockRecentActivities['payment-service'];
  },

  /**
   * Get complexity distribution from real analysis or fallback to mock
   */
  async getComplexityDistribution(repoId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (targetRepoId) {
      const metricsData = await this.getCodeMetrics(targetRepoId, { entityType: 'file', limit: 200 });
      if (metricsData && Array.isArray(metricsData.metrics) && metricsData.metrics.length > 0) {
        const buckets = { simple: 0, moderate: 0, complex: 0, extreme: 0 };
        for (const item of metricsData.metrics) {
          const c = item.complexity || 1;
          if (c <= 5) buckets.simple++;
          else if (c <= 10) buckets.moderate++;
          else if (c <= 20) buckets.complex++;
          else buckets.extreme++;
        }
        const total = metricsData.metrics.length || 1;
        return [
          { range: '1-5 (Simple)', files: buckets.simple, percentage: Number(((buckets.simple / total) * 100).toFixed(1)) },
          { range: '6-10 (Moderate)', files: buckets.moderate, percentage: Number(((buckets.moderate / total) * 100).toFixed(1)) },
          { range: '11-20 (Complex)', files: buckets.complex, percentage: Number(((buckets.complex / total) * 100).toFixed(1)) },
          { range: '21+ (Extreme)', files: buckets.extreme, percentage: Number(((buckets.extreme / total) * 100).toFixed(1)) }
        ];
      }
    }

    return mockComplexityDistribution;
  },

  /**
   * Get code health files table from real analysis or fallback to mock
   */
  async getCodeHealthFiles(filter = {}, repoId = null) {
    const targetRepoId = getActiveRepoId(filter.repoId || repoId);
    let files = [];

    if (targetRepoId) {
      const metricsData = await this.getCodeMetrics(targetRepoId, {
        entityType: 'file',
        sortBy: filter.sortBy || 'complexity',
        sortDir: 'desc',
        limit: 100
      });

      if (metricsData && Array.isArray(metricsData.metrics) && metricsData.metrics.length > 0) {
        files = metricsData.metrics.map(item => {
          const complexity = item.complexity || 1;
          const nesting = item.maxNestingDepth || 0;
          const smells = item.codeSmellCount || 0;
          const hasTest = !!item.hasTest;

          // Deterministic maintainability index (0-100)
          const maintainability = Math.max(10, Math.min(100, Math.round(100 - (complexity * 2.5) - (nesting * 4) - (smells * 5))));
          const risk = complexity > 15 || smells >= 3 ? 'CRITICAL' : complexity > 8 || smells >= 1 ? 'HIGH' : complexity > 4 ? 'MEDIUM' : 'LOW';

          return {
            file: item.entityId,
            lines: item.lines,
            complexity,
            nesting,
            maintainability,
            issues: smells,
            duplication: '0.0%',
            testCoverage: hasTest ? 'Guarded' : 'No Tests',
            risk,
            debtScore: item.debtScore ?? Math.round((complexity * 2) + (nesting * 3) + (smells * 5) - (hasTest ? 5 : 0))
          };
        });
      }
    }

    if (files.length === 0) {
      files = mockCodeHealthFiles.map((m, idx) => ({
        ...m,
        nesting: m.nesting ?? (m.complexity > 20 ? 4 : m.complexity > 10 ? 3 : 2),
        debtScore: m.debtScore ?? Math.round((m.complexity * 2) + ((m.complexity > 20 ? 4 : 2) * 3) + ((m.issues || 0) * 5) - (parseInt(m.testCoverage, 10) > 50 ? 5 : 0))
      }));
    }

    // Client-side filtering
    if (filter.search) {
      const q = filter.search.toLowerCase();
      files = files.filter(f => f.file.toLowerCase().includes(q));
    }
    if (filter.risk && filter.risk !== 'ALL') {
      files = files.filter(f => f.risk === filter.risk);
    }
    if (filter.sortBy) {
      if (filter.sortBy === 'complexity') {
        files.sort((a, b) => b.complexity - a.complexity);
      } else if (filter.sortBy === 'maintainability') {
        files.sort((a, b) => a.maintainability - b.maintainability);
      } else if (filter.sortBy === 'issues') {
        files.sort((a, b) => b.issues - a.issues);
      }
    }

    return files;
  }
};
