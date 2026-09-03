import * as babelParser from '@babel/parser';
import _traverse from '@babel/traverse';

// ESM compatibility for @babel/traverse
const traverse = _traverse.default || _traverse;

/**
 * Calculates max nesting depth inside an AST node
 */
function calculateNestingDepth(rootNode) {
  let maxDepth = 0;

  function visit(node, currentDepth) {
    if (!node || typeof node !== 'object') return;

    // Do not descend into nested function declarations (they have their own metrics)
    if (node !== rootNode && [
      'FunctionDeclaration',
      'FunctionExpression',
      'ArrowFunctionExpression'
    ].includes(node.type)) {
      return;
    }

    const isNestingConstruct = [
      'IfStatement',
      'ForStatement',
      'ForInStatement',
      'ForOfStatement',
      'WhileStatement',
      'DoWhileStatement',
      'SwitchStatement',
      'TryStatement',
      'CatchClause'
    ].includes(node.type);

    const nextDepth = isNestingConstruct ? currentDepth + 1 : currentDepth;
    if (nextDepth > maxDepth) {
      maxDepth = nextDepth;
    }

    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'loc') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item.type === 'string') {
            visit(item, nextDepth);
          }
        }
      } else if (child && typeof child.type === 'string') {
        visit(child, nextDepth);
      }
    }
  }

  // Count relative depth starting from 0 inside the function body
  if (rootNode.body) {
    visit(rootNode.body, 0);
  }

  return maxDepth;
}

/**
 * Calculates cyclomatic complexity and control flow counts for a function AST node
 */
function calculateFunctionMetrics(fnNode, lines, callerName) {
  let cyclomaticComplexity = 1; // Base complexity
  let branchCount = 0;
  let loopCount = 0;
  let conditionalCount = 0;
  let returnCount = 0;
  let callCount = 0;

  function visit(node) {
    if (!node || typeof node !== 'object') return;

    // Do not descend into nested function declarations (they have their own metrics)
    if (node !== fnNode && [
      'FunctionDeclaration',
      'FunctionExpression',
      'ArrowFunctionExpression'
    ].includes(node.type)) {
      return;
    }

    switch (node.type) {
      case 'IfStatement':
        cyclomaticComplexity++;
        branchCount++;
        conditionalCount++;
        break;
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
        cyclomaticComplexity++;
        loopCount++;
        branchCount++;
        break;
      case 'CatchClause':
        cyclomaticComplexity++;
        branchCount++;
        break;
      case 'SwitchCase':
        if (node.test !== null) { // Not the default case
          cyclomaticComplexity++;
          branchCount++;
        }
        break;
      case 'ConditionalExpression': // ternary ? :
        cyclomaticComplexity++;
        conditionalCount++;
        branchCount++;
        break;
      case 'LogicalExpression':
        if (node.operator === '&&' || node.operator === '||' || node.operator === '??') {
          cyclomaticComplexity++;
          conditionalCount++;
        }
        break;
      case 'ReturnStatement':
        returnCount++;
        break;
      case 'CallExpression':
        callCount++;
        break;
      default:
        break;
    }

    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'loc') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item.type === 'string') {
            visit(item);
          }
        }
      } else if (child && typeof child.type === 'string') {
        visit(child);
      }
    }
  }

  if (fnNode.body) {
    visit(fnNode.body);
  }

  const startLine = fnNode.loc ? fnNode.loc.start.line : 1;
  const endLine = fnNode.loc ? fnNode.loc.end.line : startLine;
  const maxNestingDepth = calculateNestingDepth(fnNode);
  const parameterCount = Array.isArray(fnNode.params) ? fnNode.params.length : 0;

  return {
    symbolName: callerName,
    startLine,
    endLine,
    lines: Math.max(1, endLine - startLine + 1),
    parameterCount,
    cyclomaticComplexity,
    maxNestingDepth,
    branchCount,
    loopCount,
    conditionalCount,
    returnCount,
    callCount
  };
}

/**
 * Extracts helper for callee name
 */
