/**
 * AST Impact Mapping Service
 * Maps unified diff changed line ranges to touched AST entities across base and head snapshots.
 * Uses existing AST parsing infrastructure from dispatcher.js.
 */

import { dispatchAndParseFile } from './dispatcher.js';

/**
 * Checks if two 1-indexed intervals [start1, end1] and [start2, end2] overlap
 * @param {{ start: number, end: number }} r1
 * @param {{ start: number, end: number }} r2
 * @returns {boolean}
 */
function rangesOverlap(r1, r2) {
  return Math.max(r1.start, r2.start) <= Math.min(r1.end, r2.end);
}

/**
 * Checks if a symbol's range overlaps with any range in an array of diff ranges
 * @param {{ startLine: number, endLine: number }} symbolRange
 * @param {Array<{ start: number, end: number }>} diffRanges
 * @returns {Array<{ start: number, end: number }>} Matching overlapping ranges
 */
function findOverlappingRanges(symbolRange, diffRanges) {
  const overlaps = [];
  const sRange = { start: symbolRange.startLine, end: symbolRange.endLine };
  for (const dr of diffRanges) {
    if (rangesOverlap(sRange, dr)) {
      overlaps.push(dr);
    }
  }
  return overlaps;
}

/**
 * Extracts normalized symbols and file metrics from raw content or pre-parsed file
 * @param {Object} fileObj - { filePath, path, content, language, symbols, ... }
 * @returns {Object} { filePath, symbols: Array, lineCount: number }
 */
function normalizeParsedFile(fileObj) {
  if (!fileObj) return null;
  const filePath = fileObj.filePath || fileObj.path;

  // If already parsed
  if (Array.isArray(fileObj.symbols)) {
    return {
      filePath,
      symbols: fileObj.symbols,
      lineCount: fileObj.lineCount || fileObj.symbols.reduce((max, s) => Math.max(max, s.endLine || 1), 1)
    };
  }

  // Parse using existing production AST dispatcher
  const parsed = dispatchAndParseFile({
    path: filePath,
    content: fileObj.content || '',
    language: fileObj.language || ''
  });

  return {
    filePath,
    symbols: parsed.symbols || [],
    lineCount: parsed.lineCount || 1
  };
}

/**
 * Generates a unique key for an AST symbol within a file
 * @param {Object} s
 * @returns {string}
 */
function getSymbolKey(s) {
  return `${s.symbolType}:${s.name}`;
}

/**
 * Maps unified diff line ranges to AST entities
 * @param {Object} options
 * @param {Object} options.parsedDiff - Output of parseUnifiedDiff(diffText)
 * @param {Array<Object>} [options.baseFiles=[]] - Files in base snapshot
 * @param {Array<Object>} [options.headFiles=[]] - Files in head snapshot
 * @returns {Object} AST Impact mapping result
 */
