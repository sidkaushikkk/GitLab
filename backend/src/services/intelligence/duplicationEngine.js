/**
 * Deterministic Source-Code Duplication Detection Engine
 * Checkpoint 10 Phase B
 *
 * Implements token-based sliding-window clone detection (Type-1 exact & Type-2 parameterized clones).
 * Uses an inverted hash index of normalized token windows to guarantee O(N) bounded performance,
 * avoiding naive O(N^2) pairwise comparisons.
 * Merges overlapping windows into maximal clone blocks and computes precise, non-overlapping
 * duplicated line unions (preventing line double-counting).
 */

import crypto from 'node:crypto';
import * as babelParser from '@babel/parser';
import { isProductionSourceFile, normalizePath } from './pathClassifier.js';
import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';

// Sensible defaults: 40 tokens (~5-8 lines of code) and minimum 4 lines
export const DEFAULT_MIN_TOKEN_THRESHOLD = 40;
export const DEFAULT_MIN_LINE_THRESHOLD = 4;
export const MAX_PUNCTUATION_RATIO = 0.75;
export const MIN_SEMANTIC_TOKENS = 5;

// Safeguards for bounded execution
export const MAX_TOTAL_TOKENS = 300000;
export const MAX_FILES_TO_ANALYZE = 1000;
export const MAX_CLONES_TO_PERSIST = 250;

/**
 * Common programming keywords across supported languages
 */
const KEYWORDS = new Set([
  // JavaScript / TypeScript
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'return',
  'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'yield', 'enum', 'implements', 'interface', 'package', 'private',
  'protected', 'public', 'static', 'type', 'declare',
  // Python
  'def', 'elif', 'except', 'from', 'global', 'lambda', 'nonlocal', 'pass',
  'raise', 'and', 'or', 'not', 'is', 'as',
  // Java
  'abstract', 'boolean', 'byte', 'char', 'double', 'final', 'float', 'int',
  'long', 'native', 'short', 'synchronized', 'throws', 'transient', 'volatile'
]);

/**
 * Operators and punctuation tokens
 */
const OPERATORS = new Set([
  '+', '-', '*', '/', '%', '**', '++', '--', '=', '+=', '-=', '*=', '/=', '%=',
  '==', '===', '!=', '!==', '<', '>', '<=', '>=', '&&', '||', '!', '??',
  '&', '|', '^', '~', '<<', '>>', '>>>', '?', ':', '=>', '->'
]);

const DELIMITERS = new Set([
  '(', ')', '{', '}', '[', ']', ';', ',', '.'
]);

/**
 * Tokenizes JavaScript/TypeScript/JSX source code using @babel/parser
 * @param {string} filePath
 * @param {string} content
 * @returns {Array<Object>} Normalized token stream
 */
