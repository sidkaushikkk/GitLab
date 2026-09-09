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
   * Fetches deterministic security findings (live CVEs/OSVs) from backend
   */
  async getFindings(filter = {}) {
    const targetRepoId = getActiveRepoId(filter.repoId);
    if (!targetRepoId) return [];

    try {
      const params = new URLSearchParams();
      if (filter.severity && filter.severity !== 'ALL') params.set('severity', filter.severity);
      if (filter.status && filter.status !== 'ALL') params.set('status', filter.status);
      if (filter.scope && filter.scope !== 'ALL') params.set('scope', filter.scope);
      if (filter.search) params.set('search', filter.search);

      const response = await fetch(`/api/repositories/${targetRepoId}/security/vulnerabilities?${params.toString()}`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.vulnerabilities) && data.vulnerabilities.length > 0) {
          return data.vulnerabilities.map(v => ({
            id: v.canonicalId,
            internalId: v.id,
            severity: v.severity,
            title: v.title || `Vulnerability in ${v.packageName}`,
            category: `${v.packageName}@${v.installedVersion} (${v.isDirect ? 'Direct' : 'Transitive'})`,
            file: v.sourceFile,
            line: v.depth || 1,
            packageName: v.packageName,
            installedVersion: v.installedVersion,
            isDirect: v.isDirect,
            depth: v.depth,
            parentPackage: v.parentPackage,
            cvssScore: v.cvssScore,
            cvssVector: v.cvssVector,
            status: v.status,
            detectedAt: v.createdAt,
            author: 'OSV / CVE Live Intelligence',
            whyItMatters: v.description || 'Known security vulnerability identified in authoritative vulnerability databases.',
            potentialImpact: `Affects ${v.isDirect ? 'direct' : 'transitive'} dependency ${v.packageName}@${v.installedVersion}.${v.cvssScore ? ` CVSS Score: ${v.cvssScore}.` : ''}`,
            affectedCode: `Dependency: ${v.packageName}@${v.installedVersion}\nCanonical ID: ${v.canonicalId}\nAliases: ${(v.aliases || []).join(', ') || 'None'}\nDependency Path: ${v.parentPackage ? `${v.parentPackage} -> ${v.packageName}` : v.packageName}\nDepth: ${v.depth} (${v.isDirect ? 'Direct' : 'Transitive'})`,
            suggestedRemediation: v.remediation || 'Upgrade package to the latest secure version.',
            references: v.advisoryReferences || []
          }));
        }
      }
    } catch (e) {
      // Fallback
    }

    // Secondary fallback to code smells if no vulnerability findings exist
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
        // Fallback
      }
    }

    return [];
  },

  /**
   * Fetches latest security scan summary & posture metrics
   */
  async getOverview(repoId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return null;

    try {
      const response = await fetch(`/api/repositories/${targetRepoId}/security`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      // Fallback
    }
    return null;
  },

  /**
   * Fetches single vulnerability detail by canonical ID or UUID
   */
  async getFindingById(id, repoId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (targetRepoId) {
      try {
        const response = await fetch(`/api/repositories/${targetRepoId}/security/vulnerabilities/${encodeURIComponent(id)}`, {
          headers: { 'Accept': 'application/json' },
          credentials: 'include',
          cache: 'no-store'
        });
        if (response.ok) {
          return await response.json();
        }
      } catch (e) {
        // Fallback
      }
    }
    const findings = await this.getFindings({ repoId });
    return findings.find(f => f.id === id || f.internalId === id) || null;
  },

  /**
   * Fetches longitudinal security posture trajectory
   */
  async getScoreHistory(repoId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return [];

    try {
      const response = await fetch(`/api/repositories/${targetRepoId}/security/trajectory`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        const data = await response.json();
        return data.trajectory || [];
      }
    } catch (e) {
      // Fallback
    }
    return [];
  },

  /**
   * Fetches dependencies annotated with vulnerability exposure
   */
  async getDependencies(repoId = null, filter = {}) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return [];

    try {
      const params = new URLSearchParams();
      if (filter.vulnerableOnly) params.set('vulnerableOnly', 'true');
      if (filter.search) params.set('search', filter.search);

      const response = await fetch(`/api/repositories/${targetRepoId}/security/dependencies?${params.toString()}`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        const data = await response.json();
        return data.dependencies || [];
      }
    } catch (e) {
      // Fallback
    }
    return [];
  }
};