export function mapDiffToAstImpact({ parsedDiff, baseFiles = [], headFiles = [] }) {
  if (!parsedDiff || !Array.isArray(parsedDiff.files)) {
    throw new TypeError('parsedDiff with files array is required');
  }

  // Index base and head files by path
  const baseMap = new Map();
  for (const bf of baseFiles) {
    const p = bf.filePath || bf.path;
    if (p) baseMap.set(p, bf);
  }

  const headMap = new Map();
  for (const hf of headFiles) {
    const p = hf.filePath || hf.path;
    if (p) headMap.set(p, hf);
  }

  const resultFiles = [];
  const touchedEntities = [];
  let addedCount = 0;
  let modifiedCount = 0;
  let deletedCount = 0;
  let unchangedCount = 0;

  for (const diffFile of parsedDiff.files) {
    const { filePath, oldPath, newPath, changeType, changedLineRanges = [], oldLineRanges = [] } = diffFile;

    const baseRaw = oldPath ? baseMap.get(oldPath) : null;
    const headRaw = newPath ? headMap.get(newPath) : null;

    const parsedBase = baseRaw ? normalizeParsedFile(baseRaw) : null;
    const parsedHead = headRaw ? normalizeParsedFile(headRaw) : null;

    const fileEntities = [];

    // Case 1: Added file
    if (changeType === 'added' || (parsedHead && !parsedBase && newPath && oldPath === '/dev/null')) {
      const headSymbols = parsedHead?.symbols || [];
      const lineCount = parsedHead?.lineCount || 1;

      // File-level entity
      const fileEntity = {
        filePath: newPath || filePath,
        entityType: 'FILE',
        name: newPath || filePath,
        sourceRange: { startLine: 1, endLine: lineCount },
        changeClassification: 'ADDED',
        overlappingLineRanges: changedLineRanges
      };
      fileEntities.push(fileEntity);
      touchedEntities.push(fileEntity);
      addedCount++;

      for (const s of headSymbols) {
        if (s.symbolType === 'FILE') continue; // Handled above
        const ent = {
          filePath: newPath || filePath,
          entityType: s.symbolType,
          name: s.name,
          sourceRange: { startLine: s.startLine || 1, endLine: s.endLine || s.startLine || 1 },
          changeClassification: 'ADDED',
          overlappingLineRanges: changedLineRanges
        };
        fileEntities.push(ent);
        touchedEntities.push(ent);
        addedCount++;
      }

      resultFiles.push({
        filePath: newPath || filePath,
        oldPath: null,
        status: 'added',
        entities: fileEntities
      });
      continue;
    }

    // Case 2: Deleted file
    if (changeType === 'deleted' || (parsedBase && !parsedHead && oldPath && newPath === '/dev/null')) {
      const baseSymbols = parsedBase?.symbols || [];
      const lineCount = parsedBase?.lineCount || 1;

      const fileEntity = {
        filePath: oldPath || filePath,
        entityType: 'FILE',
        name: oldPath || filePath,
        sourceRange: { startLine: 1, endLine: lineCount },
        changeClassification: 'DELETED',
        overlappingLineRanges: oldLineRanges
      };
      fileEntities.push(fileEntity);
      touchedEntities.push(fileEntity);
      deletedCount++;

      for (const s of baseSymbols) {
        if (s.symbolType === 'FILE') continue;
        const ent = {
          filePath: oldPath || filePath,
          entityType: s.symbolType,
          name: s.name,
          sourceRange: { startLine: s.startLine || 1, endLine: s.endLine || s.startLine || 1 },
          changeClassification: 'DELETED',
          overlappingLineRanges: oldLineRanges
        };
        fileEntities.push(ent);
        touchedEntities.push(ent);
        deletedCount++;
      }

      resultFiles.push({
        filePath: oldPath || filePath,
        oldPath: oldPath || filePath,
        status: 'deleted',
        entities: fileEntities
      });
      continue;
    }

    // Case 3: Modified or Renamed file
    const baseSymbols = parsedBase?.symbols || [];
    const headSymbols = parsedHead?.symbols || [];
    const baseSymbolMap = new Map();
    for (const s of baseSymbols) {
      if (s.symbolType !== 'FILE') {
        baseSymbolMap.set(getSymbolKey(s), s);
      }
    }

    const headSymbolMap = new Map();
    for (const s of headSymbols) {
      if (s.symbolType !== 'FILE') {
        headSymbolMap.set(getSymbolKey(s), s);
      }
    }

    // File-level entity
    const lineCount = parsedHead?.lineCount || parsedBase?.lineCount || 1;
    const fileEntity = {
      filePath: newPath || filePath,
      entityType: 'FILE',
      name: newPath || filePath,
      sourceRange: { startLine: 1, endLine: lineCount },
      changeClassification: changedLineRanges.length > 0 || oldLineRanges.length > 0 ? 'MODIFIED' : 'UNCHANGED',
      overlappingLineRanges: changedLineRanges
    };
    fileEntities.push(fileEntity);
    if (fileEntity.changeClassification === 'MODIFIED') {
      touchedEntities.push(fileEntity);
      modifiedCount++;
    } else {
      unchangedCount++;
    }

    // Process head symbols (find ADDED, MODIFIED, UNCHANGED)
    for (const s of headSymbols) {
      if (s.symbolType === 'FILE') continue;
      const key = getSymbolKey(s);
      const sRange = { startLine: s.startLine || 1, endLine: s.endLine || s.startLine || 1 };
      const overlapping = findOverlappingRanges(sRange, changedLineRanges);

      if (!baseSymbolMap.has(key)) {
        // Exists in head but not in base -> ADDED
        const ent = {
          filePath: newPath || filePath,
          entityType: s.symbolType,
          name: s.name,
          sourceRange: sRange,
          changeClassification: 'ADDED',
          overlappingLineRanges: overlapping
        };
        fileEntities.push(ent);
        touchedEntities.push(ent);
        addedCount++;
      } else {
        // Exists in both base and head
        if (overlapping.length > 0) {
          const ent = {
            filePath: newPath || filePath,
            entityType: s.symbolType,
            name: s.name,
            sourceRange: sRange,
            changeClassification: 'MODIFIED',
            overlappingLineRanges: overlapping
          };
          fileEntities.push(ent);
          touchedEntities.push(ent);
          modifiedCount++;
        } else {
          const ent = {
            filePath: newPath || filePath,
            entityType: s.symbolType,
            name: s.name,
            sourceRange: sRange,
            changeClassification: 'UNCHANGED',
            overlappingLineRanges: []
          };
          fileEntities.push(ent);
          unchangedCount++;
        }
      }
    }

    // Process base symbols that were deleted in head (DELETED)
    for (const s of baseSymbols) {
      if (s.symbolType === 'FILE') continue;
      const key = getSymbolKey(s);
      if (!headSymbolMap.has(key)) {
        const sRange = { startLine: s.startLine || 1, endLine: s.endLine || s.startLine || 1 };
        const overlapping = findOverlappingRanges(sRange, oldLineRanges);
        const ent = {
          filePath: oldPath || filePath,
          entityType: s.symbolType,
          name: s.name,
          sourceRange: sRange,
          changeClassification: 'DELETED',
          overlappingLineRanges: overlapping
        };
        fileEntities.push(ent);
        touchedEntities.push(ent);
        deletedCount++;
      }
    }

    resultFiles.push({
      filePath: newPath || filePath,
      oldPath: oldPath || null,
      status: changeType || 'modified',
      entities: fileEntities
    });
  }

  return {
    summary: {
      totalEntities: addedCount + modifiedCount + deletedCount + unchangedCount,
      added: addedCount,
      modified: modifiedCount,
      deleted: deletedCount,
      unchanged: unchangedCount,
      touchedFilesCount: resultFiles.length
    },
    touchedEntities,
    files: resultFiles
  };
}
