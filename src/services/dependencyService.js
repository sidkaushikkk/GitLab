import { getLatestSnapshotForRepo } from './snapshotHelper';

function getActiveRepoId(repoId) {
  if (repoId && typeof repoId === 'string') return repoId;
  try {
    return localStorage.getItem('gitlab_active_repo_id') || null;
  } catch (e) {
    return null;
  }
}

function inferCategory(dep) {
  const name = (dep.name || '').toLowerCase();
  if (dep.type === 'development' || dep.type === 'peer') return 'Development Tool';
  if (name.includes('test') || name.includes('jest') || name.includes('vitest') || name.includes('mocha') || name.includes('chai')) return 'Testing Framework';
  if (name.includes('react') || name.includes('vue') || name.includes('angular') || name.includes('svelte') || name.includes('next')) return 'Frontend Framework';
  if (name.includes('express') || name.includes('fastify') || name.includes('koa') || name.includes('nest') || name.includes('flask') || name.includes('django')) return 'Web Framework';
  if (name.includes('pg') || name.includes('mysql') || name.includes('sqlite') || name.includes('redis') || name.includes('mongo') || name.includes('prisma') || name.includes('knex') || name.includes('typeorm') || name.includes('sql')) return 'Database / Storage';
  if (name.includes('auth') || name.includes('jwt') || name.includes('bcrypt') || name.includes('crypto') || name.includes('passport')) return 'Authentication & Security';
  if (name.includes('ui') || name.includes('tailwind') || name.includes('lucide') || name.includes('icon') || name.includes('chart')) return 'UI & Visualization';
  return dep.ecosystem === 'npm' ? 'NPM Package' : dep.ecosystem === 'pypi' ? 'Python Package' : 'Runtime Dependency';
}

function cleanVersion(v) {
  if (!v) return '1.0.0';
  return String(v).replace(/^[\^~>=<]+/, '').trim();
}

export const dependencyService = {
  /**
   * Fetches package dependencies for the active repository snapshot
   */
  async getDependencies(filter = {}) {
    const targetRepoId = getActiveRepoId(filter.repoId);
    if (!targetRepoId) return [];

    let secDepMap = new Map();
    try {
      const secRes = await fetch(`/api/repositories/${targetRepoId}/security/dependencies`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (secRes.ok) {
        const secData = await secRes.json();
        if (Array.isArray(secData.dependencies)) {
          for (const sd of secData.dependencies) {
            secDepMap.set((sd.name || '').toLowerCase(), sd);
          }
        }
      }
    } catch (e) {
      // Non-fatal
    }

    const snap = await getLatestSnapshotForRepo(targetRepoId);
    if (snap) {
      try {
        const response = await fetch(`/api/repositories/${targetRepoId}/snapshots/${snap.id}/analysis/dependencies`, {
          headers: { 'Accept': 'application/json' },
          credentials: 'include',
          cache: 'no-store'
        });

        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data.dependencies) && data.dependencies.length > 0) {
            let deps = data.dependencies.map((dep) => {
              const cat = inferCategory(dep);
              const manifest = data.manifests?.find(m => m.manifestPath === dep.manifestPath);
              const secInfo = secDepMap.get((dep.name || '').toLowerCase());

              // Usage count calculation from internal imports
              const importsCount = (data.internalImports || []).filter(imp =>
                (imp.targetFilePath || '').toLowerCase().includes(dep.name.toLowerCase()) ||
                (imp.symbolsImported || []).some(s => s.toLowerCase().includes(dep.name.toLowerCase()))
              ).length;

              return {
                name: dep.name,
                version: dep.version,
                latest: null,
                risk: secInfo?.maxSeverity || null,
                vulnerabilitiesCount: secInfo?.vulnerabilitiesCount || 0,
                maxSeverity: secInfo?.maxSeverity || null,
                vulnerabilities: secInfo?.vulnerabilities || [],
                usageCount: importsCount,
                license: manifest?.license || null,
                direct: dep.type === 'direct',
                category: cat,
                upgradeRecommendation: null
              };
            });

            if (filter.search) {
              const q = filter.search.toLowerCase();
              deps = deps.filter(d =>
                d.name.toLowerCase().includes(q) ||
                d.category.toLowerCase().includes(q)
              );
            }
            return deps;
          }
        }
      } catch (e) {
        // Graceful fallback
      }
    }

    return [];
  },

  /**
   * Fetches overall dependency ecosystem health summary
   */
  async getHealthOverview(repoId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (!targetRepoId) return null;

    let secOverview = null;
    try {
      const secRes = await fetch(`/api/repositories/${targetRepoId}/security`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (secRes.ok) {
        secOverview = await secRes.json();
      }
    } catch (e) {
      // Non-fatal
    }

    const snap = await getLatestSnapshotForRepo(targetRepoId);
    if (snap) {
      try {
        const response = await fetch(`/api/repositories/${targetRepoId}/snapshots/${snap.id}/analysis/dependencies`, {
          headers: { 'Accept': 'application/json' },
          credentials: 'include',
          cache: 'no-store'
        });

        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data.dependencies) && data.dependencies.length > 0) {
            const deps = data.dependencies;
            const directCount = deps.filter(d => d.type === 'direct').length;
            const transCount = deps.filter(d => d.type !== 'direct').length;

            const licenses = (data.manifests || []).map(m => m.license).filter(Boolean);
            const licenseSummary = licenses.length > 0
              ? [...new Set(licenses)].join(' / ')
              : null;

            const vulnerablePackages = secOverview?.posture?.vulnerablePackages ?? 0;
            const highRiskCount = (secOverview?.posture?.severityBreakdown?.critical || 0) + (secOverview?.posture?.severityBreakdown?.high || 0);

            return {
              total: deps.length,
              outdated: null,
              vulnerable: vulnerablePackages,
              highRisk: highRiskCount,
              licenseCompliance: licenseSummary,
              directDependencies: directCount,
              transitiveDependencies: transCount
            };
          }
        }
      } catch (e) {
        // Graceful fallback
      }
    }

    return null;
  }
};
