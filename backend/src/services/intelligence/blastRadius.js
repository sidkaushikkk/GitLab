/**
 * Blast Radius Calculation Service
 * Computes downstream dependents and callers affected by pull request modifications.
 * Uses the existing repository dependency graph (relationships table / relationshipExtractor).
 */

/**
 * Calculates downstream blast radius from modified files and symbols.
 * Traverses reverse edges (target -> source) to locate all callers and importers.
 *
 * @param {Object} options
 * @param {string[]} [options.changedFiles=[]] - List of touched file paths
 * @param {Array<Object|string>} [options.changedSymbols=[]] - List of touched symbols ({ filePath, name })
 * @param {Array<Object>} [options.relationships=[]] - Repository relationships [{ sourceFilePath, targetFilePath, relationshipType, ... }]
 * @param {number} [options.maxDepth=3] - Maximum downstream traversal depth
 * @returns {Object} Structured blast radius report
 */
export function calculateBlastRadius({
  changedFiles = [],
  changedSymbols = [],
  relationships = [],
  maxDepth = 3
} = {}) {
  if (!Array.isArray(relationships)) {
    throw new TypeError('relationships must be an array');
  }

  const effectiveMaxDepth = Math.max(1, parseInt(maxDepth, 10) || 3);

  // Normalize seed files and symbols
  const seedFilesSet = new Set(changedFiles.filter(Boolean));
  const seedNodes = [];
  const visited = new Set();

  for (const f of seedFilesSet) {
    const key = `file:${f}`;
    seedNodes.push({ type: 'file', id: key, filePath: f });
    visited.add(key);
  }

  for (const sym of changedSymbols) {
    if (!sym) continue;
    const fPath = typeof sym === 'string' ? '' : sym.filePath;
    const sName = typeof sym === 'string' ? sym : sym.name;
    if (fPath && sName) {
      const key = `symbol:${fPath}:${sName}`;
      seedNodes.push({ type: 'symbol', id: key, filePath: fPath, name: sName });
      visited.add(key);
    }
  }

  // If no seed nodes, return empty result
  if (seedNodes.length === 0) {
    return {
      seedNodes: [],
      maxDepthConfigured: effectiveMaxDepth,
      maxDepthReached: 0,
      totalAffectedNodes: 0,
      affectedFiles: [],
      directlyAffected: [],
      transitivelyAffected: [],
      allAffectedNodes: []
    };
  }

  // Build target -> sources adjacency lookup map:
  // targetFilePath -> Array<{ sourceFilePath, relationshipType, symbolsImported, ... }>
  const incomingMap = new Map();
  for (const rel of relationships) {
    if (!rel || !rel.targetFilePath || !rel.sourceFilePath) continue;
    const tgt = rel.targetFilePath;
    if (!incomingMap.has(tgt)) {
      incomingMap.set(tgt, []);
    }
    incomingMap.get(tgt).push(rel);
  }

  const directlyAffected = [];
  const transitivelyAffected = [];
  const affectedFilesSet = new Set();
  let maxDepthReached = 0;

  // BFS Queue: [{ filePath, name, depth }]
  let currentLevel = seedNodes.map(s => ({
    filePath: s.filePath,
    name: s.name || null,
    depth: 0
  }));

  let currentDepth = 1;

  while (currentLevel.length > 0 && currentDepth <= effectiveMaxDepth) {
    const nextLevel = [];

    for (const node of currentLevel) {
      const incomingEdges = incomingMap.get(node.filePath) || [];

      for (const edge of incomingEdges) {
        const dependentFilePath = edge.sourceFilePath;

        // Self-reference protection: skip intra-file dependencies for external blast radius
        if (dependentFilePath === node.filePath) {
          continue;
        }

        const nodeKey = `file:${dependentFilePath}`;

        // Cycle & duplicate protection
        if (visited.has(nodeKey)) {
          continue;
        }

        visited.add(nodeKey);
        affectedFilesSet.add(dependentFilePath);
        maxDepthReached = Math.max(maxDepthReached, currentDepth);

        const affectedEntry = {
          nodeId: nodeKey,
          type: 'file',
          filePath: dependentFilePath,
          depth: currentDepth,
          relationshipType: edge.relationshipType || 'IMPORTS',
          dependedOn: node.filePath,
          symbolsImported: edge.symbolsImported || []
        };

        if (currentDepth === 1) {
          directlyAffected.push(affectedEntry);
        } else {
          transitivelyAffected.push(affectedEntry);
        }

        nextLevel.push({
          filePath: dependentFilePath,
          depth: currentDepth
        });
      }
    }

    currentLevel = nextLevel;
    currentDepth++;
  }

  const allAffectedNodes = [...directlyAffected, ...transitivelyAffected];

  return {
    seedNodes,
    maxDepthConfigured: effectiveMaxDepth,
    maxDepthReached,
    totalAffectedNodes: allAffectedNodes.length,
    affectedFiles: Array.from(affectedFilesSet).sort(),
    directlyAffected,
    transitivelyAffected,
    allAffectedNodes
  };
}

/**
 * DB-backed Blast Radius query helper:
 * Loads relationships for a given analysis run from the database and runs calculateBlastRadius.
 *
 * @param {Object} options
 * @param {Object} options.client - pg client or pool
 * @param {string} options.analysisRunId - UUID of analysis_run
 * @param {string[]} options.changedFiles - List of changed files
 * @param {number} [options.maxDepth=3] - Maximum traversal depth
 * @returns {Promise<Object>} Blast radius result
 */
export async function calculateBlastRadiusFromDb({
  client,
  analysisRunId,
  changedFiles = [],
  changedSymbols = [],
  maxDepth = 3
}) {
  if (!client || !analysisRunId) {
    throw new Error('Database client and analysisRunId are required');
  }

  const { rows: relationships } = await client.query(
    `SELECT 
       source_file_path AS "sourceFilePath",
       target_file_path AS "targetFilePath",
       relationship_type AS "relationshipType",
       symbols_imported AS "symbolsImported"
     FROM relationships
     WHERE analysis_run_id = $1`,
    [analysisRunId]
  );

  return calculateBlastRadius({
    changedFiles,
    changedSymbols,
    relationships,
    maxDepth
  });
}
