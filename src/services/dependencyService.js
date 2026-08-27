import { mockDependencies, mockDependencyHealth } from '../data/dependenciesData';

export const dependencyService = {
  async getDependencies(filter = {}) {
    await new Promise(resolve => setTimeout(resolve, 60));
    let deps = [...mockDependencies];
    if (filter.search) {
      const q = filter.search.toLowerCase();
      deps = deps.filter(d => 
        d.name.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        d.vulnerability.toLowerCase().includes(q)
      );
    }
    if (filter.risk && filter.risk !== 'ALL') {
      deps = deps.filter(d => d.risk === filter.risk);
    }
    if (filter.onlyVulnerable) {
      deps = deps.filter(d => d.vulnerabilitySeverity !== 'LOW');
    }
    return deps;
  },

  async getHealthOverview() {
    await new Promise(resolve => setTimeout(resolve, 40));
    return mockDependencyHealth;
  }
};
