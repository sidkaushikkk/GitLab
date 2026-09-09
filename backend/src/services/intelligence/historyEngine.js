/**
 * Multi-Snapshot Longitudinal Engineering Intelligence & Trajectory Engine
 * Checkpoint 10 Phase C
 *
 * Implements deterministic historical comparison across repository snapshots:
 * - Chronological snapshot ordering based on commit_timestamp and created_at
 * - Mathematical metric deltas with safe zero-denominator handling
 * - File-level longitudinal changes (added, removed, modified, unchanged) and quality regressions
 * - Duplication trajectory (new, persistent, resolved, changed clones)
 * - Reuses CP9 dependency evolution and security trajectory
 * - Baseline handling for single-snapshot repositories
 */

import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';
import { compareSnapshots as compareSecuritySnapshots } from './trajectoryEngine.js';

/**
 * Safely calculates percentage change between two numbers without NaN or Infinity
 * @param {number} previous
 * @param {number} current
 * @returns {number} Percentage change rounded to 2 decimal places
 */
export function calculatePercentageDelta(previous, current) {
  const prev = Number(previous) || 0;
  const curr = Number(current) || 0;

  if (prev === 0 && curr === 0) return 0;
  if (prev === 0) return curr > 0 ? 100.0 : -100.0;

  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  return Number.isFinite(pct) ? Number(pct.toFixed(2)) : 0;
}

/**
 * Calculates deterministic metric delta envelope
 * @param {number} previous
 * @param {number} current
 * @returns {Object} { previous, current, absoluteDelta, percentageDelta }
 */
export function buildMetricDelta(previous, current) {
  const prev = Number(previous) || 0;
  const curr = Number(current) || 0;
  const absoluteDelta = Number((curr - prev).toFixed(4));
  const percentageDelta = calculatePercentageDelta(prev, curr);

  return {
    previous: prev,
    current: curr,
    absoluteDelta,
    percentageDelta
  };
}

/**
 * Retrieves chronological completed snapshots for a repository
 * @param {string} repositoryId
 * @param {Object} [dbPool=pool]
 * @returns {Promise<Array<Object>>}
 */
export async function getChronologicalSnapshots(repositoryId, dbPool = pool) {
  const query = `
    SELECT
      s.id,
      s.repository_id,
      s.commit_sha,
      s.branch,
      s.status,
      s.total_files,
      s.included_files,
      s.total_bytes,
      s.created_at,
      s.completed_at,
      s.commit_timestamp,
      COALESCE(s.commit_timestamp, s.created_at) AS sort_timestamp
    FROM repository_snapshots s
    WHERE s.repository_id = $1 AND s.status = 'completed'
    ORDER BY COALESCE(s.commit_timestamp, s.created_at) ASC, s.id ASC
  `;

  const { rows } = await dbPool.query(query, [repositoryId]);
  return rows;
}

/**
 * Loads snapshot metrics aggregate from analysis_runs, metrics, duplication, and security
 * @param {string} snapshotId
 * @param {string} repositoryId
 * @param {Object} [dbPool=pool]
 * @returns {Promise<Object>}
 */
