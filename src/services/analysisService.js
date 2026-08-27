import { mockHealthTrends, mockRiskHotspots, mockRecentActivities, mockComplexityDistribution, mockCodeHealthFiles } from '../data/metricsData';

export const analysisService = {
  // Get health history trends for a repository
  async getHealthTrends(repoId = 'payment-service') {
    await new Promise(resolve => setTimeout(resolve, 60));
    return mockHealthTrends[repoId] || mockHealthTrends['payment-service'];
  },

  // Get risk hotspots
  async getRiskHotspots(repoId = 'payment-service') {
    await new Promise(resolve => setTimeout(resolve, 60));
    return mockRiskHotspots[repoId] || mockRiskHotspots['payment-service'];
  },

  // Get recent activities
  async getRecentActivities(repoId = 'payment-service') {
    await new Promise(resolve => setTimeout(resolve, 50));
    return mockRecentActivities[repoId] || mockRecentActivities['payment-service'];
  },

  // Get complexity distribution
  async getComplexityDistribution() {
    await new Promise(resolve => setTimeout(resolve, 50));
    return mockComplexityDistribution;
  },

  // Get code health files table
  async getCodeHealthFiles(filter = {}) {
    await new Promise(resolve => setTimeout(resolve, 70));
    let files = [...mockCodeHealthFiles];
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