function tokenizeJavaScript(filePath, content) {
  const tokens = [];
  let ast;

  try {
    ast = babelParser.parse(content || '', {
      sourceType: 'unambiguous',
      plugins: [
        'jsx', 'typescript', 'asyncGenerators', 'classProperties',
        'classPrivateProperties', 'classPrivateMethods', 'decorators-legacy',
        'dynamicImport', 'exportDefaultFrom', 'exportNamespaceFrom',
        'nullishCoalescingOperator', 'optionalChaining', 'topLevelAwait'
      ],
      tokens: true,
      errorRecovery: true
    });
  } catch (err) {
    // Fallback to regex tokenizer if Babel parser encounters unrecoverable syntax
    return tokenizeGeneric(filePath, content);
  }

  if (!Array.isArray(ast.tokens)) {
    return tokenizeGeneric(filePath, content);
  }

  // Filter out import and package declaration tokens
  let inImportStatement = false;

  for (let i = 0; i < ast.tokens.length; i++) {
    const t = ast.tokens[i];
    const label = t.type.label;
    const value = String(t.value ?? label);

    // Skip EOF token
    if (label === 'eof') {
      continue;
    }

    // Skip comments
    if (
      label === 'CommentLine' ||
      label === 'CommentBlock' ||
      t.type === 'CommentLine' ||
      t.type === 'CommentBlock' ||
      t.type?.isComment
    ) {
      continue;
    }

    // Track and skip import statements (e.g. import ... from '...')
    if (label === 'import') {
      inImportStatement = true;
      continue;
    }
    if (inImportStatement) {
      if (label === ';' || t.loc?.start?.line !== ast.tokens[i - 1]?.loc?.start?.line) {
        inImportStatement = false;
      }
      continue;
    }

    const startLine = t.loc ? t.loc.start.line : 1;
    const endLine = t.loc ? t.loc.end.line : startLine;
    const startCol = t.loc ? t.loc.start.column : 0;
    const endCol = t.loc ? t.loc.end.column : 0;

    let category = 'other';
    let normalized = value;

    if (label === 'name' || label === 'jsxName') {
      if (KEYWORDS.has(value)) {
        category = 'keyword';
        normalized = `kw:${value}`;
      } else {
        category = 'identifier';
        normalized = '$ID';
      }
    } else if (label === 'string' || label === 'num' || label === 'regexp' || label === 'jsxText') {
      category = 'literal';
      normalized = '$LIT';
    } else if (t.type.keyword || KEYWORDS.has(label)) {
      category = 'keyword';
      normalized = `kw:${label}`;
    } else if (OPERATORS.has(label) || OPERATORS.has(value)) {
      category = 'operator';
      normalized = `op:${value}`;
    } else if (DELIMITERS.has(label) || DELIMITERS.has(value)) {
      category = 'delimiter';
      normalized = `del:${value}`;
    }

    tokens.push({
      filePath,
      category,
      normalized,
      raw: value,
      startLine,
      endLine,
      startCol,
      endCol
    });
  }

  return tokens;
}

/**
 * Generic regex-based lexical tokenizer for Python, Java, and fallback languages
 * @param {string} filePath
 * @param {string} content
 * @returns {Array<Object>} Normalized token stream
 */