export async function getSnapshotMetricsProfile(snapshotId, repositoryId, dbPool = pool) {
  // 1. Fetch latest completed analysis run
  const runQuery = `
    SELECT
      id, total_files_analyzed, total_symbols, total_relationships,
      total_smells, completed_at
    FROM analysis_runs
    WHERE snapshot_id = $1 AND repository_id = $2 AND status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 1
  `;
  const { rows: runRows } = await dbPool.query(runQuery, [snapshotId, repositoryId]);
  const run = runRows[0] || null;

  // 2. Fetch aggregate AST metrics (lines, complexity, functions, classes)
  let totalLines = 0;
  let avgComplexity = 0;
  let maxComplexity = 0;
  let functionCount = 0;
  let classCount = 0;
  let importCount = 0;
  let exportCount = 0;
  let testGuardedFiles = 0;
  let totalSourceFiles = 0;

  if (run) {
    const fileMetricsQuery = `
      SELECT
        m.entity_id,
        MAX(CASE WHEN m.metric_name = 'physicalLines' THEN m.metric_value ELSE 0 END) as lines,
        MAX(CASE WHEN m.metric_name = 'cyclomaticComplexity' THEN m.metric_value ELSE 0 END) as complexity,
        MAX(CASE WHEN m.metric_name = 'functionCount' THEN m.metric_value ELSE 0 END) as functions,
        MAX(CASE WHEN m.metric_name = 'classCount' THEN m.metric_value ELSE 0 END) as classes,
        MAX(CASE WHEN m.metric_name = 'importCount' THEN m.metric_value ELSE 0 END) as imports,
        MAX(CASE WHEN m.metric_name = 'exportCount' THEN m.metric_value ELSE 0 END) as exports,
        MAX(CASE WHEN m.metric_name = 'hasTest' THEN m.metric_value ELSE 0 END) as has_test
      FROM metrics m
      WHERE m.analysis_run_id = $1 AND m.entity_type = 'file'
      GROUP BY m.entity_id
    `;
    const { rows: fileMetrics } = await dbPool.query(fileMetricsQuery, [run.id]);
    totalSourceFiles = fileMetrics.length;

    let totalComp = 0;
    for (const fm of fileMetrics) {
      totalLines += Number(fm.lines) || 0;
      const comp = Number(fm.complexity) || 1;
      totalComp += comp;
      if (comp > maxComplexity) maxComplexity = comp;
      functionCount += Number(fm.functions) || 0;
      classCount += Number(fm.classes) || 0;
      importCount += Number(fm.imports) || 0;
      exportCount += Number(fm.exports) || 0;
      if (Number(fm.has_test) === 1) testGuardedFiles++;
    }

    avgComplexity = totalSourceFiles > 0
      ? Number((totalComp / totalSourceFiles).toFixed(2))
      : 0;
  }

  // 3. Fetch duplication summary
  const dupQuery = `
    SELECT
      total_source_lines, duplicated_lines, duplication_ratio,
      clone_count, clone_group_count, intra_file_clones, inter_file_clones
    FROM snapshot_duplication_summaries
    WHERE snapshot_id = $1
  `;
  const { rows: dupRows } = await dbPool.query(dupQuery, [snapshotId]);
  const dup = dupRows[0] || {
    total_source_lines: totalLines,
    duplicated_lines: 0,
    duplication_ratio: 0,
    clone_count: 0,
    clone_group_count: 0,
    intra_file_clones: 0,
    inter_file_clones: 0
  };

  // 4. Fetch security scan summary
  const secQuery = `
    SELECT
      security_score, total_dependencies, vulnerable_packages,
      total_vulnerabilities, critical_count, high_count, medium_count, low_count
    FROM security_scans
    WHERE snapshot_id = $1 AND status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 1
  `;
  const { rows: secRows } = await dbPool.query(secQuery, [snapshotId]);
  const sec = secRows[0] || {
    security_score: 100,
    total_dependencies: 0,
    vulnerable_packages: 0,
    total_vulnerabilities: 0,
    critical_count: 0,
    high_count: 0,
    medium_count: 0,
    low_count: 0
  };

  // 5. Test Guard percentage
  const testGuardRatio = totalSourceFiles > 0
    ? Number(((testGuardedFiles / totalSourceFiles) * 100).toFixed(1))
    : 0;

  // Composite Quality Maintainability Score (0 - 100 deterministic formula)
  const totalSmells = run ? run.total_smells : 0;
  const maintainability = Math.max(
    10,
    Math.min(
      100,
      Math.round(
        100 -
        (avgComplexity * 2.5) -
        (dup.duplication_ratio * 30) -
        (totalSmells * 1.5)
      )
    )
  );

  return {
    snapshotId,
    analysisRunId: run ? run.id : null,
    totalFiles: totalSourceFiles,
    totalLines: totalLines || dup.total_source_lines || 0,
    functionCount,
    classCount,
    importCount,
    exportCount,
    avgComplexity,
    maxComplexity,
    totalSmells,
    maintainability,
    duplication: {
      totalSourceLines: dup.total_source_lines,
      duplicatedLines: dup.duplicated_lines,
      duplicationRatio: Number(dup.duplication_ratio),
      cloneCount: dup.clone_count,
      cloneGroupCount: dup.clone_group_count,
      intraFileClones: dup.intra_file_clones,
      interFileClones: dup.inter_file_clones
    },
    security: {
      securityScore: sec.security_score,
      totalDependencies: sec.total_dependencies,
      vulnerablePackages: sec.vulnerable_packages,
      totalVulnerabilities: sec.total_vulnerabilities,
      criticalCount: sec.critical_count,
      highCount: sec.high_count,
      mediumCount: sec.medium_count,
      lowCount: sec.low_count
    },
    testGuard: {
      guardedFiles: testGuardedFiles,
      totalFiles: totalSourceFiles,
      guardPercentage: testGuardRatio
    }
  };
}

