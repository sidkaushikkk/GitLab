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
   * Get latest completed snapshot duplication data
   */
  async getDuplication(repoId, snapshotId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return null;

    let snapId = snapshotId;
    if (!snapId) {
      const snap = await getLatestSnapshotForRepo(targetRepoId);
      snapId = snap?.id;
    }
    if (!snapId) return null;

    try {
      const response = await fetch(`/api/repositories/${targetRepoId}/snapshots/${snapId}/duplication`, {
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
   * Get health history trends for a repository (null: not implemented yet)
   */
  async getHealthTrends(repoId = null) {
    return null;
  },

  /**
   * Get ML defect propensity predictions and risk hotspots for a snapshot
   */
  async getPredictions(repoId, snapshotId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return null;

    let snapId = snapshotId;
    if (!snapId) {
      const snap = await getLatestSnapshotForRepo(targetRepoId);
      snapId = snap?.id;
    }
    if (!snapId) return null;

    try {
      const response = await fetch(`/api/repositories/${targetRepoId}/snapshots/${snapId}/analysis/predictions`, {
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
   * Get risk hotspots from real analysis (no mock fallback)
   */
  async getRiskHotspots(repoId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (targetRepoId) {
      // First try to get calibrated ML hotspots
      try {
        const predData = await this.getPredictions(targetRepoId);
        if (predData && Array.isArray(predData.hotspots) && predData.hotspots.length > 0) {
          return predData.hotspots.map((h, idx) => ({
            id: `ml-hotspot-${idx + 1}`,
            file: h.filePath,
            symbolName: h.filePath.split('/').pop(),
            complexity: `Risk Score: ${h.riskScore}/100 (${h.riskCategory})`,
            rawComplexity: h.complexity || 1,
            issuesCount: h.smellsCount || 0,
            category: h.topRiskFactors?.[0]?.factor || 'Defect Propensity Hotspot',
            description: h.topRiskFactors?.length > 0
              ? `Associated risk factors: ${h.topRiskFactors.map(f => `${f.factor} (${f.impact})`).join(', ')}`
              : `Calibrated defect probability: ${(h.probability * 100).toFixed(1)}%`,
            riskLevel: h.riskCategory || (h.riskScore >= 70 ? 'CRITICAL' : h.riskScore >= 50 ? 'HIGH' : 'MEDIUM'),
            findingsCount: h.smellsCount || 0,
            riskScore: h.riskScore,
            probability: h.probability,
            topRiskFactors: h.topRiskFactors || []
          }));
        }
      } catch (e) {
        // Fallback to deterministic metrics
      }

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

    return [];
  },

  /**
   * Get recent activities (null: not implemented yet)
   */
  async getRecentActivities(repoId = null) {
    return null;
  },

  /**
   * Get complexity distribution from real analysis (null if no analysis)
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

    return null;
  },

  /**
   * Get code health files table from real analysis
   */
  async getCodeHealthFiles(filter = {}, repoId = null) {
    const targetRepoId = getActiveRepoId(filter.repoId || repoId);
    let files = [];

    if (targetRepoId) {
      const [metricsData, predData, dupData] = await Promise.all([
        this.getCodeMetrics(targetRepoId, {
          entityType: 'file',
          sortBy: filter.sortBy || 'complexity',
          sortDir: 'desc',
          limit: 100
        }),
        this.getPredictions(targetRepoId).catch(() => null),
        this.getDuplication(targetRepoId).catch(() => null)
      ]);

      const predMap = new Map();
      if (predData && Array.isArray(predData.predictions)) {
        for (const p of predData.predictions) {
          predMap.set(p.filePath, p);
        }
      }

      // Compute file-level duplication via 1D interval union
      const fileDupMap = new Map();
      if (dupData && Array.isArray(dupData.clones)) {
        const fileIntervals = new Map();
        for (const clone of dupData.clones) {
          if (Array.isArray(clone.instances)) {
            for (const inst of clone.instances) {
              if (inst.filePath && inst.startLine && inst.endLine) {
                if (!fileIntervals.has(inst.filePath)) {
                  fileIntervals.set(inst.filePath, []);
                }
                fileIntervals.get(inst.filePath).push([inst.startLine, inst.endLine]);
              }
            }
          }
        }
        for (const [filePath, intervals] of fileIntervals.entries()) {
          intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          let totalDupLines = 0;
          let curStart = intervals[0][0];
          let curEnd = intervals[0][1];
          for (let i = 1; i < intervals.length; i++) {
            const [s, e] = intervals[i];
            if (s <= curEnd) {
              curEnd = Math.max(curEnd, e);
            } else {
              totalDupLines += (curEnd - curStart + 1);
              curStart = s;
              curEnd = e;
            }
          }
          totalDupLines += (curEnd - curStart + 1);
          fileDupMap.set(filePath, totalDupLines);
        }
      }

      if (metricsData && Array.isArray(metricsData.metrics) && metricsData.metrics.length > 0) {
        files = metricsData.metrics.map(item => {
          const complexity = item.complexity || 1;
          const nesting = item.maxNestingDepth || 0;
          const smells = item.codeSmellCount || 0;
          const hasTest = !!item.hasTest;
          const pred = predMap.get(item.entityId);

          // Deterministic maintainability index (0-100)
          const maintainability = Math.max(10, Math.min(100, Math.round(100 - (complexity * 2.5) - (nesting * 4) - (smells * 5))));
          const risk = pred?.riskCategory || (complexity > 15 || smells >= 3 ? 'CRITICAL' : complexity > 8 || smells >= 1 ? 'HIGH' : complexity > 4 ? 'MEDIUM' : 'LOW');
          const dupLines = fileDupMap.get(item.entityId) || 0;
          const totalLines = item.lines || 1;
          const dupPct = dupLines > 0 ? Number(((dupLines / totalLines) * 100).toFixed(1)) : 0;

          return {
            file: item.entityId,
            lines: item.lines,
            complexity,
            nesting,
            maintainability,
            issues: smells,
            duplication: dupLines > 0 ? `${dupPct}%` : '0%',
            duplicatedLines: dupLines,
            duplicationPercentage: dupPct,
            testCoverage: hasTest ? 'Guarded' : 'No Tests',
            risk,
            debtScore: item.debtScore ?? Math.round((complexity * 2) + (nesting * 3) + (smells * 5) - (hasTest ? 5 : 0)),
            mlRiskScore: pred ? pred.riskScore : null,
            mlProbability: pred ? pred.probability : null,
            mlTopFactors: pred ? pred.topRiskFactors : null
          };
        });
      }
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