function tokenizeGeneric(filePath, content) {
  const tokens = [];
  const lines = (content || '').split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const lineNum = lineIdx + 1;
    const trimmed = rawLine.trim();

    // Skip comments and blank lines
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) {
      continue;
    }
    // Skip import declarations
    if (trimmed.startsWith('import ') || trimmed.startsWith('from ') || trimmed.startsWith('package ')) {
      continue;
    }

    // Token regex matches strings, numbers, identifiers/keywords, operators, delimiters
    const tokenRegex = /(["'`])(?:(?=(\\?))\2[\s\S])*?\1|\b\d+(?:\.\d+)?\b|[a-zA-Z_$][a-zA-Z0-9_$]*|===|!==|==|!=|<=|>=|\+\+|--|\+=|-=|\*=|&&|\|\||[+\-*/%&|^~<>!=]=?|[(){}\[\];:,.]/g;
    let match;

    while ((match = tokenRegex.exec(rawLine)) !== null) {
      const val = match[0];
      const startCol = match.index;
      const endCol = startCol + val.length;

      let category = 'other';
      let normalized = val;

      if (/^["'`]/.test(val) || /^\d/.test(val)) {
        category = 'literal';
        normalized = '$LIT';
      } else if (KEYWORDS.has(val)) {
        category = 'keyword';
        normalized = `kw:${val}`;
      } else if (/^[a-zA-Z_$]/.test(val)) {
        category = 'identifier';
        normalized = '$ID';
      } else if (OPERATORS.has(val)) {
        category = 'operator';
        normalized = `op:${val}`;
      } else if (DELIMITERS.has(val)) {
        category = 'delimiter';
        normalized = `del:${val}`;
      }

      tokens.push({
        filePath,
        category,
        normalized,
        raw: val,
        startLine: lineNum,
        endLine: lineNum,
        startCol,
        endCol
      });
    }
  }

  return tokens;
}

/**
 * Dispatches file to appropriate tokenizer
 * @param {Object} file - { path, content, language }
 * @returns {Array<Object>} Normalized token stream
 */
export function tokenizeSourceFile(file) {
  const normPath = normalizePath(file.path || file.filePath);
  const content = file.content || '';
  const lowerPath = normPath.toLowerCase();

  if (
    lowerPath.endsWith('.js') || lowerPath.endsWith('.jsx') ||
    lowerPath.endsWith('.ts') || lowerPath.endsWith('.tsx') ||
    lowerPath.endsWith('.mjs') || lowerPath.endsWith('.cjs')
  ) {
    return tokenizeJavaScript(normPath, content);
  }

  return tokenizeGeneric(normPath, content);
}

/**
 * Checks whether a token window is valid and non-trivial
 * @param {Array<Object>} windowTokens
 * @param {number} minLineThreshold
 * @returns {boolean}
 */
export function isWindowQualifying(windowTokens, minLineThreshold = DEFAULT_MIN_LINE_THRESHOLD) {
  if (!windowTokens || windowTokens.length === 0) return false;

  const startLine = windowTokens[0].startLine;
  const endLine = windowTokens[windowTokens.length - 1].endLine;
  const lineSpan = endLine - startLine + 1;

  if (lineSpan < minLineThreshold) {
    return false;
  }

  let delimiterCount = 0;
  let semanticCount = 0;

  for (const t of windowTokens) {
    if (t.category === 'delimiter') {
      delimiterCount++;
    } else if (t.category === 'keyword' || t.category === 'identifier' || t.category === 'literal') {
      semanticCount++;
    }
  }

  if (delimiterCount / windowTokens.length > MAX_PUNCTUATION_RATIO) {
    return false;
  }

  if (semanticCount < MIN_SEMANTIC_TOKENS) {
    return false;
  }

  return true;
}

/**
 * Generates a deterministic hash for a token window
 * @param {Array<Object>} windowTokens
 * @returns {string} 16-character hex hash
 */
export function hashTokenWindow(windowTokens) {
  const rep = windowTokens.map(t => t.normalized).join('|');
  return crypto.createHash('sha256').update(rep).digest('hex').substring(0, 16);
}

/**
 * Merges overlapping or adjacent 1D intervals [start, end]
 * @param {Array<[number, number]>} intervals
 * @returns {Array<[number, number]>}
 */
export function mergeIntervals(intervals) {
  if (!intervals || intervals.length === 0) return [];

  // Sort by start line, then by end line
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [sorted[0].slice()];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push(current.slice());
    }
  }

  return merged;
}

/**
 * Detects code duplication across a set of files using token sliding-windows
 * @param {Array<Object>} rawFiles - List of file objects { path, content, ... }
 * @param {Object} [options]
 * @param {number} [options.minTokenThreshold]
 * @param {number} [options.minLineThreshold]
 * @returns {Object} { summary, clones }
 */
