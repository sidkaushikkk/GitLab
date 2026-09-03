/**
 * Parses Python source code into structured symbols, metrics, and relationships
 * @param {string} filePath - Path of the file
 * @param {string} content - Python source content
 * @returns {Object} Normalized parse result
 */
export function parsePython(filePath, content) {
  const lines = (content || '').split('\n');
  const lineCount = lines.length;
  const symbols = [
    {
      symbolType: 'FILE',
      name: filePath,
      filePath,
      startLine: 1,
      endLine: Math.max(1, lineCount)
    }
  ];
  const imports = [];
  const exportsList = [];
  const classInheritance = [];
  const functionMetrics = [];
  const calls = [];

  let currentClass = null;
  let classBaseIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const lineNum = i + 1;
    const indent = raw.search(/\S/);

    if (currentClass && indent <= classBaseIndent && !trimmed.startsWith('class ') && !trimmed.startsWith('def ')) {
      currentClass = null;
    }

    // 1. Imports
    if (trimmed.startsWith('import ')) {
      const rest = trimmed.substring(7).trim();
      const mods = rest.split(',').map(m => m.trim().split(' as ')[0].trim());
      for (const m of mods) {
        if (m) {
          imports.push({ sourceFile: filePath, targetFile: m, importedSymbols: [m], startLine: lineNum });
          symbols.push({ symbolType: 'IMPORT', name: m, filePath, startLine: lineNum, endLine: lineNum });
        }
      }
    } else if (trimmed.startsWith('from ')) {
      const match = trimmed.match(/^from\s+([\w\.\-]+)\s+import\s+(.+)$/);
      if (match) {
        const sourceMod = match[1];
        const syms = match[2].split(',').map(s => s.trim().split(' as ')[0].trim()).filter(Boolean);
        imports.push({ sourceFile: filePath, targetFile: sourceMod, importedSymbols: syms, startLine: lineNum });
        symbols.push({ symbolType: 'IMPORT', name: sourceMod, filePath, startLine: lineNum, endLine: lineNum });
      }
    }

    // 2. Class Declaration
    const classMatch = trimmed.match(/^class\s+([a-zA-Z_]\w*)(?:\(([a-zA-Z_]\w*)\))?\s*:/);
    if (classMatch) {
      const className = classMatch[1];
      const superClass = classMatch[2] || null;
      currentClass = className;
      classBaseIndent = indent;

      // Find class end line
      let endLine = lineNum;
      for (let j = i + 1; j < lines.length; j++) {
        const nextRaw = lines[j];
        const nextTrim = nextRaw.trim();
        if (!nextTrim || nextTrim.startsWith('#')) continue;
        const nextIndent = nextRaw.search(/\S/);
        if (nextIndent > indent) {
          endLine = j + 1;
        } else {
          break;
        }
      }

      symbols.push({
        symbolType: 'CLASS',
        name: className,
        filePath,
        startLine: lineNum,
        endLine,
        superClass
      });

      if (superClass) {
        classInheritance.push({
          className,
          superClassName: superClass,
          interfaces: [],
          startLine: lineNum
        });
      }
    }

    // 3. Function / Method Declaration
    const defMatch = trimmed.match(/^def\s+([a-zA-Z_]\w*)\s*\((.*?)\)\s*(?:->.*?)?:/);
    if (defMatch) {
      const fnName = defMatch[1];
      const rawParams = defMatch[2]
        .split(',')
        .map(p => p.trim().split(':')[0].split('=')[0].trim())
        .filter(p => p && p !== 'self' && p !== 'cls');
      const isMethod = Boolean(currentClass && indent > classBaseIndent);

      let endLine = lineNum;
      let complexity = 1;
      let branchCount = 0;
      let loopCount = 0;
      let conditionalCount = 0;
      let returnCount = 0;
      let callCount = 0;
      let maxNesting = 0;

      for (let j = i + 1; j < lines.length; j++) {
        const nextRaw = lines[j];
        const nextTrim = nextRaw.trim();
        if (!nextTrim || nextTrim.startsWith('#')) continue;
        const nextIndent = nextRaw.search(/\S/);

        if (nextIndent > indent) {
          endLine = j + 1;
          const nesting = Math.max(1, Math.floor((nextIndent - indent) / 4));
          if (nesting > maxNesting) maxNesting = nesting;

          if (/\b(if|elif)\b/.test(nextTrim)) {
            complexity++;
            branchCount++;
            conditionalCount++;
          }
          if (/\b(for|while)\b/.test(nextTrim)) {
            complexity++;
            loopCount++;
            branchCount++;
          }
          if (/\b(except|finally)\b/.test(nextTrim)) {
            complexity++;
            branchCount++;
          }
          if (/\band\b|\bor\b/.test(nextTrim)) {
            complexity++;
            conditionalCount++;
          }
          if (/\breturn\b/.test(nextTrim)) {
            returnCount++;
          }

          // Function & method calls
          const callMatch = nextTrim.match(/([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*\(/g);
          if (callMatch) {
            for (const cm of callMatch) {
              const callee = cm.replace(/\s*\(/, '').trim();
              if (!['if', 'for', 'while', 'print', 'range', 'len', 'enumerate', 'int', 'str', 'float', 'list', 'dict', 'set'].includes(callee)) {
                callCount++;
                calls.push({
                  callerSymbolName: fnName,
                  calleeName: callee,
                  startLine: j + 1
                });
              }
            }
          }
        } else {
          break;
        }
      }

      symbols.push({
        symbolType: isMethod ? 'METHOD' : 'FUNCTION',
        name: fnName,
        filePath,
        startLine: lineNum,
        endLine,
        params: rawParams
      });

      functionMetrics.push({
        symbolName: fnName,
        startLine: lineNum,
        endLine,
        lines: Math.max(1, endLine - lineNum + 1),
        parameterCount: rawParams.length,
        cyclomaticComplexity: complexity,
        maxNestingDepth: maxNesting,
        branchCount,
        loopCount,
        conditionalCount,
        returnCount,
        callCount
      });
    }
  }

  const functionCount = symbols.filter(s => ['FUNCTION', 'METHOD'].includes(s.symbolType)).length;
  const classCount = symbols.filter(s => s.symbolType === 'CLASS').length;

  return {
    filePath,
    language: 'python',
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
