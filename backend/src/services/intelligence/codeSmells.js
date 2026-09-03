/**
 * Default configurable thresholds for deterministic code smell detection
 */
export const DEFAULT_SMELL_THRESHOLDS = {
  LARGE_FUNCTION_LINES: 50,
  HIGH_COMPLEXITY: 10,
  DEEP_NESTING: 4,
  LARGE_FILE_LINES: 500,
  HIGH_IMPORT_COUNT: 20,
  HIGH_DEPENDENT_COUNT: 10
};

/**
 * Detects deterministic code smells across parsed repository files and functions
 * @param {Array<Object>} parsedFiles - Array of parsed file results
 * @param {Object} graphMetrics - Graph connectivity metrics (fan-in, fan-out)
 * @param {Object} [thresholds] - Configurable threshold overrides
 * @returns {Array<Object>} Array of code smell findings
 */
export function detectCodeSmells(parsedFiles, graphMetrics, thresholds = DEFAULT_SMELL_THRESHOLDS) {
  const smells = [];
  const limits = { ...DEFAULT_SMELL_THRESHOLDS, ...thresholds };

  for (const file of parsedFiles) {
    // 1. File Level: LARGE_FILE
    if (file.lineCount > limits.LARGE_FILE_LINES) {
      smells.push({
        ruleId: 'LARGE_FILE',
        severity: 'medium',
        filePath: file.filePath,
        symbolName: null,
        line: 1,
        measuredValue: file.lineCount,
        threshold: limits.LARGE_FILE_LINES,
        message: `File exceeds threshold with ${file.lineCount} lines (limit: ${limits.LARGE_FILE_LINES})`
      });
    }

    // 2. File Level: HIGH_IMPORT_COUNT
    if (file.imports.length > limits.HIGH_IMPORT_COUNT) {
      smells.push({
        ruleId: 'HIGH_IMPORT_COUNT',
        severity: 'low',
        filePath: file.filePath,
        symbolName: null,
        line: 1,
        measuredValue: file.imports.length,
        threshold: limits.HIGH_IMPORT_COUNT,
        message: `File imports ${file.imports.length} modules, exceeding threshold of ${limits.HIGH_IMPORT_COUNT}`
      });
    }

    // 3. File Level: HIGH_DEPENDENT_COUNT (High Fan-In)
    const fileIn = graphMetrics?.fileFanIn?.get(file.filePath) || 0;
    if (fileIn > limits.HIGH_DEPENDENT_COUNT) {
      smells.push({
        ruleId: 'HIGH_DEPENDENT_COUNT',
        severity: 'medium',
        filePath: file.filePath,
        symbolName: null,
        line: 1,
        measuredValue: fileIn,
        threshold: limits.HIGH_DEPENDENT_COUNT,
        message: `High coupling: ${fileIn} incoming dependencies exceed threshold of ${limits.HIGH_DEPENDENT_COUNT}`
      });
    }

    // 4. Function Level Code Smells
    for (const fn of file.functionMetrics) {
      // LARGE_FUNCTION
      if (fn.lines > limits.LARGE_FUNCTION_LINES) {
        smells.push({
          ruleId: 'LARGE_FUNCTION',
          severity: 'medium',
          filePath: file.filePath,
          symbolName: fn.symbolName,
          line: fn.startLine,
          measuredValue: fn.lines,
          threshold: limits.LARGE_FUNCTION_LINES,
          message: `Function ${fn.symbolName} is ${fn.lines} lines long (threshold: ${limits.LARGE_FUNCTION_LINES})`
        });
      }

      // HIGH_COMPLEXITY
      if (fn.cyclomaticComplexity > limits.HIGH_COMPLEXITY) {
        smells.push({
          ruleId: 'HIGH_COMPLEXITY',
          severity: fn.cyclomaticComplexity > limits.HIGH_COMPLEXITY * 2 ? 'high' : 'medium',
          filePath: file.filePath,
          symbolName: fn.symbolName,
          line: fn.startLine,
          measuredValue: fn.cyclomaticComplexity,
          threshold: limits.HIGH_COMPLEXITY,
          message: `Function ${fn.symbolName} has cyclomatic complexity of ${fn.cyclomaticComplexity} (threshold: ${limits.HIGH_COMPLEXITY})`
        });
      }

      // DEEP_NESTING
      if (fn.maxNestingDepth > limits.DEEP_NESTING) {
        smells.push({
          ruleId: 'DEEP_NESTING',
          severity: 'medium',
          filePath: file.filePath,
          symbolName: fn.symbolName,
          line: fn.startLine,
          measuredValue: fn.maxNestingDepth,
          threshold: limits.DEEP_NESTING,
          message: `Function ${fn.symbolName} has maximum nesting depth of ${fn.maxNestingDepth} (threshold: ${limits.DEEP_NESTING})`
        });
      }
    }
  }

  return smells;
}
