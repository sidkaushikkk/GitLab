import { parseJavaScript } from './parsers/javascriptParser.js';
import { parsePython } from './parsers/pythonParser.js';
import { parseJava } from './parsers/javaParser.js';
import { logger } from '../../utils/logger.js';

/**
 * Dispatches source files to their corresponding AST parser
 * @param {Object} file - Snapshot file object { path, content, language, size }
 * @returns {Object} Normalized AST and structural analysis result
 */
export function dispatchAndParseFile(file) {
  const { path: filePath, content = '', language = '' } = file;
  const lowerLang = (language || '').toLowerCase();
  const lowerPath = filePath.toLowerCase();

  const lineCount = content ? content.split('\n').length : 0;

  try {
    // JavaScript / TypeScript / JSX
    if (
      ['javascript', 'typescript', 'jsx', 'tsx'].includes(lowerLang) ||
      lowerPath.endsWith('.js') ||
      lowerPath.endsWith('.jsx') ||
      lowerPath.endsWith('.ts') ||
      lowerPath.endsWith('.tsx') ||
      lowerPath.endsWith('.mjs') ||
      lowerPath.endsWith('.cjs')
    ) {
      return parseJavaScript(filePath, content);
    }

    // Python
    if (lowerLang === 'python' || lowerPath.endsWith('.py')) {
      return parsePython(filePath, content);
    }

    // Java
    if (lowerLang === 'java' || lowerPath.endsWith('.java')) {
      return parseJava(filePath, content);
    }

    // Controlled unsupported status for languages without an AST parser in this checkpoint
    return {
      filePath,
      language: lowerLang || 'unsupported',
      status: 'unsupported',
      lineCount,
      symbols: [
        {
          symbolType: 'FILE',
          name: filePath,
          filePath,
          startLine: 1,
          endLine: Math.max(1, lineCount)
        }
      ],
      imports: [],
      exports: [],
      calls: [],
      classInheritance: [],
      functionMetrics: [],
      fileMetrics: {
        physicalLines: lineCount,
        logicalLines: lineCount,
        functionCount: 0,
        classCount: 0,
        importCount: 0,
        exportCount: 0,
        commentCount: 0
      }
    };
  } catch (err) {
    logger.warn({ filePath, err: err.message }, 'Dispatcher caught unexpected parser exception');
    return {
      filePath,
      language: lowerLang || 'unknown',
      status: 'parse_failed',
      lineCount,
      error: err.message,
      symbols: [
        {
          symbolType: 'FILE',
          name: filePath,
          filePath,
          startLine: 1,
          endLine: Math.max(1, lineCount)
        }
      ],
      imports: [],
      exports: [],
      calls: [],
      classInheritance: [],
      functionMetrics: [],
      fileMetrics: {
        physicalLines: lineCount,
        logicalLines: 0,
        functionCount: 0,
        classCount: 0,
        importCount: 0,
        exportCount: 0,
        commentCount: 0
      }
    };
  }
}
