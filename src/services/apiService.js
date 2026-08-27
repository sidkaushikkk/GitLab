import { mockApiEndpoints, mockReliabilitySummary } from '../data/apiEndpointsData';

export const apiService = {
  async getEndpoints(filter = {}) {
    await new Promise(resolve => setTimeout(resolve, 60));
    let endpoints = [...mockApiEndpoints];
    if (filter.search) {
      const q = filter.search.toLowerCase();
      endpoints = endpoints.filter(e => 
        e.endpoint.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q)
      );
    }
    if (filter.method && filter.method !== 'ALL') {
      endpoints = endpoints.filter(e => e.method === filter.method);
    }
    if (filter.risk && filter.risk !== 'ALL') {
      endpoints = endpoints.filter(e => e.risk === filter.risk);
    }
    return endpoints;
  },

  async getEndpointById(id) {
    await new Promise(resolve => setTimeout(resolve, 40));
    return mockApiEndpoints.find(e => e.id === id) || null;
  },

  async getSummary() {
    await new Promise(resolve => setTimeout(resolve, 40));
    return mockReliabilitySummary;
  }
};
