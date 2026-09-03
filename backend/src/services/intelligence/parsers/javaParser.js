import { parse } from 'java-parser';

/**
 * Collect all leaf tokens from a CST node
 */
function getTokens(node, results = []) {
  if (!node) return results;
  if (node.image && node.startLine) {
    results.push(node);
  }
  if (node.children) {
    for (const key of Object.keys(node.children)) {
      for (const item of node.children[key]) {
        getTokens(item, results);
      }
    }
  }
  return results;
}

/**
 * Find all CST nodes matching a given name
 */
function findNodes(node, targetName, results = []) {
  if (!node) return results;
  if (node.name === targetName) {
    results.push(node);
  }
  if (node.children) {
    for (const key of Object.keys(node.children)) {
      for (const item of node.children[key]) {
        findNodes(item, targetName, results);
      }
    }
  }
  return results;
}

/**
 * Calculate max nesting depth in a method CST node
 */
function calculateNestingDepth(node, currentDepth = 0) {
  if (!node) return 0;
  let maxDepth = currentDepth;

  const isNesting = [
    'ifStatement',
    'forStatement',
    'enhancedForStatement',
    'whileStatement',
    'doStatement',
    'switchStatement',
    'tryStatement',
    'catchClause',
    'block'
  ].includes(node.name);

  const nextDepth = isNesting ? currentDepth + 1 : currentDepth;
  if (nextDepth > maxDepth) {
    maxDepth = nextDepth;
  }

  if (node.children) {
    for (const key of Object.keys(node.children)) {
      for (const item of node.children[key]) {
        const childDepth = calculateNestingDepth(item, nextDepth);
        if (childDepth > maxDepth) {
          maxDepth = childDepth;
        }
      }
    }
  }

  return maxDepth;
}

/**
 * Calculate metrics for a Java method CST node
 */
