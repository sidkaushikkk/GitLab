import { mockSecurityFindings, mockSecurityScoreHistory } from '../data/securityData';
import { getLatestSnapshotForRepo } from './snapshotHelper';

function getActiveRepoId(repoId) {
  if (repoId && typeof repoId === 'string') return repoId;
  try {
    return localStorage.getItem('gitlab_active_repo_id') || null;
  } catch (e) {
    return null;
  }
}

export const securityService = {
  /**
   * Fetches deterministic security findings and code smells from backend
   */
  async getFindings(filter = {}) {
    const targetRepoId = getActiveRepoId(filter.repoId);
    if (targetRepoId) {
      const snap = await getLatestSnapshotForRepo(targetRepoId);
      if (snap) {
        try {
          const params = new URLSearchParams();
          if (filter.severity && filter.severity !== 'ALL') params.set('severity', filter.severity);

          const response = await fetch(`/api/repositories/${targetRepoId}/snapshots/${snap.id}/analysis/smells?${params.toString()}`, {
            headers: { 'Accept': 'application/json' },
            credentials: 'include',
            cache: 'no-store'
          });

          if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data.smells) && data.smells.length > 0) {
              let findings = data.smells.map((smell, idx) => ({
                id: smell.id || `SMELL-${idx + 1}`,
                severity: smell.severity || 'MEDIUM',
                title: smell.title || smell.ruleId,
                category: smell.ruleId || 'Static Code Analysis',
                file: smell.filePath || 'src/index.js',
                line: smell.lineNumber || 1,
                status: 'Open',
                detectedAt: smell.createdAt || new Date().toISOString(),
                author: 'Deterministic AST Scanner',
                whyItMatters: smell.description || 'Violates clean code maintainability and reliability boundaries.',
                potentialImpact: smell.remediation || 'Increased defect probability and maintenance friction.',
                affectedCode: smell.snippet || `// ${smell.filePath}:${smell.lineNumber}`,
                suggestedRemediation: smell.remediation || 'Refactor code to satisfy architectural rules.'
              }));

              if (filter.search) {
                const q = filter.search.toLowerCase();
                findings = findings.filter(f =>
                  f.title.toLowerCase().includes(q) ||
                  f.category.toLowerCase().includes(q) ||
                  f.file.toLowerCase().includes(q)
                );
              }
              if (filter.status && filter.status !== 'ALL') {
                findings = findings.filter(f => f.status === filter.status);
              }
              return findings;
            }
          }
        } catch (e) {
          // Graceful fallback
        }
      }
    }

    await new Promise(resolve => setTimeout(resolve, 70));
    let findings = [...mockSecurityFindings];
    if (filter.search) {
      const q = filter.search.toLowerCase();
      findings = findings.filter(f => 
        f.title.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q) ||
        f.file.toLowerCase().includes(q)
      );
    }
    if (filter.severity && filter.severity !== 'ALL') {
      findings = findings.filter(f => f.severity === filter.severity);
    }
    if (filter.status && filter.status !== 'ALL') {
      findings = findings.filter(f => f.status === filter.status);
    }
    return findings;
  },

  async getFindingById(id, repoId = null) {
    const findings = await this.getFindings({ repoId });
    return findings.find(f => f.id === id) || mockSecurityFindings.find(f => f.id === id) || null;
  },

  async getScoreHistory(repoId = null) {
    await new Promise(resolve => setTimeout(resolve, 50));
    return mockSecurityScoreHistory;
  }
};
