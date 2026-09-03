import path from 'node:path';

/**
 * Resolves a relative import path to a normalized target file path
 * @param {string} sourceFile - Relative path of the importing file (e.g. 'src/payment.js')
 * @param {string} importPath - Import specifier (e.g. './database.js' or '../services/auth')
 * @param {Set<string>} existingFilePaths - Set of all existing file paths in repository
 * @returns {string|null} Resolved file path or normalized specifier
 */
function resolveImportPath(sourceFile, importPath, existingFilePaths) {
  if (!importPath.startsWith('.')) {
    // External or package import (e.g., 'express', 'react', 'java.util.List')
    return importPath;
  }

  const sourceDir = path.dirname(sourceFile);
  const normalizedCandidate = path.normalize(path.join(sourceDir, importPath)).replace(/\\/g, '/');

  if (existingFilePaths.has(normalizedCandidate)) {
    return normalizedCandidate;
  }

  // Check possible extensions: .js, .jsx, .ts, .tsx, .py, .java
  for (const ext of ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '/index.js']) {
    const withExt = normalizedCandidate + ext;
    if (existingFilePaths.has(withExt)) {
      return withExt;
    }
  }

  return normalizedCandidate;
}

/**
 * Extracts and normalizes relationships across all parsed repository files
 * @param {Array<Object>} parsedFiles - Array of parsed file results
 * @param {Array<Object>} allSymbols - All extracted symbols with assigned IDs
 * @returns {Object} Extracted relationships and graph metrics (fan-in, fan-out, circular dependencies)
 */
export function extractRelationships(parsedFiles, allSymbols) {
  const existingFilePaths = new Set(parsedFiles.map(f => f.filePath));
  const relationships = [];

  // Symbol lookup map: `${filePath}:${symbolName}` -> symbol
  const symbolMap = new Map();
  for (const sym of allSymbols) {
    symbolMap.set(`${sym.filePath}:${sym.name}`, sym);
  }

  // 1. Extract File IMPORTS relationships
  for (const file of parsedFiles) {
    for (const imp of file.imports) {
      const resolvedTarget = resolveImportPath(file.filePath, imp.targetFile, existingFilePaths);

      relationships.push({
        sourceSymbolId: null,
        sourceFilePath: file.filePath,
        targetSymbolId: null,
        targetFilePath: resolvedTarget,
        relationshipType: 'IMPORTS',
        symbolsImported: imp.importedSymbols
      });
    }
  }

  // 2. Extract Class EXTENDS / IMPLEMENTS relationships
  for (const file of parsedFiles) {
    for (const inh of file.classInheritance) {
      const sourceSym = symbolMap.get(`${file.filePath}:${inh.className}`);

      if (inh.superClassName) {
        // Find matching target class symbol across files or within same file
        const targetSym = Array.from(symbolMap.values()).find(
          s => s.symbolType === 'CLASS' && s.name === inh.superClassName
        );

        relationships.push({
          sourceSymbolId: sourceSym?.id || null,
          sourceFilePath: file.filePath,
          targetSymbolId: targetSym?.id || null,
          targetFilePath: targetSym?.filePath || null,
          relationshipType: 'EXTENDS',
          symbolsImported: [inh.superClassName]
        });
      }

      if (Array.isArray(inh.interfaces)) {
        for (const iface of inh.interfaces) {
          const targetSym = Array.from(symbolMap.values()).find(
            s => (s.symbolType === 'INTERFACE' || s.symbolType === 'CLASS') && s.name === iface
          );

          relationships.push({
            sourceSymbolId: sourceSym?.id || null,
            sourceFilePath: file.filePath,
            targetSymbolId: targetSym?.id || null,
            targetFilePath: targetSym?.filePath || null,
            relationshipType: 'IMPLEMENTS',
            symbolsImported: [iface]
          });
        }
      }
    }
  }

  // 3. Extract Function CALLS relationships
  for (const file of parsedFiles) {
    for (const call of file.calls) {
      const callerSym = symbolMap.get(`${file.filePath}:${call.callerSymbolName}`);

      // Try resolving target callee symbol
      let targetSym = symbolMap.get(`${file.filePath}:${call.calleeName}`);
      if (!targetSym) {
        // Search in imported symbols
        for (const imp of file.imports) {
          if (imp.importedSymbols.includes(call.calleeName) || imp.importedSymbols.includes('*')) {
            const resolvedTarget = resolveImportPath(file.filePath, imp.targetFile, existingFilePaths);
            targetSym = symbolMap.get(`${resolvedTarget}:${call.calleeName}`);
            if (targetSym) break;
          }
        }
      }

      relationships.push({
        sourceSymbolId: callerSym?.id || null,
        sourceFilePath: file.filePath,
        targetSymbolId: targetSym?.id || null,
        targetFilePath: targetSym?.filePath || null,
        relationshipType: 'CALLS',
        symbolsImported: [call.calleeName]
      });
    }
  }

  // 4. Calculate Graph Metrics (fan-in and fan-out per file and symbol)
  const fileFanIn = new Map();
  const fileFanOut = new Map();
  const symbolFanIn = new Map();
  const symbolFanOut = new Map();

  for (const f of parsedFiles) {
    fileFanIn.set(f.filePath, 0);
    fileFanOut.set(f.filePath, 0);
  }

  for (const s of allSymbols) {
    symbolFanIn.set(s.id, 0);
    symbolFanOut.set(s.id, 0);
  }

  // File adjacency list for circular dependency analysis
  const fileGraph = new Map();
  for (const f of parsedFiles) {
    fileGraph.set(f.filePath, new Set());
  }

  for (const rel of relationships) {
    // File level
    if (rel.sourceFilePath && fileFanOut.has(rel.sourceFilePath)) {
      fileFanOut.set(rel.sourceFilePath, fileFanOut.get(rel.sourceFilePath) + 1);
    }
    if (rel.targetFilePath && fileFanIn.has(rel.targetFilePath)) {
      fileFanIn.set(rel.targetFilePath, fileFanIn.get(rel.targetFilePath) + 1);
    }
    if (rel.sourceFilePath && rel.targetFilePath && rel.sourceFilePath !== rel.targetFilePath && fileGraph.has(rel.sourceFilePath)) {
      fileGraph.get(rel.sourceFilePath).add(rel.targetFilePath);
    }

    // Symbol level
    if (rel.sourceSymbolId && symbolFanOut.has(rel.sourceSymbolId)) {
      symbolFanOut.set(rel.sourceSymbolId, symbolFanOut.get(rel.sourceSymbolId) + 1);
    }
    if (rel.targetSymbolId && symbolFanIn.has(rel.targetSymbolId)) {
      symbolFanIn.set(rel.targetSymbolId, symbolFanIn.get(rel.targetSymbolId) + 1);
    }
  }

  // 5. Detect Circular Dependencies using Tarjan / DFS Cycle Detection
  let circularDependencyCount = 0;
  const visited = new Set();
  const recursionStack = new Set();

  function detectCycle(node) {
    visited.add(node);
    recursionStack.add(node);

    const neighbors = fileGraph.get(node) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (detectCycle(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        return true;
      }
    }

    recursionStack.delete(node);
    return false;
  }

  for (const node of fileGraph.keys()) {
    if (!visited.has(node)) {
      if (detectCycle(node)) {
        circularDependencyCount++;
      }
    }
  }

  return {
    relationships,
    graphMetrics: {
      fileFanIn,
      fileFanOut,
      symbolFanIn,
      symbolFanOut,
      circularDependencyCount
    }
  };
}
