import { getLatestSnapshotForRepo } from './snapshotHelper';
import { layoutLayered } from '../components/graph/graphLayout';

function getActiveRepoId(repoId) {
  if (repoId && typeof repoId === 'string') return repoId;
  try {
    return localStorage.getItem('gitlab_active_repo_id') || null;
  } catch (e) {
    return null;
  }
}

function inferNodeTypeAndLayer(filePath) {
  const lower = (filePath || '').toLowerCase();
  if (lower.includes('database') || lower.includes('db') || lower.includes('pool') || lower.includes('redis') || lower.includes('sql')) {
    return { type: 'database', layer: 'Data Storage' };
  }
  if (lower.includes('auth') || lower.includes('session') || lower.includes('token') || lower.includes('security')) {
    return { type: 'service', layer: 'Authentication' };
  }
  if (lower.includes('api') || lower.includes('route') || lower.includes('controller') || lower.includes('webhook')) {
    return { type: 'controller', layer: 'API Gateway' };
  }
  if (lower.endsWith('server.js') || lower.endsWith('app.js') || lower.endsWith('main.jsx') || lower.endsWith('index.js')) {
    return { type: 'entrypoint', layer: 'Application Root' };
  }
  if (!lower.includes('/') && !lower.includes('.')) {
    return { type: 'external', layer: 'External Service' };
  }
  return { type: 'service', layer: 'Core Business' };
}

export const codeGraphService = {
  /**
   * Get architecture and dependency graph data from backend or fallback to mock
   */
  async getGraphData(repoId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (targetRepoId) {
      const snap = await getLatestSnapshotForRepo(targetRepoId);
      if (snap) {
        try {
          const response = await fetch(`/api/repositories/${targetRepoId}/snapshots/${snap.id}/analysis/graph`, {
            headers: { 'Accept': 'application/json' },
            credentials: 'include',
            cache: 'no-store'
          });

          if (response.ok) {
            const rawGraph = await response.json();
            if (Array.isArray(rawGraph.nodes) && rawGraph.nodes.length > 0) {
              const rawNodes = rawGraph.nodes.map(node => {
                const { type, layer } = inferNodeTypeAndLayer(node.label || node.id);
                return {
                  id: node.id,
                  label: node.label || node.id,
                  type,
                  layer,
                  complexity: 'Medium',
                  risk: 'LOW',
                  loc: 100,
                  description: `Architectural node ${node.label || node.id} with live extracted relationships.`
                };
              });

              const edges = (rawGraph.edges || [])
                .filter(e => e.source && e.target)
                .map((e, idx) => ({
                  id: `edge-${idx + 1}`,
                  from: e.source,
                  to: e.target,
                  label: (e.type || 'imports').toLowerCase()
                }));

              const nodes = layoutLayered(rawNodes, edges);

              return { nodes, edges };
            }
          }
        } catch (err) {
          // Fallback
        }
      }
    }

    return { nodes: [], edges: [] };
  }
};