/**
 * Compares detailed file-level AST metrics between base and target snapshots
 * @param {string} baseSnapshotId
 * @param {string} targetSnapshotId
 * @param {Object} [dbPool=pool]
 * @returns {Promise<Object>}
 */
export async function compareFileLevelChanges(baseSnapshotId, targetSnapshotId, dbPool = pool) {
  // Query files and metrics for target snapshot
  const targetFilesQuery = `
    SELECT
      af.file_path,
      af.line_count,
      MAX(CASE WHEN m.metric_name = 'cyclomaticComplexity' THEN m.metric_value ELSE 1 END) as complexity,
      MAX(CASE WHEN m.metric_name = 'codeSmellCount' THEN m.metric_value ELSE 0 END) as smells
    FROM analysis_runs ar
    JOIN analysis_files af ON ar.id = af.analysis_run_id
    LEFT JOIN metrics m ON ar.id = m.analysis_run_id AND m.entity_type = 'file' AND m.entity_id = af.file_path
    WHERE ar.snapshot_id = $1 AND ar.status = 'completed'
    GROUP BY af.file_path, af.line_count
  `;
  const { rows: targetFiles } = await dbPool.query(targetFilesQuery, [targetSnapshotId]);

  let baseFiles = [];
  if (baseSnapshotId) {
    const { rows: bRows } = await dbPool.query(targetFilesQuery, [baseSnapshotId]);
    baseFiles = bRows;
  }

  const baseMap = new Map();
  for (const f of baseFiles) {
    baseMap.set(f.file_path, {
      filePath: f.file_path,
      lineCount: Number(f.line_count) || 0,
      complexity: Number(f.complexity) || 1,
      smells: Number(f.smells) || 0
    });
  }

  const targetMap = new Map();
  for (const f of targetFiles) {
    targetMap.set(f.file_path, {
      filePath: f.file_path,
      lineCount: Number(f.line_count) || 0,
      complexity: Number(f.complexity) || 1,
      smells: Number(f.smells) || 0
    });
  }

  const addedFiles = [];
  const removedFiles = [];
  const modifiedFiles = [];
  const unchangedFiles = [];
  const qualityRegressions = [];

  // Check target files against base
  for (const [filePath, target] of targetMap.entries()) {
    if (!baseMap.has(filePath)) {
      addedFiles.push({
        filePath,
        lines: target.lineCount,
        complexity: target.complexity,
        smells: target.smells,
        changeType: 'ADDED'
      });
    } else {
      const base = baseMap.get(filePath);
      const linesDelta = target.lineCount - base.lineCount;
      const complexityDelta = target.complexity - base.complexity;
      const smellsDelta = target.smells - base.smells;

      const isModified = linesDelta !== 0 || complexityDelta !== 0 || smellsDelta !== 0;

      if (!isModified) {
        unchangedFiles.push({
          filePath,
          lines: target.lineCount,
          complexity: target.complexity,
          smells: target.smells,
          changeType: 'UNCHANGED'
        });
      } else {
        const regressionFactors = [];
        if (complexityDelta > 0) {
          regressionFactors.push(`Complexity increased (+${complexityDelta})`);
        }
        if (smellsDelta > 0) {
          regressionFactors.push(`Code smells introduced (+${smellsDelta})`);
        }
        if (linesDelta > 50 && complexityDelta > 0) {
          regressionFactors.push(`Large churn (+${linesDelta} LOC) with rising complexity`);
        }

        const isRegression = regressionFactors.length > 0;
        const isImprovement = complexityDelta < 0 || smellsDelta < 0;

        const modRecord = {
          filePath,
          previousLines: base.lineCount,
          currentLines: target.lineCount,
          linesDelta,
          previousComplexity: base.complexity,
          currentComplexity: target.complexity,
          complexityDelta,
          previousSmells: base.smells,
          currentSmells: target.smells,
          smellsDelta,
          isRegression,
          isImprovement,
          regressionFactors,
          changeType: 'MODIFIED'
        };

        modifiedFiles.push(modRecord);
        if (isRegression) {
          qualityRegressions.push(modRecord);
        }
      }
    }
  }

  // Check removed files (in base but not target)
  for (const [filePath, base] of baseMap.entries()) {
    if (!targetMap.has(filePath)) {
      removedFiles.push({
        filePath,
        lines: base.lineCount,
        complexity: base.complexity,
        smells: base.smells,
        changeType: 'REMOVED'
      });
    }
  }

  return {
    added: addedFiles,
    removed: removedFiles,
    modified: modifiedFiles,
    unchanged: unchangedFiles,
    qualityRegressions,
    summary: {
      addedCount: addedFiles.length,
      removedCount: removedFiles.length,
      modifiedCount: modifiedFiles.length,
      unchangedCount: unchangedFiles.length,
      regressionCount: qualityRegressions.length
    }
  };
}

