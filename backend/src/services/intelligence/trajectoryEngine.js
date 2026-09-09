/**
 * Longitudinal Security Trajectory & Diff Engine
 * Checkpoint 9 Phase F
 *
 * Evaluates vulnerability delta states across historical repository snapshots:
 * - NEW: Vulnerabilities present in current snapshot but absent in prior snapshot
 * - PERSISTENT: Vulnerabilities continuing from prior snapshot
 * - RESOLVED: Vulnerabilities present in prior snapshot that have been remediated
 * Also tracks dependency version transitions (ADDED, REMOVED, UPGRADED, DOWNGRADED, UNCHANGED).
 */

import semver from 'semver';
import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';

/**
 * Classifies the version transition between two semver versions
 * @param {string} oldVersion
 * @param {string} newVersion
 * @returns {'ADDED'|'REMOVED'|'UPGRADED'|'DOWNGRADED'|'UNCHANGED'}
 */
export function classifyVersionTransition(oldVersion, newVersion) {
  if (!oldVersion && newVersion) return 'ADDED';
  if (oldVersion && !newVersion) return 'REMOVED';
  if (oldVersion === newVersion) return 'UNCHANGED';

  const cleanOld = semver.clean(oldVersion) || semver.coerce(oldVersion)?.version;
  const cleanNew = semver.clean(newVersion) || semver.coerce(newVersion)?.version;

  if (cleanOld && cleanNew) {
    if (semver.gt(cleanNew, cleanOld)) return 'UPGRADED';
    if (semver.lt(cleanNew, cleanOld)) return 'DOWNGRADED';
  }

  return 'UNCHANGED';
}

/**
 * Computes vulnerability and dependency deltas between two snapshots
 * @param {string} baseSnapshotId - Prior snapshot ID (S_{t-1})
 * @param {string} targetSnapshotId - Current snapshot ID (S_t)
 * @param {Object} dbPool
 * @returns {Promise<Object>}
 */
export async function compareSnapshots(baseSnapshotId, targetSnapshotId, dbPool = pool) {
  if (!targetSnapshotId) {
    throw new Error('targetSnapshotId is required');
  }

  // 1. Fetch vulnerabilities for target snapshot
  const targetVulnsQuery = `
    SELECT *
    FROM snapshot_vulnerabilities
    WHERE snapshot_id = $1
  `;
  const { rows: targetVulns } = await dbPool.query(targetVulnsQuery, [targetSnapshotId]);

  // 2. Fetch vulnerabilities for base snapshot (if provided)
  let baseVulns = [];
  if (baseSnapshotId) {
    const baseVulnsQuery = `
      SELECT *
      FROM snapshot_vulnerabilities
      WHERE snapshot_id = $1
    `;
    const { rows: bRows } = await dbPool.query(baseVulnsQuery, [baseSnapshotId]);
    baseVulns = bRows;
  }

  // Build lookup maps by `${packageName}:::${canonicalId}`
  const baseMap = new Map();
  for (const v of baseVulns) {
    baseMap.set(`${v.package_name}:::${v.canonical_id}`, v);
  }

  const targetMap = new Map();
  for (const v of targetVulns) {
    targetMap.set(`${v.package_name}:::${v.canonical_id}`, v);
  }

  const newFindings = [];
  const persistentFindings = [];
  const resolvedFindings = [];

  for (const [key, v] of targetMap.entries()) {
    if (baseMap.has(key)) {
      persistentFindings.push({
        ...v,
        trajectoryStatus: 'PERSISTENT'
      });
    } else {
      newFindings.push({
        ...v,
        trajectoryStatus: 'NEW'
      });
    }
  }

  for (const [key, v] of baseMap.entries()) {
    if (!targetMap.has(key)) {
      resolvedFindings.push({
        ...v,
        trajectoryStatus: 'RESOLVED'
      });
    }
  }

  // 3. Compare dependency transitions
  const targetDepsQuery = `
    SELECT package_name, ecosystem, version, is_direct
    FROM snapshot_dependencies
    WHERE snapshot_id = $1
  `;
  const { rows: targetDeps } = await dbPool.query(targetDepsQuery, [targetSnapshotId]);

  let baseDeps = [];
  if (baseSnapshotId) {
    const baseDepsQuery = `
      SELECT package_name, ecosystem, version, is_direct
      FROM snapshot_dependencies
      WHERE snapshot_id = $1
    `;
    const { rows: bDeps } = await dbPool.query(baseDepsQuery, [baseSnapshotId]);
    baseDeps = bDeps;
  }

  const baseDepMap = new Map(baseDeps.map(d => [d.package_name, d]));
  const targetDepMap = new Map(targetDeps.map(d => [d.package_name, d]));

  const dependencyTransitions = [];
  const allPkgNames = new Set([...baseDepMap.keys(), ...targetDepMap.keys()]);

  for (const pkgName of allPkgNames) {
    const base = baseDepMap.get(pkgName);
    const target = targetDepMap.get(pkgName);
    const transition = classifyVersionTransition(base?.version, target?.version);

    if (transition !== 'UNCHANGED') {
      dependencyTransitions.push({
        packageName: pkgName,
        ecosystem: target?.ecosystem || base?.ecosystem,
        isDirect: target?.is_direct ?? base?.is_direct ?? true,
        previousVersion: base?.version || null,
        currentVersion: target?.version || null,
        transition
      });
    }
  }

  return {
    baseSnapshotId,
    targetSnapshotId,
    newFindings,
    persistentFindings,
    resolvedFindings,
    metrics: {
      newCount: newFindings.length,
      persistentCount: persistentFindings.length,
      resolvedCount: resolvedFindings.length
    },
    dependencyTransitions
  };
}

