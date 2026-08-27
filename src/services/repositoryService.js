import { mockRepositories, mockAvailableGithubRepos } from '../data/repositoriesData';

export const repositoryService = {
  // Get all repositories with optional search and filters
  async getRepositories(filter = {}) {
    await new Promise(resolve => setTimeout(resolve, 80));
    let result = [...mockRepositories];
    if (filter.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(r => 
        r.name.toLowerCase().includes(q) || 
        r.description.toLowerCase().includes(q) ||
        r.primaryLanguage.toLowerCase().includes(q)
      );
    }
    if (filter.language && filter.language !== 'All') {
      result = result.filter(r => r.primaryLanguage === filter.language);
    }
    if (filter.sortBy) {
      if (filter.sortBy === 'health') {
        result.sort((a, b) => b.metrics.healthScore - a.metrics.healthScore);
      } else if (filter.sortBy === 'security') {
        result.sort((a, b) => b.metrics.securityScore - a.metrics.securityScore);
      } else if (filter.sortBy === 'name') {
        result.sort((a, b) => a.name.localeCompare(b.name));
      }
    }
    return result;
  },

  // Get a single repository by ID
  async getRepositoryById(id) {
    await new Promise(resolve => setTimeout(resolve, 60));
    const repo = mockRepositories.find(r => r.id === id);
    if (!repo) {
      return mockRepositories[0]; // fallback to default
    }
    return repo;
  },

  // List GitHub repositories available for import
  async getAvailableGithubRepos(search = '') {
    await new Promise(resolve => setTimeout(resolve, 100));
    let repos = [...mockAvailableGithubRepos];
    if (search) {
      const q = search.toLowerCase();
      repos = repos.filter(r => 
        r.name.toLowerCase().includes(q) || 
        r.primaryLanguage.toLowerCase().includes(q)
      );
    }
    return repos;
  }
};
