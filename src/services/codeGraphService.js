import { mockCodeGraph } from '../data/codeGraphData';

export const codeGraphService = {
  async getGraphData() {
    await new Promise(resolve => setTimeout(resolve, 60));
    return mockCodeGraph;
  }
};
