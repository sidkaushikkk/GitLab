/**
 * Unified Diff Parser for Git patches
 * Consumes a Git unified diff/patch and produces structured file, hunk, and line-range data.
 */

/**
 * Normalizes git path by stripping 'a/' or 'b/' prefix
 * @param {string} p
 * @returns {string|null}
 */
function normalizePath(p) {
  if (!p) return null;
  const trimmed = p.trim();
  if (trimmed === '/dev/null') return '/dev/null';
  if (trimmed.startsWith('a/') || trimmed.startsWith('b/')) {
    return trimmed.slice(2);
  }
  return trimmed;
}

/**
 * Compresses an array of sorted unique line numbers into contiguous ranges [{ start, end }]
 * @param {number[]} lineNumbers
 * @returns {Array<{ start: number, end: number }>}
 */
function compressLineRanges(lineNumbers) {
  if (!lineNumbers || lineNumbers.length === 0) return [];
  const sorted = Array.from(new Set(lineNumbers)).sort((a, b) => a - b);
  const ranges = [];
  let rangeStart = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
    } else {
      ranges.push({ start: rangeStart, end: prev });
      rangeStart = current;
      prev = current;
    }
  }
  ranges.push({ start: rangeStart, end: prev });
  return ranges;
}

/**
 * Parses a git unified diff string into structured representation
 * @param {string} diffText - Raw git diff text
 * @returns {Object} Structured diff data
 */