export function detectDuplication(rawFiles, options = {}) {
  const minTokens = options.minTokenThreshold || DEFAULT_MIN_TOKEN_THRESHOLD;
  const minLines = options.minLineThreshold || DEFAULT_MIN_LINE_THRESHOLD;

  // 1. Filter files: only analyze source files (exclude tests, configs, vendor)
  const sourceFiles = (rawFiles || []).filter(f => {
    const p = f.path || f.filePath;
    return p && isProductionSourceFile(p) && typeof f.content === 'string';
  });

  // Calculate total source lines across all source files
  const fileLineCounts = new Map();
  let totalSourceLines = 0;

  for (const f of sourceFiles) {
    const p = normalizePath(f.path || f.filePath);
    const lines = f.content.split('\n').length;
    fileLineCounts.set(p, lines);
    totalSourceLines += lines;
  }

  if (sourceFiles.length === 0 || totalSourceLines === 0) {
    return {
      summary: {
        totalSourceLines: 0,
        duplicatedLines: 0,
        duplicationRatio: 0.0000,
        cloneCount: 0,
        cloneGroupCount: 0,
        intraFileClones: 0,
        interFileClones: 0
      },
      clones: []
    };
  }

  // 2. Tokenize all source files with safety bound
  const fileTokenStreams = new Map();
  let totalTokensCount = 0;

  for (const f of sourceFiles) {
    if (fileTokenStreams.size >= MAX_FILES_TO_ANALYZE) break;
    const p = normalizePath(f.path || f.filePath);
    const tokens = tokenizeSourceFile(f);
    fileTokenStreams.set(p, tokens);
    totalTokensCount += tokens.length;
    if (totalTokensCount >= MAX_TOTAL_TOKENS) {
      logger.warn({ totalTokensCount, maxAllowed: MAX_TOTAL_TOKENS }, 'Duplication analysis token limit reached, bounding window scan');
      break;
    }
  }

  // 3. Build inverted hash index of qualifying sliding windows
  const hashIndex = new Map();

  for (const [filePath, tokens] of fileTokenStreams.entries()) {
    if (tokens.length < minTokens) continue;

    for (let i = 0; i <= tokens.length - minTokens; i++) {
      const windowTokens = tokens.slice(i, i + minTokens);
      if (!isWindowQualifying(windowTokens, minLines)) {
        continue;
      }

      const h = hashTokenWindow(windowTokens);
      const entry = {
        filePath,
        tokenStart: i,
        tokenEnd: i + minTokens - 1,
        startLine: windowTokens[0].startLine,
        endLine: windowTokens[windowTokens.length - 1].endLine,
        startCol: windowTokens[0].startCol,
        endCol: windowTokens[windowTokens.length - 1].endCol
      };

      if (!hashIndex.has(h)) {
        hashIndex.set(h, [entry]);
      } else {
        hashIndex.get(h).push(entry);
      }
    }
  }

  // 4. Identify repeating window clusters (occurrences >= 2)
  const candidateHashes = [];
  for (const [h, occurrences] of hashIndex.entries()) {
    if (occurrences.length >= 2) {
      candidateHashes.push({ hash: h, occurrences });
    }
  }

  // 5. Expand and merge consecutive/overlapping matching windows into maximal clone blocks
  // Group pairs that match consecutive windows:
  // For each occurrence pair (A, B), diagonal = B.tokenStart - A.tokenStart
  const cloneClusters = [];
  const processedWindowPairs = new Set();

  for (const candidate of candidateHashes) {
    const occurrences = candidate.occurrences;

    for (let a = 0; a < occurrences.length; a++) {
      for (let b = a + 1; b < occurrences.length; b++) {
        const occA = occurrences[a];
        const occB = occurrences[b];

        // Ensure distinct regions (if in same file, avoid complete overlap)
        if (occA.filePath === occB.filePath && Math.abs(occA.tokenStart - occB.tokenStart) < minTokens / 2) {
          continue;
        }

        const pairKey = `${occA.filePath}:${occA.tokenStart}__${occB.filePath}:${occB.tokenStart}`;
        if (processedWindowPairs.has(pairKey)) continue;

        // Extend forward as long as tokens match
        const tokensA = fileTokenStreams.get(occA.filePath) || [];
        const tokensB = fileTokenStreams.get(occB.filePath) || [];

        let ext = 0;
        while (
          occA.tokenEnd + 1 + ext < tokensA.length &&
          occB.tokenEnd + 1 + ext < tokensB.length &&
          tokensA[occA.tokenEnd + 1 + ext].normalized === tokensB[occB.tokenEnd + 1 + ext].normalized
        ) {
          ext++;
          const subKey = `${occA.filePath}:${occA.tokenStart + ext}__${occB.filePath}:${occB.tokenStart + ext}`;
          processedWindowPairs.add(subKey);
        }

        const fullTokensA = tokensA.slice(occA.tokenStart, occA.tokenEnd + ext + 1);
        const fullTokensB = tokensB.slice(occB.tokenStart, occB.tokenEnd + ext + 1);

        const instanceA = {
          filePath: occA.filePath,
          startLine: fullTokensA[0].startLine,
          endLine: fullTokensA[fullTokensA.length - 1].endLine,
          startCol: fullTokensA[0].startCol,
          endCol: fullTokensA[fullTokensA.length - 1].endCol
        };

        const instanceB = {
          filePath: occB.filePath,
          startLine: fullTokensB[0].startLine,
          endLine: fullTokensB[fullTokensB.length - 1].endLine,
          startCol: fullTokensB[0].startCol,
          endCol: fullTokensB[fullTokensB.length - 1].endCol
        };

        const clusterNorm = fullTokensA.map(t => t.normalized).join('|');
        const clusterHash = crypto.createHash('sha256').update(clusterNorm).digest('hex').substring(0, 32);

        // Check if raw tokens match identically (Type-1) or normalized (Type-2)
        const isType1 = fullTokensA.every((t, idx) => t.raw === fullTokensB[idx]?.raw);

        cloneClusters.push({
          cloneHash: clusterHash,
          tokenCount: fullTokensA.length,
          lineCount: Math.max(
            instanceA.endLine - instanceA.startLine + 1,
            instanceB.endLine - instanceB.startLine + 1
          ),
          cloneType: isType1 ? 'TYPE_1' : 'TYPE_2',
          instances: [instanceA, instanceB]
        });
      }
    }
  }

  // 6. Deduplicate & consolidate clone clusters by cloneHash
  const consolidatedMap = new Map();

  for (const cluster of cloneClusters) {
    if (!consolidatedMap.has(cluster.cloneHash)) {
      consolidatedMap.set(cluster.cloneHash, {
        cloneHash: cluster.cloneHash,
        tokenCount: cluster.tokenCount,
        lineCount: cluster.lineCount,
        cloneType: cluster.cloneType,
        instances: []
      });
    }

    const target = consolidatedMap.get(cluster.cloneHash);
    for (const inst of cluster.instances) {
      const exists = target.instances.some(
        existing => existing.filePath === inst.filePath &&
          Math.abs(existing.startLine - inst.startLine) <= 2 &&
          Math.abs(existing.endLine - inst.endLine) <= 2
      );
      if (!exists) {
        target.instances.push(inst);
      }
    }
  }

  // Final list of unique clone groups (with at least 2 distinct instances)
  const finalClones = [];
  let intraFileCount = 0;
  let interFileCount = 0;

  for (const cluster of consolidatedMap.values()) {
    if (cluster.instances.length < 2) continue;

    // Check if intra-file or inter-file
    const firstFile = cluster.instances[0].filePath;
    const isIntra = cluster.instances.every(i => i.filePath === firstFile);
    cluster.isIntraFile = isIntra;

    if (isIntra) {
      intraFileCount++;
    } else {
      interFileCount++;
    }

    finalClones.push(cluster);
    if (finalClones.length >= MAX_CLONES_TO_PERSIST) break;
  }

  // Sort clones by token count descending (most significant clones first)
  finalClones.sort((a, b) => b.tokenCount - a.tokenCount);

  // 7. Calculate non-overlapping duplicated lines per file (1D Interval Union)
  const fileIntervals = new Map();

  for (const clone of finalClones) {
    for (const inst of clone.instances) {
      if (!fileIntervals.has(inst.filePath)) {
        fileIntervals.set(inst.filePath, []);
      }
      fileIntervals.get(inst.filePath).push([inst.startLine, inst.endLine]);
    }
  }

  let totalDuplicatedLines = 0;
  for (const [filePath, intervals] of fileIntervals.entries()) {
    const merged = mergeIntervals(intervals);
    let fileDupLines = 0;
    for (const [start, end] of merged) {
      fileDupLines += (end - start + 1);
    }
    // Cap to file line count
    const maxLines = fileLineCounts.get(filePath) || fileDupLines;
    totalDuplicatedLines += Math.min(fileDupLines, maxLines);
  }

  // Cap total duplicated lines to total source lines
  totalDuplicatedLines = Math.min(totalDuplicatedLines, totalSourceLines);

  const duplicationRatio = totalSourceLines > 0
    ? Number((totalDuplicatedLines / totalSourceLines).toFixed(4))
    : 0.0000;

  const totalInstanceCount = finalClones.reduce((acc, c) => acc + c.instances.length, 0);

  return {
    summary: {
      totalSourceLines,
      duplicatedLines: totalDuplicatedLines,
      duplicationRatio,
      cloneCount: totalInstanceCount,
      cloneGroupCount: finalClones.length,
      intraFileClones: intraFileCount,
      interFileClones: interFileCount
    },
    clones: finalClones
  };
}