function calculateJavaMethodMetrics(methodNode, methodName) {
  let cyclomaticComplexity = 1;
  let branchCount = 0;
  let loopCount = 0;
  let conditionalCount = 0;
  let returnCount = 0;
  let callCount = 0;

  function visit(node) {
    if (!node) return;

    switch (node.name) {
      case 'ifStatement':
        cyclomaticComplexity++;
        branchCount++;
        conditionalCount++;
        break;
      case 'forStatement':
      case 'enhancedForStatement':
      case 'whileStatement':
      case 'doStatement':
        cyclomaticComplexity++;
        loopCount++;
        branchCount++;
        break;
      case 'catchClause':
        cyclomaticComplexity++;
        branchCount++;
        break;
      case 'switchLabel':
        // Case statements count towards complexity
        cyclomaticComplexity++;
        branchCount++;
        break;
      case 'conditionalExpression':
        if (node.children?.QuestionMark) {
          cyclomaticComplexity++;
          conditionalCount++;
          branchCount++;
        }
        break;
      case 'methodInvocationSuffix':
        callCount++;
        break;
      case 'returnStatement':
        returnCount++;
        break;
      default:
        break;
    }

    if (node.children) {
      for (const key of Object.keys(node.children)) {
        for (const item of node.children[key]) {
          visit(item);
        }
      }
    }
  }

  visit(methodNode);

  const tokens = getTokens(methodNode);
  const startLine = tokens.length > 0 ? tokens[0].startLine : 1;
  const endLine = tokens.length > 0 ? tokens[tokens.length - 1].endLine : startLine;
  const maxNestingDepth = calculateNestingDepth(methodNode, 0);

  // Extract parameter count
  let parameterCount = 0;
  const formalParamLists = findNodes(methodNode, 'formalParameterList');
  if (formalParamLists.length > 0) {
    const formalParams = findNodes(formalParamLists[0], 'formalParameter');
    parameterCount = formalParams.length;
  }

  return {
    symbolName: methodName,
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
 * Parses Java source code into structured AST symbols, metrics, and relationships
 * @param {string} filePath - Path of the file
 * @param {string} content - Java source code
 * @returns {Object} Normalized parse result
 */
export function parseJava(filePath, content) {
  const lineCount = content ? content.split('\n').length : 0;
  const symbols = [];
  const imports = [];
  const exportsList = [];
  const calls = [];
  const classInheritance = [];
  const functionMetrics = [];

  let cst;
  try {
    cst = parse(content || '');
  } catch (err) {
    return {
      filePath,
      language: 'java',
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

  // 1. Imports
  const importDecls = findNodes(cst, 'importDeclaration');
  for (const imp of importDecls) {
    const tokens = getTokens(imp);
    const impTokens = tokens.filter(t => t.image !== 'import' && t.image !== 'static' && t.image !== ';');
    const importedPath = impTokens.map(t => t.image).join('');
    const parts = importedPath.split('.');
    const lastSymbol = parts[parts.length - 1];

    imports.push({
      sourceFile: filePath,
      targetFile: importedPath,
      importedSymbols: [lastSymbol],
      startLine: tokens[0]?.startLine || 1
    });

    symbols.push({
      symbolType: 'IMPORT',
      name: importedPath,
      filePath,
      startLine: tokens[0]?.startLine || 1,
      endLine: tokens[tokens.length - 1]?.endLine || 1
    });
  }

  // 2. Class Declarations
  const classDecls = findNodes(cst, 'normalClassDeclaration');
  for (const cls of classDecls) {
    const classId = cls.children.typeIdentifier?.[0]?.children?.Identifier?.[0]?.image || 'AnonymousClass';
    const tokens = getTokens(cls);
    const startLine = tokens[0]?.startLine || 1;
    const endLine = tokens[tokens.length - 1]?.endLine || startLine;

    // Superclass
    let superClassName = null;
    if (cls.children.classExtends) {
      const superTokens = getTokens(cls.children.classExtends[0]);
      const superToken = superTokens.find(t => t.image !== 'extends');
      if (superToken) {
        superClassName = superToken.image;
      }
    }

    // Interfaces
    const interfaces = [];
    if (cls.children.classImplements) {
      const ifaceTokens = getTokens(cls.children.classImplements[0]).filter(t => t.image !== 'implements' && t.image !== ',');
      interfaces.push(...ifaceTokens.map(t => t.image));
    }

    symbols.push({
      symbolType: 'CLASS',
      name: classId,
      filePath,
      startLine,
      endLine,
      superClass: superClassName,
      interfaces
    });

    if (superClassName || interfaces.length > 0) {
      classInheritance.push({
        className: classId,
        superClassName,
        interfaces,
        startLine
      });
    }
  }

  // 3. Method Declarations
  const methodDecls = findNodes(cst, 'methodDeclaration');
  for (const method of methodDecls) {
    const methodHeader = method.children.methodHeader?.[0];
    const methodName = methodHeader?.children?.methodDeclarator?.[0]?.children?.Identifier?.[0]?.image || 'anonymous';
    const tokens = getTokens(method);
    const startLine = tokens[0]?.startLine || 1;
    const endLine = tokens[tokens.length - 1]?.endLine || startLine;

    symbols.push({
      symbolType: 'METHOD',
      name: methodName,
      filePath,
      startLine,
      endLine
    });

    const metrics = calculateJavaMethodMetrics(method, methodName);
    functionMetrics.push(metrics);

    // Find invocations inside this method
    const primaries = findNodes(method, 'primary');
    for (const prim of primaries) {
      const suffixes = findNodes(prim, 'methodInvocationSuffix');
      if (suffixes.length > 0) {
        const tokens = getTokens(prim);
        const callee = tokens[0]?.image;
        if (callee) {
          calls.push({
            callerSymbolName: methodName,
            calleeName: callee,
            startLine: tokens[0].startLine || startLine
          });
        }
      }
    }
  }

  // 4. Constructor Declarations
  const constructorDecls = findNodes(cst, 'constructorDeclaration');
  for (const ctor of constructorDecls) {
    const tokens = getTokens(ctor);
    const ctorName = ctor.children.constructorDeclarator?.[0]?.children?.simpleTypeName?.[0]?.children?.Identifier?.[0]?.image || 'constructor';
    const startLine = tokens[0]?.startLine || 1;
    const endLine = tokens[tokens.length - 1]?.endLine || startLine;

    symbols.push({
      symbolType: 'CONSTRUCTOR',
      name: ctorName,
      filePath,
      startLine,
      endLine
    });

    const metrics = calculateJavaMethodMetrics(ctor, ctorName);
    functionMetrics.push(metrics);
  }

  const functionCount = symbols.filter(s => ['METHOD', 'CONSTRUCTOR'].includes(s.symbolType)).length;
  const classCount = symbols.filter(s => s.symbolType === 'CLASS').length;

  return {
    filePath,
    language: 'java',
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
      logicalLines: lineCount,
      functionCount,
      classCount,
      importCount: imports.length,
      exportCount: exportsList.length,
      commentCount: 0
    }
  };
}
