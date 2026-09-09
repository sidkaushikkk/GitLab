/**
 * Deterministic parser for package-lock.json (npm lockfile versions 2 and 3)
 * Normalizes dependency inventories across direct, transitive, development, and optional trees.
 * Checkpoint 9 Phase B.
 */

import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';

/**
 * Normalizes package names across ecosystems
 * @param {string} ecosystem - Target ecosystem ('npm', 'pypi', 'maven', etc.)
 * @param {string} name - Raw package name
 * @returns {string} Normalized canonical package identity
 */
export function normalizePackageName(ecosystem, name) {
  if (!name || typeof name !== 'string') return '';
  const trimmed = name.trim();
  const eco = (ecosystem || '').toLowerCase();

  if (eco === 'pypi') {
    // PEP 503 normalization: lowercase and runs of [-_.] replaced with single '-'
    return trimmed.toLowerCase().replace(/[-_.]+/g, '-');
  }

  // npm, maven, etc.: standard lowercase
  return trimmed.toLowerCase();
}

/**
 * Parses package path key from npm lockfile v2/v3 `packages` map
 * @param {string} entryKey - e.g. 'node_modules/@babel/core' or 'node_modules/a/node_modules/b'
 * @returns {Object} { name, parentName, depth, isRoot }
 */
export function parsePackageKey(entryKey) {
  if (!entryKey || entryKey === '') {
    return { name: '', parentName: null, depth: 0, isRoot: true };
  }

  const normalized = entryKey.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split(/(?:^|\/)node_modules\//).filter(Boolean);

  if (segments.length === 0) {
    return { name: normalized, parentName: null, depth: 1, isRoot: false };
  }

  const name = segments[segments.length - 1];
  const parentName = segments.length > 1 ? segments[segments.length - 2] : null;
  const depth = segments.length;

  return { name, parentName, depth, isRoot: false };
}

/**
 * Extracts declared dependencies from package.json or root packages['']
 * @param {Object|string} packageJson - Raw package.json content string or parsed object
 * @returns {Object} Maps of direct dependency names to version specifiers
 */
export function extractDirectDeclarations(packageJson) {
  let pkg = {};
  if (typeof packageJson === 'string') {
    try {
      pkg = JSON.parse(packageJson || '{}');
    } catch {
      pkg = {};
    }
  } else if (packageJson && typeof packageJson === 'object') {
    pkg = packageJson;
  }

  const prod = new Map();
  const dev = new Map();
  const peer = new Map();
  const optional = new Map();

  if (pkg.dependencies && typeof pkg.dependencies === 'object') {
    for (const [name, spec] of Object.entries(pkg.dependencies)) {
      if (typeof name === 'string' && name.trim()) {
        prod.set(name.trim(), String(spec || '*'));
      }
    }
  }

  if (pkg.devDependencies && typeof pkg.devDependencies === 'object') {
    for (const [name, spec] of Object.entries(pkg.devDependencies)) {
      if (typeof name === 'string' && name.trim()) {
        dev.set(name.trim(), String(spec || '*'));
      }
    }
  }

  if (pkg.peerDependencies && typeof pkg.peerDependencies === 'object') {
    for (const [name, spec] of Object.entries(pkg.peerDependencies)) {
      if (typeof name === 'string' && name.trim()) {
        peer.set(name.trim(), String(spec || '*'));
      }
    }
  }

  if (pkg.optionalDependencies && typeof pkg.optionalDependencies === 'object') {
    for (const [name, spec] of Object.entries(pkg.optionalDependencies)) {
      if (typeof name === 'string' && name.trim()) {
        optional.set(name.trim(), String(spec || '*'));
      }
    }
  }

  return { prod, dev, peer, optional };
}

/**
 * Builds an adjacency map of package dependencies to calculate minimum distance from root
 * @param {Object} packages - npm lockfile `packages` map
 * @returns {Object} { assignedDepth: Map, assignedParent: Map }
 */
function computeDependencyGraphDistances(packages, rootDirectNames) {
  const assignedDepth = new Map();
  const assignedParent = new Map();
  const pkgRequirements = new Map();

  for (const [entryKey, entryData] of Object.entries(packages)) {
    if (!entryKey || entryKey === '' || !entryData || typeof entryData !== 'object') continue;
    const { name } = parsePackageKey(entryKey);
    const pkgName = entryData.name || name;
    if (!pkgName) continue;

    const reqs = [];
    if (entryData.dependencies && typeof entryData.dependencies === 'object') {
      reqs.push(...Object.keys(entryData.dependencies));
    }
    if (entryData.optionalDependencies && typeof entryData.optionalDependencies === 'object') {
      reqs.push(...Object.keys(entryData.optionalDependencies));
    }

    if (!pkgRequirements.has(pkgName)) {
      pkgRequirements.set(pkgName, new Set(reqs));
    } else {
      const existing = pkgRequirements.get(pkgName);
      reqs.forEach(r => existing.add(r));
    }
  }

  // BFS traversal initialized from all direct dependencies
  const queue = [];
  for (const directName of rootDirectNames) {
    assignedDepth.set(directName, 1);
    assignedParent.set(directName, null);
    queue.push(directName);
  }

  while (queue.length > 0) {
    const currentName = queue.shift();
    const currentDepth = assignedDepth.get(currentName) || 1;
    const requirements = pkgRequirements.get(currentName) || new Set();

    for (const depName of requirements) {
      if (!assignedDepth.has(depName)) {
        assignedDepth.set(depName, currentDepth + 1);
        assignedParent.set(depName, currentName);
        queue.push(depName);
      }
    }
  }

  return { assignedDepth, assignedParent };
}

/**
 * Parses lockfile v2/v3 `packages` map into normalized dependency records
 */
function parsePackagesSection(packages, { filePath, directDecls, snapshotId, repositoryId }) {
  const { prod, dev, peer, optional } = directDecls;
  const allDirectNames = new Set([
    ...prod.keys(),
    ...dev.keys(),
    ...peer.keys(),
    ...optional.keys()
  ]);

  const { assignedDepth, assignedParent } = computeDependencyGraphDistances(packages, allDirectNames);
  const normalizedRecords = [];
  const seenKeys = new Set();

  for (const [entryKey, entryData] of Object.entries(packages)) {
    if (!entryKey || entryKey === '' || !entryData || typeof entryData !== 'object') {
      // Skip root project entry
      continue;
    }

    const keyInfo = parsePackageKey(entryKey);
    const packageName = entryData.name || keyInfo.name;
    if (!packageName) continue;

    const version = String(entryData.version || '0.0.0').trim();

    // Determine directness:
    // A dependency is direct if it is at top-level node_modules (pathDepth === 1)
    // AND it is explicitly declared in root dependencies / devDependencies / etc.
    const isDeclaredInRoot = allDirectNames.has(packageName);
    const isDirect = keyInfo.depth === 1 && isDeclaredInRoot;

    let depth = 1;
    let parentPackage = null;
    let versionSpecifier = null;
    let dependencyType = 'transitive';

    if (isDirect) {
      depth = 1;
      parentPackage = null;

      if (dev.has(packageName)) {
        dependencyType = 'development';
        versionSpecifier = dev.get(packageName);
      } else if (optional.has(packageName)) {
        dependencyType = 'optional';
        versionSpecifier = optional.get(packageName);
      } else if (peer.has(packageName)) {
        dependencyType = 'peer';
        versionSpecifier = peer.get(packageName);
      } else {
        dependencyType = 'direct';
        versionSpecifier = prod.get(packageName) || null;
      }
    } else {
      // Transitive dependency
      if (keyInfo.depth > 1 && keyInfo.parentName) {
        depth = keyInfo.depth;
        parentPackage = keyInfo.parentName;
      } else {
        depth = assignedDepth.get(packageName) || 2;
        parentPackage = assignedParent.get(packageName) || null;
      }

      if (entryData.dev) {
        dependencyType = 'development';
      } else if (entryData.optional) {
        dependencyType = 'optional';
      } else if (entryData.peer) {
        dependencyType = 'peer';
      } else {
        dependencyType = 'transitive';
      }

      versionSpecifier = null;
    }

    const dedupeKey = `${packageName}@${version}::${parentPackage || ''}::${filePath}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    normalizedRecords.push({
      ecosystem: 'npm',
      packageName,
      normalizedName: normalizePackageName('npm', packageName),
      version,
      versionSpecifier: versionSpecifier || null,
      dependencyType,
      isDirect,
      depth,
      parentPackage: parentPackage || null,
      sourceFile: filePath,
      snapshotId: snapshotId || null,
      repositoryId: repositoryId || null
    });
  }

  return normalizedRecords;
}

/**
 * Traverses legacy npm lockfile `dependencies` hierarchy (v1 / fallback v2)
 */
function parseLegacyDependenciesSection(dependenciesObj, { filePath, directDecls, snapshotId, repositoryId }) {
  const { prod, dev, peer, optional } = directDecls;
  const allDirectNames = new Set([
    ...prod.keys(),
    ...dev.keys(),
    ...peer.keys(),
    ...optional.keys()
  ]);

  const normalizedRecords = [];
  const seenKeys = new Set();

  function walk(deps, currentParent = null, currentDepth = 1) {
    if (!deps || typeof deps !== 'object') return;

    for (const [pkgName, pkgData] of Object.entries(deps)) {
      if (!pkgName || !pkgData || typeof pkgData !== 'object') continue;

      const version = String(pkgData.version || '0.0.0').trim();
      const isDirect = currentDepth === 1 && allDirectNames.has(pkgName);

      let dependencyType = 'transitive';
      let versionSpecifier = null;

      if (isDirect) {
        if (dev.has(pkgName)) {
          dependencyType = 'development';
          versionSpecifier = dev.get(pkgName);
        } else if (optional.has(pkgName) || pkgData.optional) {
          dependencyType = 'optional';
          versionSpecifier = optional.get(pkgName);
        } else if (peer.has(pkgName)) {
          dependencyType = 'peer';
          versionSpecifier = peer.get(pkgName);
        } else {
          dependencyType = 'direct';
          versionSpecifier = prod.get(pkgName) || null;
        }
      } else {
        if (pkgData.dev) {
          dependencyType = 'development';
        } else if (pkgData.optional) {
          dependencyType = 'optional';
        } else {
          dependencyType = 'transitive';
        }
      }

      const dedupeKey = `${pkgName}@${version}::${currentParent || ''}::${filePath}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        normalizedRecords.push({
          ecosystem: 'npm',
          packageName: pkgName,
          normalizedName: normalizePackageName('npm', pkgName),
          version,
          versionSpecifier: versionSpecifier || null,
          dependencyType,
          isDirect,
          depth: currentDepth,
          parentPackage: currentParent || null,
          sourceFile: filePath,
          snapshotId: snapshotId || null,
          repositoryId: repositoryId || null
        });
      }

      if (pkgData.dependencies && typeof pkgData.dependencies === 'object') {
        walk(pkgData.dependencies, pkgName, currentDepth + 1);
      }
    }
  }

  walk(dependenciesObj, null, 1);
  return normalizedRecords;
}

