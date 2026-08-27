import { mockFileTree, mockFileContents } from '../data/filesData';

export const codeService = {
  async getFileTree() {
    await new Promise(resolve => setTimeout(resolve, 40));
    return mockFileTree;
  },

  async getFileContent(filePath = 'src/auth/AuthService.ts') {
    await new Promise(resolve => setTimeout(resolve, 50));
    if (mockFileContents[filePath]) {
      return mockFileContents[filePath];
    }
    // Return generic fallback content for unmocked files
    return {
      path: filePath,
      language: filePath.endsWith('.json') ? 'json' : 'typescript',
      linesCount: 22,
      issues: [],
      content: `// ${filePath}
// Source file loaded from repository index
export function initializeModule() {
  console.log('Module initialized: ${filePath}');
  return true;
}`
    };
  }
};