/**
 * Compares code duplication between two snapshots
 * @param {string} baseSnapshotId
 * @param {string} targetSnapshotId
 * @param {Object} [dbPool=pool]
 * @returns {Promise<Object>}
 */
export async function compareDuplicationBetweenSnapshots(baseSnapshotId, targetSnapshotId, dbPool = pool) {
  // Fetch target duplications
  const { rows: targetClones } = await dbPool.query(
    'SELECT clone_hash, clone_type, token_count, line_count, is_intra_file, instances FROM snapshot_duplications WHERE snapshot_id = $1',
    [targetSnapshotId]
  );

  let baseClones = [];
  if (baseSnapshotId) {
    const { rows: bRows } = await dbPool.query(
      'SELECT clone_hash, clone_type, token_count, line_count, is_intra_file, instances FROM snapshot_duplications WHERE snapshot_id = $1',
      [baseSnapshotId]
    );
    baseClones = bRows;
  }

  const baseMap = new Map(baseClones.map(c => [c.clone_hash, c]));
  const targetMap = new Map(targetClones.map(c => [c.clone_hash, c]));

  const newClones = [];
  const persistentClones = [];
  const resolvedClones = [];
  const changedClones = [];

  for (const [hash, target] of targetMap.entries()) {
    if (baseMap.has(hash)) {
      const base = baseMap.get(hash);
      const baseInstCount = Array.isArray(base.instances) ? base.instances.length : 0;
      const targetInstCount = Array.isArray(target.instances) ? target.instances.length : 0;

      if (baseInstCount !== targetInstCount) {
        changedClones.push({
          cloneHash: hash,
          cloneType: target.clone_type,
          tokenCount: target.token_count,
          lineCount: target.line_count,
          previousInstancesCount: baseInstCount,
          currentInstancesCount: targetInstCount,
          instancesDelta: targetInstCount - baseInstCount,
          instances: target.instances,
          trajectoryStatus: 'CHANGED'
        });
      } else {
        persistentClones.push({
          cloneHash: hash,
          cloneType: target.clone_type,
          tokenCount: target.token_count,
          lineCount: target.line_count,
          instances: target.instances,
          trajectoryStatus: 'PERSISTENT'
        });
      }
    } else {
      newClones.push({
        cloneHash: hash,
        cloneType: target.clone_type,
        tokenCount: target.token_count,
        lineCount: target.line_count,
        instances: target.instances,
        trajectoryStatus: 'NEW'
      });
    }
  }

  for (const [hash, base] of baseMap.entries()) {
    if (!targetMap.has(hash)) {
      resolvedClones.push({
        cloneHash: hash,
        cloneType: base.clone_type,
        tokenCount: base.token_count,
        lineCount: base.line_count,
        instances: base.instances,
        trajectoryStatus: 'RESOLVED'
      });
    }
  }

  return {
    newClones,
    persistentClones,
    resolvedClones,
    changedClones,
    summary: {
      newCloneCount: newClones.length,
      persistentCloneCount: persistentClones.length,
      resolvedCloneCount: resolvedClones.length,
      changedCloneCount: changedClones.length
    }
  };
}