/**
 * Retrieves the full historical security trajectory timeline for a repository
 * @param {string} repositoryId
 * @param {Object} dbPool
 * @returns {Promise<Array<Object>>}
 */
export async function getRepositorySecurityTrajectory(repositoryId, dbPool = pool) {
  // Query snapshots with completed security scans ordered by creation date ASC
  const query = `
    SELECT
      s.id AS snapshot_id,
      s.commit_sha,
      s.branch,
      s.created_at AS snapshot_created_at,
      sc.id AS scan_id,
      sc.security_score,
      sc.total_dependencies,
      sc.vulnerable_packages,
      sc.total_vulnerabilities,
      sc.critical_count,
      sc.high_count,
      sc.medium_count,
      sc.low_count,
      sc.unknown_count,
      sc.direct_vulnerabilities,
      sc.transitive_vulnerabilities,
      sc.completed_at
    FROM repository_snapshots s
    JOIN security_scans sc ON s.id = sc.snapshot_id
    WHERE s.repository_id = $1 AND sc.status = 'completed'
    ORDER BY s.created_at ASC
  `;

  const { rows } = await dbPool.query(query, [repositoryId]);
  if (rows.length === 0) {
    return [];
  }

  // Calculate deltas along the timeline
  const timeline = [];
  let prevSnapshotId = null;

  for (let i = 0; i < rows.length; i++) {
    const current = rows[i];
    let newCount = 0;
    let resolvedCount = 0;
    let persistentCount = current.total_vulnerabilities;

    if (prevSnapshotId) {
      try {
        const diff = await compareSnapshots(prevSnapshotId, current.snapshot_id, dbPool);
        newCount = diff.metrics.newCount;
        resolvedCount = diff.metrics.resolvedCount;
        persistentCount = diff.metrics.persistentCount;
      } catch (err) {
        logger.warn({ err: err.message }, 'Error comparing snapshots for trajectory point');
      }
    }

    timeline.push({
      snapshotId: current.snapshot_id,
      commitSha: current.commit_sha,
      commitMessage: null,
      branch: current.branch,
      date: current.snapshot_created_at,
      securityScore: current.security_score,
      totalDependencies: current.total_dependencies,
      vulnerablePackages: current.vulnerable_packages,
      totalVulnerabilities: current.total_vulnerabilities,
      criticalCount: current.critical_count,
      highCount: current.high_count,
      mediumCount: current.medium_count,
      lowCount: current.low_count,
      unknownCount: current.unknown_count,
      directVulnerabilities: current.direct_vulnerabilities,
      transitiveVulnerabilities: current.transitive_vulnerabilities,
      newFindingsCount: newCount,
      resolvedFindingsCount: resolvedCount,
      persistentFindingsCount: persistentCount
    });

    prevSnapshotId = current.snapshot_id;
  }

  return timeline;
}