export function parseUnifiedDiff(diffText) {
  if (typeof diffText !== 'string') {
    throw new TypeError('Diff input must be a string');
  }

  const warnings = [];
  const files = [];

  if (!diffText.trim()) {
    return {
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
      changedFileCount: 0,
      warnings
    };
  }

  const lines = diffText.split(/\r?\n/);
  let currentFile = null;
  let currentHunk = null;
  let currentOldLine = 0;
  let currentNewLine = 0;

  function finalizeHunk() {
    if (!currentHunk || !currentFile) return;
    currentHunk.changedLineRanges = compressLineRanges(currentHunk.newLinesModified);
    delete currentHunk.newLinesModified;
    currentFile.hunks.push(currentHunk);
    currentHunk = null;
  }

  function finalizeFile() {
    if (!currentFile) return;
    finalizeHunk();

    currentFile.changedLineRanges = compressLineRanges(currentFile.allNewLines);
    currentFile.oldLineRanges = compressLineRanges(currentFile.allOldLines);
    delete currentFile.allNewLines;
    delete currentFile.allOldLines;

    // Determine final changeType if not set explicitly by git mode
    if (!currentFile.changeType) {
      if (currentFile.oldPath === '/dev/null') {
        currentFile.changeType = 'added';
      } else if (currentFile.newPath === '/dev/null') {
        currentFile.changeType = 'deleted';
      } else if (currentFile.oldPath && currentFile.newPath && currentFile.oldPath !== currentFile.newPath) {
        currentFile.changeType = 'renamed';
      } else {
        currentFile.changeType = 'modified';
      }
    }

    // Set primary filePath for lookup
    currentFile.filePath = (currentFile.newPath && currentFile.newPath !== '/dev/null')
      ? currentFile.newPath
      : currentFile.oldPath;

    files.push(currentFile);
    currentFile = null;
  }

  const HUNK_REGEX = /^@@\s+-([0-9]+)(?:,([0-9]+))?\s+\+([0-9]+)(?:,([0-9]+))?\s+@@(?:\s+(.*))?$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for diff --git header
    if (line.startsWith('diff --git ')) {
      finalizeFile();

      const parts = line.slice(11).trim().split(' ');
      let oldP = null;
      let newP = null;
      if (parts.length >= 2) {
        oldP = normalizePath(parts[0]);
        newP = normalizePath(parts[1]);
      }

      currentFile = {
        oldPath: oldP,
        newPath: newP,
        filePath: newP || oldP,
        changeType: null,
        isBinary: false,
        additions: 0,
        deletions: 0,
        changedLineRanges: [],
        oldLineRanges: [],
        allNewLines: [],
        allOldLines: [],
        hunks: []
      };
      continue;
    }

    if (!currentFile) {
      // If diff text starts without 'diff --git ', handle single-file patch format (--- a/foo +++ b/foo)
      if (line.startsWith('--- ')) {
        currentFile = {
          oldPath: normalizePath(line.slice(4)),
          newPath: null,
          filePath: null,
          changeType: null,
          isBinary: false,
          additions: 0,
          deletions: 0,
          changedLineRanges: [],
          oldLineRanges: [],
          allNewLines: [],
          allOldLines: [],
          hunks: []
        };
        continue;
      }
      continue;
    }

    // Metadata lines
    if (line.startsWith('new file mode ')) {
      currentFile.changeType = 'added';
      currentFile.oldPath = '/dev/null';
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      currentFile.changeType = 'deleted';
      currentFile.newPath = '/dev/null';
      continue;
    }
    if (line.startsWith('rename from ')) {
      currentFile.changeType = 'renamed';
      currentFile.oldPath = line.slice(12).trim();
      continue;
    }
    if (line.startsWith('rename to ')) {
      currentFile.changeType = 'renamed';
      currentFile.newPath = line.slice(10).trim();
      continue;
    }
    if (line.startsWith('copy from ')) {
      currentFile.changeType = 'copied';
      currentFile.oldPath = line.slice(10).trim();
      continue;
    }
    if (line.startsWith('copy to ')) {
      currentFile.changeType = 'copied';
      currentFile.newPath = line.slice(8).trim();
      continue;
    }
    if (line.startsWith('Binary files ') && line.includes('differ')) {
      currentFile.isBinary = true;
      continue;
    }
    if (line.startsWith('GIT binary patch')) {
      currentFile.isBinary = true;
      continue;
    }
    if (line.startsWith('--- ')) {
      const p = normalizePath(line.slice(4));
      if (p) currentFile.oldPath = p;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = normalizePath(line.slice(4));
      if (p) currentFile.newPath = p;
      continue;
    }

    // Hunk header
    if (line.startsWith('@@ ')) {
      finalizeHunk();

      const match = line.match(HUNK_REGEX);
      if (!match) {
        warnings.push(`Malformed hunk header at line ${i + 1}: ${line}`);
        continue;
      }

      const oldStart = parseInt(match[1], 10);
      const oldCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
      const newStart = parseInt(match[3], 10);
      const newCount = match[4] !== undefined ? parseInt(match[4], 10) : 1;
      const heading = (match[5] || '').trim();

      currentOldLine = oldStart;
      currentNewLine = newStart;

      currentHunk = {
        oldStart,
        oldCount,
        newStart,
        newCount,
        heading,
        additions: 0,
        deletions: 0,
        newLinesModified: [],
        lines: []
      };
      continue;
    }

    // Inside a hunk
    if (currentHunk) {
      if (line.startsWith('+')) {
        currentFile.additions++;
        currentHunk.additions++;
        currentFile.allNewLines.push(currentNewLine);
        currentHunk.newLinesModified.push(currentNewLine);
        currentHunk.lines.push(line);
        currentNewLine++;
      } else if (line.startsWith('-')) {
        currentFile.deletions++;
        currentHunk.deletions++;
        currentFile.allOldLines.push(currentOldLine);
        currentHunk.lines.push(line);
        currentOldLine++;
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push(line);
        currentOldLine++;
        currentNewLine++;
      } else if (line.startsWith('\\ No newline at end of file') || line.startsWith('\\')) {
        currentHunk.lines.push(line);
      } else {
        // Unexpected line inside hunk
        warnings.push(`Unexpected line outside hunk format at line ${i + 1}: ${line.slice(0, 40)}`);
      }
    }
  }

  finalizeFile();

  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const f of files) {
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  }

  return {
    files,
    totalAdditions,
    totalDeletions,
    changedFileCount: files.length,
    warnings
  };
}