/**
 * Main parser for package-lock.json
 * Supports lockfileVersion 2 and 3 with fallback to 1
 * @param {string} filePath - Path of the lockfile (e.g. 'package-lock.json')
 * @param {string} content - JSON content of package-lock.json
 * @param {Object} [options] - Parsing options
 * @param {string|Object} [options.packageJson] - Accompanying package.json content/object
 * @param {string} [options.snapshotId] - Associated snapshot UUID
 * @param {string} [options.repositoryId] - Associated repository UUID
 * @returns {Object} Parse result with normalized dependency list
 */
export function parsePackageLock(filePath, content, options = {}) {
  const { packageJson = null, snapshotId = null, repositoryId = null } = options;

  if (!content || typeof content !== 'string' || !content.trim()) {
    return {
      success: true,
      sourceFile: filePath,
      lockfileVersion: null,
      totalDependencies: 0,
      directCount: 0,
      transitiveCount: 0,
      dependencies: [],
      warnings: ['Empty or whitespace package-lock.json content']
    };
  }

  let lockfileObj;
  try {
    lockfileObj = JSON.parse(content);
  } catch (err) {
    logger.warn({ filePath, err: err.message }, 'Failed to parse package-lock.json JSON syntax');
    return {
      success: false,
      sourceFile: filePath,
      lockfileVersion: null,
      totalDependencies: 0,
      directCount: 0,
      transitiveCount: 0,
      dependencies: [],
      error: `Failed to parse package-lock.json: ${err.message}`
    };
  }

  if (!lockfileObj || typeof lockfileObj !== 'object') {
    return {
      success: true,
      sourceFile: filePath,
      lockfileVersion: null,
      totalDependencies: 0,
      directCount: 0,
      transitiveCount: 0,
      dependencies: []
    };
  }

  const lockfileVersion = lockfileObj.lockfileVersion || 1;

  // Extract root direct declarations:
  // Prefer packages[''] from lockfile v2/v3, complemented by package.json if provided
  let rootPkgJson = packageJson;
  if (lockfileObj.packages && lockfileObj.packages['']) {
    rootPkgJson = {
      ...extractDirectDeclarations(packageJson),
      ...(lockfileObj.packages[''] || {})
    };
  }

  const directDecls = extractDirectDeclarations(rootPkgJson);

  let dependencies = [];

  // Support `packages` format (v2 and v3)
  if (lockfileObj.packages && typeof lockfileObj.packages === 'object' && Object.keys(lockfileObj.packages).length > 0) {
    dependencies = parsePackagesSection(lockfileObj.packages, {
      filePath,
      directDecls,
      snapshotId,
      repositoryId
    });
  } else if (lockfileObj.dependencies && typeof lockfileObj.dependencies === 'object') {
    // Fallback to legacy `dependencies` object
    dependencies = parseLegacyDependenciesSection(lockfileObj.dependencies, {
      filePath,
      directDecls,
      snapshotId,
      repositoryId
    });
  }

  const directCount = dependencies.filter(d => d.isDirect).length;
  const transitiveCount = dependencies.length - directCount;

  return {
    success: true,
    sourceFile: filePath,
    lockfileVersion,
    totalDependencies: dependencies.length,
    directCount,
    transitiveCount,
    dependencies
  };
}