function getCalleeName(calleeNode) {
  if (!calleeNode) return null;
  if (calleeNode.type === 'Identifier') {
    return calleeNode.name;
  }
  if (calleeNode.type === 'MemberExpression') {
    const objectName = getCalleeName(calleeNode.object);
    const propertyName = calleeNode.property?.name || (calleeNode.property?.value ? String(calleeNode.property.value) : null);
    if (objectName && propertyName) {
      return `${objectName}.${propertyName}`;
    }
    return propertyName || objectName;
  }
  return null;
}

/**
 * Parses JavaScript/JSX code into structured AST symbols, metrics, and relationships
 * @param {string} filePath - Path of the file
 * @param {string} content - Source code content
 * @returns {Object} Normalized parse result
 */
export function parseJavaScript(filePath, content) {
  const lineCount = content ? content.split('\n').length : 0;
  const symbols = [];
  const imports = [];
  const exportsList = [];
  const calls = [];
  const classInheritance = [];
  const functionMetrics = [];

  let ast;
  try {
    ast = babelParser.parse(content || '', {
      sourceType: 'unambiguous',
      plugins: [
        'jsx',
        'typescript',
        'asyncGenerators',
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'decorators-legacy',
        'dynamicImport',
        'exportDefaultFrom',
        'exportNamespaceFrom',
        'nullishCoalescingOperator',
        'optionalChaining',
        'topLevelAwait'
      ],
      tokens: true,
      errorRecovery: true
    });
  } catch (err) {
    return {
      filePath,
      language: 'javascript',
      status: 'parse_failed',
      lineCount,
      error: err.message,
      symbols: [],
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

  // Add FILE symbol
  symbols.push({
    symbolType: 'FILE',
    name: filePath,
    filePath,
    startLine: 1,
    endLine: Math.max(1, lineCount)
  });

  // Track active function/method scope for call relationship attribution
  let currentFunctionScope = null;

  traverse(ast, {
    // 1. ES Imports
    ImportDeclaration(path) {
      const sourceFile = path.node.source.value;
      const importedSymbols = path.node.specifiers.map(spec => {
        if (spec.type === 'ImportDefaultSpecifier') return 'default';
        if (spec.type === 'ImportNamespaceSpecifier') return '*';
        return spec.imported?.name || spec.local.name;
      });

      imports.push({
        sourceFile: filePath,
        targetFile: sourceFile,
        importedSymbols,
        startLine: path.node.loc ? path.node.loc.start.line : 1
      });

      symbols.push({
        symbolType: 'IMPORT',
        name: sourceFile,
        filePath,
        startLine: path.node.loc ? path.node.loc.start.line : 1,
        endLine: path.node.loc ? path.node.loc.end.line : 1
      });
    },

    // 2. ES Exports
    ExportNamedDeclaration(path) {
      if (path.node.declaration) {
        if (path.node.declaration.declarations) {
          path.node.declaration.declarations.forEach(d => {
            if (d.id?.name) {
              exportsList.push({ name: d.id.name, isDefault: false, startLine: path.node.loc?.start.line || 1 });
            }
          });
        } else if (path.node.declaration.id?.name) {
          exportsList.push({ name: path.node.declaration.id.name, isDefault: false, startLine: path.node.loc?.start.line || 1 });
        }
      } else if (path.node.specifiers) {
        path.node.specifiers.forEach(s => {
          exportsList.push({ name: s.exported.name, isDefault: false, startLine: path.node.loc?.start.line || 1 });
        });
      }
    },

    ExportDefaultDeclaration(path) {
      const name = path.node.declaration?.id?.name || path.node.declaration?.name || 'default';
      exportsList.push({ name, isDefault: true, startLine: path.node.loc?.start.line || 1 });
      symbols.push({
        symbolType: 'EXPORT',
        name,
        filePath,
        startLine: path.node.loc ? path.node.loc.start.line : 1,
        endLine: path.node.loc ? path.node.loc.end.line : 1
      });
    },

    // 3. Class Declarations
    ClassDeclaration(path) {
      const className = path.node.id?.name || 'AnonymousClass';
      const startLine = path.node.loc?.start.line || 1;
      const endLine = path.node.loc?.end.line || startLine;
      const superClassName = path.node.superClass?.name || null;

      symbols.push({
        symbolType: 'CLASS',
        name: className,
        filePath,
        startLine,
        endLine,
        superClass: superClassName
      });

      if (superClassName) {
        classInheritance.push({
          className,
          superClassName,
          interfaces: [],
          startLine
        });
      }
    },

    // 4. Function Declarations
    FunctionDeclaration(path) {
      const fnName = path.node.id?.name || 'anonymous';
      const startLine = path.node.loc?.start.line || 1;
      const endLine = path.node.loc?.end.line || startLine;

      symbols.push({
        symbolType: 'FUNCTION',
        name: fnName,
        filePath,
        startLine,
        endLine,
        params: path.node.params.map(p => p.name || p.type)
      });

      const metrics = calculateFunctionMetrics(path.node, lineCount, fnName);
      functionMetrics.push(metrics);
    },

    // 5. Arrow Functions & Function Expressions assigned to variables
    VariableDeclarator(path) {
      // Check for CommonJS require: const db = require('./database.js');
      if (path.node.init && path.node.init.type === 'CallExpression' && path.node.init.callee?.name === 'require') {
        const arg = path.node.init.arguments[0];
        if (arg && arg.type === 'StringLiteral') {
          imports.push({
            sourceFile: filePath,
            targetFile: arg.value,
            importedSymbols: [path.node.id.name || '*'],
            startLine: path.node.loc?.start.line || 1
          });
        }
      }

      if (path.node.init && ['ArrowFunctionExpression', 'FunctionExpression'].includes(path.node.init.type)) {
        const fnName = path.node.id?.name || 'anonymous';
        const startLine = path.node.init.loc?.start.line || path.node.loc?.start.line || 1;
        const endLine = path.node.init.loc?.end.line || path.node.loc?.end.line || startLine;

        symbols.push({
          symbolType: 'FUNCTION',
          name: fnName,
          filePath,
          startLine,
          endLine,
          params: path.node.init.params.map(p => p.name || p.type)
        });

        const metrics = calculateFunctionMetrics(path.node.init, lineCount, fnName);
        functionMetrics.push(metrics);
      }
    },

    // 6. Class Methods
    ClassMethod(path) {
      const methodName = path.node.key?.name || (path.node.kind === 'constructor' ? 'constructor' : 'method');
      const startLine = path.node.loc?.start.line || 1;
      const endLine = path.node.loc?.end.line || startLine;

      symbols.push({
        symbolType: path.node.kind === 'constructor' ? 'CONSTRUCTOR' : 'METHOD',
        name: methodName,
        filePath,
        startLine,
        endLine,
        params: path.node.params.map(p => p.name || p.type)
      });

      const metrics = calculateFunctionMetrics(path.node, lineCount, methodName);
      functionMetrics.push(metrics);
    },

    // 7. Call Expressions
    CallExpression: {
      enter(path) {
        const calleeName = getCalleeName(path.node.callee);
        if (calleeName && calleeName !== 'require') {
          // Find enclosing function / method scope
          const enclosingFn = path.getFunctionParent();
          let callerName = 'global';
          if (enclosingFn) {
            if (enclosingFn.node.id?.name) {
              callerName = enclosingFn.node.id.name;
            } else if (enclosingFn.parent?.id?.name) {
              callerName = enclosingFn.parent.id.name;
            } else if (enclosingFn.node.key?.name) {
              callerName = enclosingFn.node.key.name;
            }
          }

          calls.push({
            callerSymbolName: callerName,
            calleeName,
            startLine: path.node.loc?.start.line || 1
          });
        }
      }
    }
  });

  const commentCount = Array.isArray(ast.comments) ? ast.comments.length : 0;
  const functionCount = symbols.filter(s => ['FUNCTION', 'METHOD', 'CONSTRUCTOR'].includes(s.symbolType)).length;
  const classCount = symbols.filter(s => s.symbolType === 'CLASS').length;

  return {
    filePath,
    language: 'javascript',
    status: 'analyzed',
    lineCount,
    symbols,
    imports,
    exports: exportsList,
    calls,
    classInheritance,
    functionMetrics,
    fileMetrics: {
      physicalLines: lineCount,
      logicalLines: Math.max(1, lineCount - commentCount),
      functionCount,
      classCount,
      importCount: imports.length,
      exportCount: exportsList.length,
      commentCount
    }
  };
}
