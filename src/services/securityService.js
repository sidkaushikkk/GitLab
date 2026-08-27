import { mockSecurityFindings, mockSecurityScoreHistory } from '../data/securityData';

export const securityService = {
  async getFindings(filter = {}) {
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

  async getFindingById(id) {
    await new Promise(resolve => setTimeout(resolve, 50));
    return mockSecurityFindings.find(f => f.id === id) || null;
  },

  async getScoreHistory() {
    await new Promise(resolve => setTimeout(resolve, 50));
    return mockSecurityScoreHistory;
  }
};