/**
 * Extracts and normalizes dependencies across all snapshot files (manifests and lockfiles)
 * @param {Array<Object>} files - Snapshot file objects { path, content }
 * @param {Object} [options] - Options { snapshotId, repositoryId }
 * @returns {Object} { dependencies, manifests, sourceSummary }
 */
export function extractDependenciesFromSnapshotFiles(files = [], options = {}) {
  const { snapshotId = null, repositoryId = null } = options;
  const fileMap = new Map();

  for (const f of files) {
    if (f && f.path) {
      fileMap.set(f.path.replace(/\\/g, '/'), f.content || '');
    }
  }

  const allDependencies = [];
  const parsedLockfileDirs = new Set();
  const sourceSummary = [];

  // 1. Process all package-lock.json files
  for (const [filePath, content] of fileMap.entries()) {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('package-lock.json') && !lower.includes('node_modules')) {
      const dir = filePath.substring(0, filePath.lastIndexOf('/') + 1);
      const matchingPackageJsonPath = `${dir}package.json`;
      const packageJsonContent = fileMap.get(matchingPackageJsonPath) || null;

      const result = parsePackageLock(filePath, content, {
        packageJson: packageJsonContent,
        snapshotId,
        repositoryId
      });

      if (result.success && result.dependencies.length > 0) {
        allDependencies.push(...result.dependencies);
        parsedLockfileDirs.add(dir);
        sourceSummary.push({
          sourceFile: filePath,
          type: 'lockfile',
          ecosystem: 'npm',
          lockfileVersion: result.lockfileVersion,
          total: result.totalDependencies,
          direct: result.directCount,
          transitive: result.transitiveCount
        });
      }
    }
  }

  // 2. Process package.json files ONLY in directories that did NOT have package-lock.json
  for (const [filePath, content] of fileMap.entries()) {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('package.json') && !lower.includes('node_modules')) {
      const dir = filePath.substring(0, filePath.lastIndexOf('/') + 1);
      if (parsedLockfileDirs.has(dir)) {
        // Lockfile already provided complete direct + transitive inventory for this directory
        continue;
      }

      try {
        const pkg = JSON.parse(content || '{}');
        const directDecls = extractDirectDeclarations(pkg);
        let count = 0;

        const addDep = (name, spec, type) => {
          allDependencies.push({
            ecosystem: 'npm',
            packageName: name,
            normalizedName: normalizePackageName('npm', name),
            version: String(spec || '*').replace(/^[\^~>=<]+/, '').trim() || '1.0.0',
            versionSpecifier: String(spec || '*'),
            dependencyType: type,
            isDirect: true,
            depth: 1,
            parentPackage: null,
            sourceFile: filePath,
            snapshotId,
            repositoryId
          });
          count++;
        };

        for (const [name, spec] of directDecls.prod) addDep(name, spec, 'direct');
        for (const [name, spec] of directDecls.dev) addDep(name, spec, 'development');
        for (const [name, spec] of directDecls.peer) addDep(name, spec, 'peer');
        for (const [name, spec] of directDecls.optional) addDep(name, spec, 'optional');

        sourceSummary.push({
          sourceFile: filePath,
          type: 'manifest',
          ecosystem: 'npm',
          lockfileVersion: null,
          total: count,
          direct: count,
          transitive: 0
        });
      } catch (err) {
        logger.warn({ filePath, err: err.message }, 'Failed to parse package.json fallback');
      }
    }
  }

  // 3. Process requirements.txt for Python (PyPI)
  for (const [filePath, content] of fileMap.entries()) {
    const lower = filePath.toLowerCase();
    if ((lower.endsWith('requirements.txt') || lower.endsWith('requirements-dev.txt')) && !lower.includes('site-packages')) {
      const lines = (content || '').split('\n');
      let count = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-r') || trimmed.startsWith('-i')) continue;
        const match = trimmed.match(/^([a-zA-Z0-9_\-\.]+)\s*([><=!~^].*)?$/);
        if (match) {
          const name = match[1];
          const spec = match[2] ? match[2].trim() : '*';
          const version = spec.replace(/^[\^~>=<]+/, '').trim() || '1.0.0';

          allDependencies.push({
            ecosystem: 'pypi',
            packageName: name,
            normalizedName: normalizePackageName('pypi', name),
            version,
            versionSpecifier: spec,
            dependencyType: 'direct',
            isDirect: true,
            depth: 1,
            parentPackage: null,
            sourceFile: filePath,
            snapshotId,
            repositoryId
          });
          count++;
        }
      }

      sourceSummary.push({
        sourceFile: filePath,
        type: 'manifest',
        ecosystem: 'pypi',
        lockfileVersion: null,
        total: count,
        direct: count,
        transitive: 0
      });
    }
  }

  // Deduplicate records that match on (ecosystem, packageName, version, sourceFile, parentPackage)
  const deduped = [];
  const seen = new Set();
  for (const d of allDependencies) {
    const key = `${d.ecosystem}::${d.packageName}::${d.version}::${d.sourceFile}::${d.parentPackage || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(d);
    }
  }

  return {
    totalDependencies: deduped.length,
    directCount: deduped.filter(d => d.isDirect).length,
    transitiveCount: deduped.filter(d => !d.isDirect).length,
    dependencies: deduped,
    sourceSummary
  };
}

/**
 * Persists normalized dependency records to PostgreSQL snapshot_dependencies table
 * Fully idempotent using ON CONFLICT UPSERT semantics
 * @param {string} snapshotId - Snapshot UUID
 * @param {string} repositoryId - Repository UUID
 * @param {Array<Object>} dependencies - Normalized dependency records
 * @param {Object} [clientOrPool=pool] - PostgreSQL pool or client
 * @returns {Promise<Object>} Persistence summary { inserted, total }
 */
export function buildDependencyUpsertQuery(depsChunk, snapshotId, repositoryId) {
  const valueClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const dep of depsChunk) {
    const p1 = paramIndex++;
    const p2 = paramIndex++;
    const p3 = paramIndex++;
    const p4 = paramIndex++;
    const p5 = paramIndex++;
    const p6 = paramIndex++;
    const p7 = paramIndex++;
    const p8 = paramIndex++;
    const p9 = paramIndex++;
    const p10 = paramIndex++;
    const p11 = paramIndex++;
    const p12 = paramIndex++;

    valueClauses.push(
      `($${p1}, $${p2}, $${p3}, $${p4}, $${p5}, $${p6}, $${p7}, $${p8}, $${p9}, $${p10}, $${p11}, $${p12})`
    );

    values.push(
      snapshotId,
      repositoryId,
      dep.ecosystem || 'npm',
      dep.packageName,
      dep.normalizedName || normalizePackageName(dep.ecosystem, dep.packageName),
      dep.version || '0.0.0',
      dep.versionSpecifier || null,
      dep.dependencyType || 'direct',
      dep.isDirect !== undefined ? Boolean(dep.isDirect) : true,
      Number.isInteger(dep.depth) ? dep.depth : 1,
      dep.parentPackage || '',
      dep.sourceFile || 'manifest'
    );
  }

  const query = `
    INSERT INTO snapshot_dependencies (
      snapshot_id,
      repository_id,
      ecosystem,
      package_name,
      normalized_name,
      version,
      version_specifier,
      dependency_type,
      is_direct,
      depth,
      parent_package,
      source_file
    ) VALUES ${valueClauses.join(', ')}
    ON CONFLICT (snapshot_id, ecosystem, package_name, version, source_file, parent_package)
    DO UPDATE SET
      normalized_name = EXCLUDED.normalized_name,
      version_specifier = EXCLUDED.version_specifier,
      dependency_type = EXCLUDED.dependency_type,
      is_direct = EXCLUDED.is_direct,
      depth = EXCLUDED.depth
    RETURNING id;
  `;

  return { query, values };
}

export async function persistSnapshotDependencies(snapshotId, repositoryId, dependencies = [], clientOrPool = pool) {
  if (!snapshotId || !repositoryId) {
    throw new Error('snapshotId and repositoryId are required to persist dependencies');
  }

  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    return { inserted: 0, total: 0 };
  }

  // Insert in chunks of 100 to avoid excessive parameters in single statement
  const CHUNK_SIZE = 100;
  let totalPersisted = 0;

  for (let i = 0; i < dependencies.length; i += CHUNK_SIZE) {
    const chunk = dependencies.slice(i, i + CHUNK_SIZE);
    const { query, values } = buildDependencyUpsertQuery(chunk, snapshotId, repositoryId);

    const { rowCount } = await clientOrPool.query(query, values);
    totalPersisted += (rowCount || chunk.length);
  }

  logger.info(
    { snapshotId, repositoryId, totalDependencies: dependencies.length, totalPersisted },
    'Successfully persisted snapshot dependencies to PostgreSQL'
  );

  return {
    inserted: totalPersisted,
    total: dependencies.length
  };
}

/**
 * Retrieves persisted dependencies for a snapshot from PostgreSQL
 * @param {string} snapshotId - Snapshot UUID
 * @param {Object} [options]
 * @param {boolean} [options.isDirect] - Optional filter for direct dependencies only
 * @param {string} [options.ecosystem] - Optional filter for ecosystem
 * @param {Object} [options.clientOrPool=pool] - PostgreSQL pool or client
 * @returns {Promise<Array<Object>>} Normalized dependency records
 */
export async function getPersistedSnapshotDependencies(snapshotId, options = {}) {
  const { isDirect = null, ecosystem = null, clientOrPool = pool } = options;

  let query = `
    SELECT
      id,
      snapshot_id,
      repository_id,
      ecosystem,
      package_name,
      normalized_name,
      version,
      version_specifier,
      dependency_type,
      is_direct,
      depth,
      parent_package,
      source_file,
      created_at
    FROM snapshot_dependencies
    WHERE snapshot_id = $1
  `;
  const params = [snapshotId];

  if (typeof isDirect === 'boolean') {
    params.push(isDirect);
    query += ` AND is_direct = $${params.length}`;
  }

  if (ecosystem) {
    params.push(ecosystem.toLowerCase());
    query += ` AND LOWER(ecosystem) = $${params.length}`;
  }

  query += ` ORDER BY is_direct DESC, depth ASC, package_name ASC`;

  const { rows } = await clientOrPool.query(query, params);

  return rows.map(r => ({
    id: r.id,
    snapshotId: r.snapshot_id,
    repositoryId: r.repository_id,
    ecosystem: r.ecosystem,
    packageName: r.package_name,
    normalizedName: r.normalized_name,
    version: r.version,
    versionSpecifier: r.version_specifier,
    dependencyType: r.dependency_type,
    isDirect: r.is_direct,
    depth: r.depth,
    parentPackage: r.parent_package || null,
    sourceFile: r.source_file,
    createdAt: r.created_at
  }));
}
