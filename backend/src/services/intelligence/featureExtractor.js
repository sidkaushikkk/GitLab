export const FEATURE_SCHEMA_VERSION = '1.0';

/**
 * Checks if a given file path is a test file or has a corresponding test file
 * @param {string} filePath - Path of source file
 * @param {Set<string>} allPaths - Set of all file paths in repository
 * @returns {number} 1 if test present, 0 otherwise
 */
export function detectTestPresence(filePath, allPaths) {
  const lower = filePath.toLowerCase();

  // If the file itself is a test
  if (
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.startsWith('test_') ||
    lower.endsWith('_test.py') ||
    lower.endsWith('test.java') ||
    lower.includes('/tests/') ||
    lower.includes('/test/') ||
    lower.includes('/__tests__/')
  ) {
    return 1;
  }

  // Check if a companion test exists in the repository
  const baseNameWithoutExt = filePath.replace(/\.[^/.]+$/, '');
  const extensions = ['.test.js', '.spec.js', '.test.jsx', '.spec.jsx', '_test.py', 'Test.java'];

  for (const ext of extensions) {
    if (allPaths.has(`${baseNameWithoutExt}${ext}`)) return 1;
    if (allPaths.has(`test/${baseNameWithoutExt}${ext}`)) return 1;
    if (allPaths.has(`tests/${baseNameWithoutExt}${ext}`)) return 1;
  }

  return 0;
}

/**
 * Extracts normalized ML-ready numerical feature vectors at function, file, and repository levels
 * @param {Array<Object>} parsedFiles - Array of parsed file results
 * @param {Array<Object>} allSymbols - All extracted symbols
 * @param {Object} graphMetrics - Graph fan-in, fan-out, and circular dependency metrics
 * @param {Array<Object>} codeSmells - Detected code smell findings
 * @returns {Array<Object>} Flat list of feature entries for database persistence and export
 */
export function extractFeatures(parsedFiles, allSymbols, graphMetrics, codeSmells) {
  const features = [];
  const allPaths = new Set(parsedFiles.map(f => f.filePath));

  // Pre-index code smells by file and symbol
  const fileSmellCount = new Map();
  const symbolSmellCount = new Map();

  for (const smell of codeSmells) {
    const fileCount = fileSmellCount.get(smell.filePath) || 0;
    fileSmellCount.set(smell.filePath, fileCount + 1);

    if (smell.symbolName) {
      const symKey = `${smell.filePath}:${smell.symbolName}`;
      const symCount = symbolSmellCount.get(symKey) || 0;
      symbolSmellCount.set(symKey, symCount + 1);
    }
  }

  let repoTotalComplexity = 0;
  let repoMaxComplexity = 0;
  let repoTotalFunctions = 0;
  let repoTotalClasses = 0;
  let repoTotalImports = 0;
  let repoTotalLines = 0;
  let repoTotalFunctionLines = 0;

  // 1. File & Function Features
  for (const file of parsedFiles) {
    const fileIn = graphMetrics?.fileFanIn?.get(file.filePath) || 0;
    const fileOut = graphMetrics?.fileFanOut?.get(file.filePath) || 0;
    const fileSmells = fileSmellCount.get(file.filePath) || 0;
    const hasTest = detectTestPresence(file.filePath, allPaths);

    let fileTotalComplexity = 0;
    let fileMaxComplexity = 0;

    for (const fn of file.functionMetrics) {
      repoTotalFunctions++;
      repoTotalComplexity += fn.cyclomaticComplexity;
      repoTotalFunctionLines += fn.lines;
      fileTotalComplexity += fn.cyclomaticComplexity;
      if (fn.cyclomaticComplexity > fileMaxComplexity) fileMaxComplexity = fn.cyclomaticComplexity;
      if (fn.cyclomaticComplexity > repoMaxComplexity) repoMaxComplexity = fn.cyclomaticComplexity;

      const symKey = `${file.filePath}:${fn.symbolName}`;
      const fnSmells = symbolSmellCount.get(symKey) || 0;

      // Function Features
      const fnEntityId = `${file.filePath}::${fn.symbolName}#${fn.startLine}`;
      const fnFeatureMap = {
        lines: fn.lines,
        complexity: fn.cyclomaticComplexity,
        parameter_count: fn.parameterCount,
        max_nesting_depth: fn.maxNestingDepth,
        branch_count: fn.branchCount,
        loop_count: fn.loopCount,
        call_count: fn.callCount,
        return_count: fn.returnCount,
        fan_in: fileIn,
        fan_out: fn.callCount,
        code_smell_count: fnSmells,
        has_test: hasTest
      };

      for (const [name, val] of Object.entries(fnFeatureMap)) {
        features.push({
          entityType: 'function',
          entityId: fnEntityId,
          featureSchemaVersion: FEATURE_SCHEMA_VERSION,
          featureName: name,
          featureValue: Number(val)
        });
      }
    }

    repoTotalLines += file.lineCount;
    repoTotalClasses += file.fileMetrics.classCount;
    repoTotalImports += file.imports.length;

    const avgFileComplexity = file.functionMetrics.length > 0
      ? Number((fileTotalComplexity / file.functionMetrics.length).toFixed(2))
      : 0;

    // File Features
    const fileFeatureMap = {
      lines: file.lineCount,
      function_count: file.fileMetrics.functionCount,
      class_count: file.fileMetrics.classCount,
      import_count: file.imports.length,
      export_count: file.exports.length,
      avg_complexity: avgFileComplexity,
      max_complexity: fileMaxComplexity,
      fan_in: fileIn,
      fan_out: fileOut,
      code_smell_count: fileSmells,
      has_test: hasTest
    };

    for (const [name, val] of Object.entries(fileFeatureMap)) {
      features.push({
        entityType: 'file',
        entityId: file.filePath,
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        featureName: name,
        featureValue: Number(val)
      });
    }
  }

  // 2. Repository Level Features
  const avgRepoComplexity = repoTotalFunctions > 0
    ? Number((repoTotalComplexity / repoTotalFunctions).toFixed(2))
    : 0;
  const avgFileSize = parsedFiles.length > 0
    ? Number((repoTotalLines / parsedFiles.length).toFixed(2))
    : 0;
  const avgFunctionSize = repoTotalFunctions > 0
    ? Number((repoTotalFunctionLines / repoTotalFunctions).toFixed(2))
    : 0;

  const repoFeatureMap = {
    file_count: parsedFiles.length,
    function_count: repoTotalFunctions,
    class_count: repoTotalClasses,
    dependency_count: repoTotalImports,
    relationship_count: features.length,
    circular_dependency_count: graphMetrics?.circularDependencyCount || 0,
    average_complexity: avgRepoComplexity,
    max_complexity: repoMaxComplexity,
    average_file_size: avgFileSize,
    average_function_size: avgFunctionSize,
    code_smell_count: codeSmells.length
  };

  for (const [name, val] of Object.entries(repoFeatureMap)) {
    features.push({
      entityType: 'repository',
      entityId: 'repository',
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      featureName: name,
      featureValue: Number(val)
    });
  }

  return features;
}
