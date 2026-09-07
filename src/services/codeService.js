import { mockFileTree, mockFileContents } from '../data/filesData';
import { getLatestSnapshotForRepo, getSnapshotPayload } from './snapshotHelper';

function getActiveRepoId(repoId) {
  if (repoId && typeof repoId === 'string') return repoId;
  try {
    return localStorage.getItem('gitlab_active_repo_id') || null;
  } catch (e) {
    return null;
  }
}

/**
 * Builds a nested file tree from flat array of snapshot file objects
 */
function buildFileTreeFromFiles(files, smells = []) {
  const root = [];
  const map = {};

  const fileSmellCount = {};
  for (const s of smells) {
    fileSmellCount[s.filePath] = (fileSmellCount[s.filePath] || 0) + 1;
  }

  for (const file of files) {
    const parts = file.path.split('/');
    let currentPath = '';
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (isFile) {
        const issuesCount = fileSmellCount[file.path] || 0;
        currentLevel.push({
          name: part,
          type: 'file',
          path: file.path,
          language: file.language || 'text',
          size: file.size ? `${(file.size / 1024).toFixed(1)} KB` : '1.0 KB',
          issuesCount,
          hasSecurityIssue: issuesCount > 0
        });
      } else {
        if (!map[currentPath]) {
          const dirNode = {
            name: part,
            type: 'directory',
            path: currentPath,
            children: []
          };
          map[currentPath] = dirNode;
          currentLevel.push(dirNode);
        }
        currentLevel = map[currentPath].children;
      }
    }
  }

  return root;
}

export const codeService = {
  /**
   * Get hierarchical file tree from backend snapshot or fallback to mock
   */
  async getFileTree(repoId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (targetRepoId) {
      const snap = await getLatestSnapshotForRepo(targetRepoId);
      if (snap) {
        const payload = await getSnapshotPayload(targetRepoId, snap.id);
        if (payload && Array.isArray(payload.files) && payload.files.length > 0) {
          // Fetch smells to badge files
          let smells = [];
          try {
            const smellRes = await fetch(`/api/repositories/${targetRepoId}/snapshots/${snap.id}/analysis/smells?limit=100`, {
              headers: { 'Accept': 'application/json' },
              credentials: 'include'
            });
            if (smellRes.ok) {
              const data = await smellRes.json();
              smells = data.smells || [];
            }
          } catch (e) {
            // Ignore
          }
          return buildFileTreeFromFiles(payload.files, smells);
        }
      }
    }

    return mockFileTree;
  },

  /**
   * Get file content and per-line diagnostics from backend snapshot or fallback to mock
   */
  async getFileContent(filePath = 'src/auth/AuthService.ts', repoId = null) {
    const targetRepoId = getActiveRepoId(repoId);
    if (targetRepoId) {
      const snap = await getLatestSnapshotForRepo(targetRepoId);
      if (snap) {
        const payload = await getSnapshotPayload(targetRepoId, snap.id);
        if (payload && Array.isArray(payload.files)) {
          const file = payload.files.find(f => f.path === filePath);
          if (file) {
            // Fetch any diagnostic code smells for this file
            let issues = [];
            try {
              const smellRes = await fetch(`/api/repositories/${targetRepoId}/snapshots/${snap.id}/analysis/smells?filePath=${encodeURIComponent(filePath)}`, {
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
              });
              if (smellRes.ok) {
                const data = await smellRes.json();
                issues = (data.smells || []).map(s => ({
                  line: s.line || 1,
                  type: 'maintainability',
                  severity: (s.severity || 'medium').toUpperCase(),
                  title: s.ruleId,
                  message: s.message
                }));
              }
            } catch (e) {
              // Ignore
            }

            // Fetch file metrics (complexity, max nesting, etc.)
            let fileMetrics = null;
            try {
              const metricRes = await fetch(`/api/repositories/${targetRepoId}/snapshots/${snap.id}/analysis/metrics?filePath=${encodeURIComponent(filePath)}`, {
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
              });
              if (metricRes.ok) {
                const mData = await metricRes.json();
                fileMetrics = mData.metrics?.[0] || null;
              }
            } catch (e) {
              // Ignore
            }

            return {
              path: file.path,
              language: file.language || 'typescript',
              linesCount: (file.content || '').split('\n').length,
              issues,
              metrics: fileMetrics ? {
                complexity: fileMetrics.complexity,
                maxNestingDepth: fileMetrics.maxNestingDepth,
                debtScore: fileMetrics.debtScore
              } : null,
              content: file.content || ''
            };
          }
        }
      }
    }

    // Fallback to mock contents if available
    if (mockFileContents[filePath]) {
      return mockFileContents[filePath];
    }

    return {
      path: filePath,
      language: filePath.endsWith('.json') ? 'json' : 'typescript',
      linesCount: 22,
      issues: [],
      content: `// ${filePath}\n// Source file loaded from repository index\nexport function initializeModule() {\n  console.log('Module initialized: ${filePath}');\n  return true;\n}`
    };
  }
};