/**
 * Detects and persists snapshot duplication idempotently
 * @param {string} snapshotId
 * @param {string} repositoryId
 * @param {Array<Object>} files
 * @param {Object} [options]
 * @param {Object} [dbPool=pool]
 * @returns {Promise<Object>}
 */
export async function detectAndPersistSnapshotDuplication(
  snapshotId,
  repositoryId,
  files,
  options = {},
  dbPool = pool
) {
  if (!snapshotId || !repositoryId) {
    throw new Error('snapshotId and repositoryId are required for duplication analysis');
  }

  // 1. Idempotency Check: Return existing summary if already computed
  if (!options.forceReanalyze) {
    const { rows: existingSummaries } = await dbPool.query(
      'SELECT * FROM snapshot_duplication_summaries WHERE snapshot_id = $1',
      [snapshotId]
    );

    if (existingSummaries.length > 0) {
      const summaryRow = existingSummaries[0];
      const { rows: cloneRows } = await dbPool.query(
        'SELECT clone_hash, clone_type, token_count, line_count, is_intra_file, instances FROM snapshot_duplications WHERE snapshot_id = $1 ORDER BY token_count DESC',
        [snapshotId]
      );

      return {
        summary: {
          snapshotId,
          repositoryId,
          totalSourceLines: summaryRow.total_source_lines,
          duplicatedLines: summaryRow.duplicated_lines,
          duplicationRatio: Number(summaryRow.duplication_ratio),
          cloneCount: summaryRow.clone_count,
          cloneGroupCount: summaryRow.clone_group_count,
          intraFileClones: summaryRow.intra_file_clones,
          interFileClones: summaryRow.inter_file_clones,
          reused: true
        },
        clones: cloneRows.map(r => ({
          cloneHash: r.clone_hash,
          cloneType: r.clone_type,
          tokenCount: r.token_count,
          lineCount: r.line_count,
          isIntraFile: r.is_intra_file,
          instances: r.instances
        }))
      };
    }
  }

  // 2. Run deterministic detection
  const detectionResult = detectDuplication(files, options);
  const { summary, clones } = detectionResult;

  // 3. Persist findings to PostgreSQL in transaction
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    // Clean up any stale records if re-running
    await client.query('DELETE FROM snapshot_duplications WHERE snapshot_id = $1', [snapshotId]);
    await client.query('DELETE FROM snapshot_duplication_summaries WHERE snapshot_id = $1', [snapshotId]);

    // Insert Summary
    await client.query(
      `INSERT INTO snapshot_duplication_summaries (
        snapshot_id, repository_id, total_source_lines, duplicated_lines,
        duplication_ratio, clone_count, clone_group_count, intra_file_clones, inter_file_clones, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        snapshotId,
        repositoryId,
        summary.totalSourceLines,
        summary.duplicatedLines,
        summary.duplicationRatio,
        summary.cloneCount,
        summary.cloneGroupCount,
        summary.intraFileClones,
        summary.interFileClones
      ]
    );

    // Insert individual clone groups
    for (const clone of clones) {
      await client.query(
        `INSERT INTO snapshot_duplications (
          snapshot_id, repository_id, clone_hash, clone_type,
          token_count, line_count, is_intra_file, instances, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (snapshot_id, clone_hash) DO NOTHING`,
        [
          snapshotId,
          repositoryId,
          clone.cloneHash,
          clone.cloneType,
          clone.tokenCount,
          clone.lineCount,
          clone.isIntraFile,
          JSON.stringify(clone.instances)
        ]
      );
    }

    await client.query('COMMIT');

    logger.info(
      {
        snapshotId,
        duplicationRatio: summary.duplicationRatio,
        cloneGroups: summary.cloneGroupCount,
        duplicatedLines: summary.duplicatedLines
      },
      'Successfully computed and persisted snapshot duplication'
    );

    return {
      summary: {
        snapshotId,
        repositoryId,
        ...summary,
        reused: false
      },
      clones
    };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ snapshotId, err: err.message }, 'Failed to persist snapshot duplication');
    throw err;
  } finally {
    client.release();
  }
}
