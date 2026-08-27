import { mockPullRequests } from '../data/pullRequestsData';

export const pullRequestService = {
  async getPullRequests(filter = {}) {
    await new Promise(resolve => setTimeout(resolve, 70));
    let prs = [...mockPullRequests];
    if (filter.search) {
      const q = filter.search.toLowerCase();
      prs = prs.filter(p => 
        p.title.toLowerCase().includes(q) ||
        p.author.name.toLowerCase().includes(q) ||
        p.author.handle.toLowerCase().includes(q)
      );
    }
    if (filter.risk && filter.risk !== 'ALL') {
      prs = prs.filter(p => p.riskLevel === filter.risk);
    }
    if (filter.status && filter.status !== 'ALL') {
      prs = prs.filter(p => p.status === filter.status);
    }
    return prs;
  },

  async getPullRequestById(id) {
    await new Promise(resolve => setTimeout(resolve, 50));
    const cleanId = id.toString().toUpperCase().replace('#', '');
    const found = mockPullRequests.find(p => p.id === cleanId || p.id === `PR-${cleanId}` || p.number.toString() === cleanId);
    return found || mockPullRequests[0];
  }
};