/**
 * Performs full multi-dimensional longitudinal comparison between two snapshots
 * @param {string} repositoryId
 * @param {string} baseSnapshotId
 * @param {string} targetSnapshotId
 * @param {Object} [dbPool=pool]
 * @returns {Promise<Object>}
 */
export async function compareSnapshotsDetailed(repositoryId, baseSnapshotId, targetSnapshotId, dbPool = pool) {
  if (!targetSnapshotId) {
    throw new Error('targetSnapshotId is required');
  }

  // Reject comparison with itself
  if (baseSnapshotId && baseSnapshotId !== 'none' && baseSnapshotId === targetSnapshotId) {
    const err = new Error('Base and target snapshots must be distinct snapshots.');
    err.status = 400;
    throw err;
  }

  // 1. Verify snapshots belong to repository
  const verifyQuery = `
    SELECT id, commit_sha, branch, created_at, commit_timestamp
    FROM repository_snapshots
    WHERE id IN ($1, $2) AND repository_id = $3
  `;
  const { rows: verifiedRows } = await dbPool.query(
    verifyQuery,
    baseSnapshotId && baseSnapshotId !== 'none' ? [baseSnapshotId, targetSnapshotId, repositoryId] : [targetSnapshotId, targetSnapshotId, repositoryId]
  );

  const snapshotMap = new Map(verifiedRows.map(r => [r.id, r]));
  const targetMeta = snapshotMap.get(targetSnapshotId);
  const baseMeta = baseSnapshotId && baseSnapshotId !== 'none' ? snapshotMap.get(baseSnapshotId) : null;

  if (!targetMeta) {
    const err = new Error('Target snapshot not found for this repository.');
    err.status = 404;
    throw err;
  }
  if (baseSnapshotId && baseSnapshotId !== 'none' && !baseMeta) {
    const err = new Error('Base snapshot not found for this repository.');
    err.status = 404;
    throw err;
  }

  // If no base snapshot provided (single snapshot baseline state), return null deltas without fabricating from zero
  if (!baseSnapshotId || baseSnapshotId === 'none') {
    const targetProfile = await getSnapshotMetricsProfile(targetSnapshotId, repositoryId, dbPool);
    return {
      repositoryId,
      base: null,
      target: {
        id: targetMeta.id,
        snapshotId: targetMeta.id,
        commitSha: targetMeta.commit_sha,
        branch: targetMeta.branch,
        date: targetMeta.commit_timestamp || targetMeta.created_at,
        profile: targetProfile
      },
      isBaseline: true,
      deltas: null
    };
  }

  // 2. Fetch metric profiles for both actual distinct snapshots
  const [baseProfile, targetProfile] = await Promise.all([
    getSnapshotMetricsProfile(baseSnapshotId, repositoryId, dbPool),
    getSnapshotMetricsProfile(targetSnapshotId, repositoryId, dbPool)
  ]);

  // 3. Compute code metric deltas between the two actual snapshots
  const metricDeltas = {
    totalFiles: buildMetricDelta(baseProfile.totalFiles, targetProfile.totalFiles),
    totalLines: buildMetricDelta(baseProfile.totalLines, targetProfile.totalLines),
    functionCount: buildMetricDelta(baseProfile.functionCount, targetProfile.functionCount),
    classCount: buildMetricDelta(baseProfile.classCount, targetProfile.classCount),
    avgComplexity: buildMetricDelta(baseProfile.avgComplexity, targetProfile.avgComplexity),
    maxComplexity: buildMetricDelta(baseProfile.maxComplexity, targetProfile.maxComplexity),
    totalSmells: buildMetricDelta(baseProfile.totalSmells, targetProfile.totalSmells),
    maintainability: buildMetricDelta(baseProfile.maintainability, targetProfile.maintainability),
    duplicationRatio: buildMetricDelta(baseProfile.duplication.duplicationRatio, targetProfile.duplication.duplicationRatio),
    duplicatedLines: buildMetricDelta(baseProfile.duplication.duplicatedLines, targetProfile.duplication.duplicatedLines),
    securityScore: buildMetricDelta(baseProfile.security.securityScore, targetProfile.security.securityScore),
    totalVulnerabilities: buildMetricDelta(baseProfile.security.totalVulnerabilities, targetProfile.security.totalVulnerabilities),
    totalDependencies: buildMetricDelta(baseProfile.security.totalDependencies, targetProfile.security.totalDependencies)
  };

  // 4. File-level changes and quality regressions
  const fileDiff = await compareFileLevelChanges(baseSnapshotId, targetSnapshotId, dbPool);

  // 5. Duplication diff (new vs persistent vs resolved clones)
  const dupDiff = await compareDuplicationBetweenSnapshots(baseSnapshotId, targetSnapshotId, dbPool);

  // 6. Security and Dependency trajectory (reusing CP9)
  let securityDiff = {
    newFindings: [],
    persistentFindings: [],
    resolvedFindings: [],
    dependencyTransitions: []
  };

  try {
    const secResult = await compareSecuritySnapshots(baseSnapshotId, targetSnapshotId, dbPool);
    securityDiff = {
      newFindings: secResult.newFindings,
      persistentFindings: secResult.persistentFindings,
      resolvedFindings: secResult.resolvedFindings,
      dependencyTransitions: secResult.dependencyTransitions
    };
  } catch (secErr) {
    logger.warn({ err: secErr.message }, 'Non-fatal error running security trajectory comparator');
  }

  return {
    repositoryId,
    isBaseline: false,
    base: baseMeta ? {
      id: baseMeta.id,
      snapshotId: baseMeta.id,
      commitSha: baseMeta.commit_sha,
      branch: baseMeta.branch,
      date: baseMeta.commit_timestamp || baseMeta.created_at,
      profile: baseProfile
    } : null,
    target: {
      id: targetMeta.id,
      snapshotId: targetMeta.id,
      commitSha: targetMeta.commit_sha,
      branch: targetMeta.branch,
      date: targetMeta.commit_timestamp || targetMeta.created_at,
      profile: targetProfile
    },
    deltas: {
      metrics: metricDeltas,
      files: fileDiff,
      duplication: {
        baseRatio: baseProfile.duplication.duplicationRatio,
        targetRatio: targetProfile.duplication.duplicationRatio,
        ratioDelta: metricDeltas.duplicationRatio.absoluteDelta,
        ...dupDiff
      },
      dependencies: {
        transitions: securityDiff.dependencyTransitions,
        addedCount: securityDiff.dependencyTransitions.filter(d => d.transition === 'ADDED').length,
        removedCount: securityDiff.dependencyTransitions.filter(d => d.transition === 'REMOVED').length,
        upgradedCount: securityDiff.dependencyTransitions.filter(d => d.transition === 'UPGRADED').length,
        downgradedCount: securityDiff.dependencyTransitions.filter(d => d.transition === 'DOWNGRADED').length
      },
      security: {
        scoreDelta: metricDeltas.securityScore.absoluteDelta,
        newFindings: securityDiff.newFindings,
        persistentFindings: securityDiff.persistentFindings,
        resolvedFindings: securityDiff.resolvedFindings,
        newCount: securityDiff.newFindings.length,
        persistentCount: securityDiff.persistentFindings.length,
        resolvedCount: securityDiff.resolvedFindings.length
      }
    }
  };
}

/**
 * Generates the full repository engineering health history timeline
 * @param {string} repositoryId
 * @param {Object} [options]
 * @param {Object} [dbPool=pool]
 * @returns {Promise<Object>}
 */
export async function getRepositoryHistory(repositoryId, options = {}, dbPool = pool) {
  const snapshots = await getChronologicalSnapshots(repositoryId, dbPool);

  if (snapshots.length === 0) {
    return {
      repositoryId,
      snapshotCount: 0,
      state: 'NO_SNAPSHOTS',
      message: 'No analyzed snapshots available for this repository.',
      timeline: []
    };
  }

  // Load profiles for all completed snapshots
  const timeline = [];
  let prevProfile = null;

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const profile = await getSnapshotMetricsProfile(snap.id, repositoryId, dbPool);

    let deltas = null;
    if (prevProfile) {
      deltas = {
        linesDelta: profile.totalLines - prevProfile.totalLines,
        complexityDelta: Number((profile.avgComplexity - prevProfile.avgComplexity).toFixed(2)),
        smellsDelta: profile.totalSmells - prevProfile.totalSmells,
        duplicationDelta: Number((profile.duplication.duplicationRatio - prevProfile.duplication.duplicationRatio).toFixed(4)),
        securityScoreDelta: profile.security.securityScore - prevProfile.security.securityScore,
        vulnerabilitiesDelta: profile.security.totalVulnerabilities - prevProfile.security.totalVulnerabilities
      };
    }

    timeline.push({
      snapshotId: snap.id,
      commitSha: snap.commit_sha,
      branch: snap.branch,
      timestamp: snap.commit_timestamp || snap.created_at,
      isBaseline: i === 0,
      metrics: {
        totalFiles: profile.totalFiles,
        totalLines: profile.totalLines,
        functionCount: profile.functionCount,
        classCount: profile.classCount,
        avgComplexity: profile.avgComplexity,
        maxComplexity: profile.maxComplexity,
        totalSmells: profile.totalSmells,
        maintainability: profile.maintainability,
        duplicationRatio: profile.duplication.duplicationRatio,
        duplicatedLines: profile.duplication.duplicatedLines,
        cloneCount: profile.duplication.cloneCount,
        securityScore: profile.security.securityScore,
        totalVulnerabilities: profile.security.totalVulnerabilities,
        criticalVulnerabilities: profile.security.criticalCount,
        totalDependencies: profile.security.totalDependencies,
        testGuardPercentage: profile.testGuard.guardPercentage
      },
      deltas
    });

    prevProfile = profile;
  }

  if (snapshots.length === 1) {
    return {
      repositoryId,
      snapshotCount: 1,
      state: 'BASELINE',
      message: 'Historical comparison requires at least two analyzed snapshots. Current snapshot represents your engineering baseline.',
      timeline
    };
  }

  return {
    repositoryId,
    snapshotCount: snapshots.length,
    state: 'TRAJECTORY_AVAILABLE',
    timeline
  };
}
