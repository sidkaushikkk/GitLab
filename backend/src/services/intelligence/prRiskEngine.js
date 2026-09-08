/**
 * Pull Request Risk Engine & Quality Gate Service (Checkpoint 8 Phase 4)
 * Deterministic multi-signal PR risk scoring, quality gates, and automated code review findings.
 * 
 * NOTE: The PR risk score is a deterministic heuristic calculation, NOT an ML model prediction.
 * CP7 file-level defect propensity is incorporated purely as a file-level signal without averaging.
 */

import { parseUnifiedDiff } from './diffParser.js';
import { mapDiffToAstImpact } from './astImpact.js';
import { calculateBlastRadius } from './blastRadius.js';
import { dispatchAndParseFile } from './dispatcher.js';
import { detectCodeSmells } from './codeSmells.js';
import { predictFileDefectRisk } from './mlInference.js';

export const ENGINE_VERSION = '1.0.0';

/**
 * Default heuristic thresholds and scoring weights
 */
export const RISK_SCORING_CONFIG = {
  BASELINE_SCORE: 5,
  MAX_CHURN_POINTS: 25,
  MAX_STRUCTURAL_POINTS: 20,
  MAX_SMELL_POINTS: 25,
  MAX_BLAST_POINTS: 15,
  MAX_CP7_POINTS: 15,
  WEIGHTS: {
    NEW_SMELL_HIGH: 10,
    NEW_SMELL_MEDIUM: 5,
    NEW_SMELL_LOW: 2,
    COMPLEXITY_DELTA_PER_TWO: 3,
    NESTING_DELTA_PER_ONE: 2,
    DIRECT_CALLER: 3,
    TRANSITIVE_CALLER: 1.5,
    CP7_CRITICAL: 15,
    CP7_HIGH: 10,
    CP7_MEDIUM: 5
  },
  THRESHOLDS: {
    LARGE_CHURN_LINES: 500,
    LARGE_FILE_CHURN_LINES: 300,
    BROAD_BLAST_RADIUS_FILES: 3,
    CRITICAL_BLAST_RADIUS_FILES: 15,
    HIGH_COMPLEXITY_DELTA: 5,
    BLOCKING_COMPLEXITY_DELTA: 10,
    CRITICAL_CYCLOMATIC_COMPLEXITY: 25
  },
  QUALITY_GATE_CUTOFFS: {
    APPROVED_MAX_SCORE: 34,
    WARNING_MAX_SCORE: 59,
    CHANGES_REQUESTED_MAX_SCORE: 84
  }
};

/**
 * Helper to ensure a file is parsed into structured AST metrics
 * @param {Object} fileObj - Raw or pre-parsed file object
 * @returns {Object} Normalized parsed file result
 */
function ensureParsedFile(fileObj) {
  if (!fileObj) return null;
  const filePath = fileObj.filePath || fileObj.path;
  if (Array.isArray(fileObj.symbols) && Array.isArray(fileObj.functionMetrics)) {
    return fileObj;
  }
  return dispatchAndParseFile({
    path: filePath,
    content: fileObj.content || '',
    language: fileObj.language || ''
  });
}

/**
 * Extracts CP7-compatible 11 AST features for a single file
 * @param {Object} parsedFile - Normalized parsed file
 * @param {Array<Object>} fileSmells - Smells detected in this file
 * @param {Set<string>} allRepoPaths - Set of all known file paths
 * @param {number} [fanIn=0] - Inbound dependency count
 * @returns {Object} 11 AST numerical features
 */
function extractSingleFileFeatures(parsedFile, fileSmells = [], allRepoPaths = new Set(), fanIn = 0) {
  const lineCount = parsedFile.lineCount || 1;
  const fns = parsedFile.functionMetrics || [];
  const functionCount = fns.length;
  const classCount = (parsedFile.symbols || []).filter(s => s.symbolType === 'CLASS').length;
  const importCount = (parsedFile.imports || []).length;
  const exportCount = (parsedFile.exports || []).length;

  let maxComplexity = 1;
  let totalComplexity = 0;
  for (const fn of fns) {
    const comp = fn.cyclomaticComplexity || 1;
    if (comp > maxComplexity) maxComplexity = comp;
    totalComplexity += comp;
  }
  const avgComplexity = functionCount > 0 ? Number((totalComplexity / functionCount).toFixed(2)) : 1.0;

  // Check test companion presence
  const lower = (parsedFile.filePath || '').toLowerCase();
  let hasTest = 0;
  if (lower.includes('.test.') || lower.includes('.spec.') || lower.startsWith('test_')) {
    hasTest = 1;
  } else {
    const baseName = (parsedFile.filePath || '').replace(/\.[^/.]+$/, '');
    for (const ext of ['.test.js', '.spec.js', '.test.ts', '_test.py', 'Test.java']) {
      if (allRepoPaths.has(`${baseName}${ext}`) || allRepoPaths.has(`test/${baseName}${ext}`)) {
        hasTest = 1;
        break;
      }
    }
  }

  return {
    lines: lineCount,
    function_count: functionCount,
    class_count: classCount,
    import_count: importCount,
    export_count: exportCount,
    avg_complexity: avgComplexity,
    max_complexity: maxComplexity,
    fan_in: fanIn,
    fan_out: importCount,
    code_smell_count: fileSmells.length,
    has_test: hasTest
  };
}

/**
 * Suggests remediation for a code smell rule
 * @param {string} ruleId
 * @returns {string}
 */
function getSmellRemediation(ruleId) {
  switch (ruleId) {
    case 'HIGH_COMPLEXITY':
      return 'Decompose complex branching into smaller functions or use polymorphic dispatch.';
    case 'DEEP_NESTING':
      return 'Apply early return statements or extract inner loop bodies into private methods.';
    case 'LARGE_FUNCTION':
      return 'Split function into smaller single-responsibility sub-procedures.';
    case 'LARGE_FILE':
      return 'Consider separating module concerns into distinct sub-modules.';
    case 'HIGH_IMPORT_COUNT':
      return 'Review module dependencies to reduce coupling or encapsulate related services.';
    default:
      return 'Refactor the affected code to comply with repository design guidelines.';
  }
}

/**
 * Main Pull Request Risk Engine Analysis
 *
 * @param {Object} options
 * @param {string} [options.diffText] - Raw unified diff text
 * @param {Object} [options.parsedDiff] - Pre-parsed diff from diffParser.js
 * @param {Array<Object>} [options.baseFiles=[]] - Files in base snapshot
 * @param {Array<Object>} [options.headFiles=[]] - Files in head snapshot
 * @param {Array<Object>} [options.relationships=[]] - Repository dependency relationships
 * @param {number} [options.maxDepth=3] - Blast radius traversal depth
 * @returns {Object} Structured PR risk analysis result
 */
export function analyzePullRequest({
  diffText,
  parsedDiff: inputParsedDiff,
  baseFiles = [],
  headFiles = [],
  relationships = [],
  maxDepth = 3
} = {}) {
  // 1. Diff Parsing & Churn Metrics
  const parsedDiff = inputParsedDiff || (diffText !== undefined ? parseUnifiedDiff(diffText) : { files: [], totalAdditions: 0, totalDeletions: 0, changedFileCount: 0, warnings: [] });

  const totalAdditions = parsedDiff.totalAdditions || 0;
  const totalDeletions = parsedDiff.totalDeletions || 0;
  const totalChurn = totalAdditions + totalDeletions;
  const changedFileCount = parsedDiff.files ? parsedDiff.files.length : 0;
  const averageChurnPerFile = changedFileCount > 0 ? Math.round(totalChurn / changedFileCount) : 0;

  let largestFileChange = null;
  for (const f of parsedDiff.files || []) {
    const fileChurn = (f.additions || 0) + (f.deletions || 0);
    if (!largestFileChange || fileChurn > (largestFileChange.additions + largestFileChange.deletions)) {
      largestFileChange = {
        filePath: f.filePath,
        additions: f.additions || 0,
        deletions: f.deletions || 0,
        totalChurn: fileChurn
      };
    }
  }

  const churnMetrics = {
    additions: totalAdditions,
    deletions: totalDeletions,
    totalChurn,
    changedFileCount,
    averageChurnPerFile,
    largestFileChange
  };

  // If no files changed at all (empty PR)
  if (changedFileCount === 0) {
    return {
      analysisVersion: ENGINE_VERSION,
      riskScore: 0,
      riskCategory: 'LOW',
      qualityGate: 'APPROVED',
      decisionReasons: ['No files changed in this pull request.'],
      summary: 'Empty pull request with zero files modified. Quality gate APPROVED.',
      churnMetrics,
      changedFiles: [],
      changedEntities: [],
      blastRadius: {
        seedNodes: [],
        maxDepthConfigured: maxDepth,
        maxDepthReached: 0,
        totalAffectedNodes: 0,
        affectedFiles: [],
        directlyAffected: [],
        transitivelyAffected: [],
        allAffectedNodes: []
      },
      cp7Signals: {
        aggregationExplanation: 'CP7 signals reflect individual file-level defect propensity. Probabilities are not averaged.',
        maxFileRiskScore: 0,
        maxFileProbability: 0,
        highRiskFilesCount: 0,
        mediumRiskFilesCount: 0,
        criticalRiskFilesCount: 0,
        perFilePredictions: {}
      },
      scoreBreakdown: {
        baseline: 0,
        churnContribution: 0,
        structuralContribution: 0,
        codeSmellsContribution: 0,
        blastRadiusContribution: 0,
        cp7Contribution: 0,
        rawScore: 0,
        boundedScore: 0
      },
      structuralDeltas: [],
      smellDeltas: {
        newSmells: [],
        preExistingSmells: [],
        fixedSmells: []
      },
      findings: []
    };
  }

  // 2. AST Impact Mapping
  const astImpactResult = mapDiffToAstImpact({
    parsedDiff,
    baseFiles,
    headFiles
  });

  const changedEntities = astImpactResult.touchedEntities || [];

  // 3. Pre-parse and index base and head files
  const baseParsedList = baseFiles.map(ensureParsedFile).filter(Boolean);
  const headParsedList = headFiles.map(ensureParsedFile).filter(Boolean);

  const baseParsedMap = new Map();
  for (const f of baseParsedList) baseParsedMap.set(f.filePath, f);

  const headParsedMap = new Map();
  for (const f of headParsedList) headParsedMap.set(f.filePath, f);

  const allRepoPaths = new Set([
    ...baseParsedList.map(f => f.filePath),
    ...headParsedList.map(f => f.filePath)
  ]);

  // 4. Structural Complexity & Nesting Delta Analysis (BASE vs HEAD)
  const structuralDeltas = [];
  let maxComplexityDelta = 0;
  let maxNestingDelta = 0;

  for (const diffFile of parsedDiff.files) {
    const baseF = diffFile.oldPath ? baseParsedMap.get(diffFile.oldPath) : null;
    const headF = diffFile.newPath ? headParsedMap.get(diffFile.newPath) : null;

    if (!headF || !baseF) continue;

    const baseFnMap = new Map();
    for (const fn of baseF.functionMetrics || []) {
      baseFnMap.set(fn.symbolName, fn);
    }

    for (const headFn of headF.functionMetrics || []) {
      const baseFn = baseFnMap.get(headFn.symbolName);
      if (!baseFn) continue; // Newly added function handled separately

      const compDelta = (headFn.cyclomaticComplexity || 1) - (baseFn.cyclomaticComplexity || 1);
      const nestDelta = (headFn.maxNestingDepth || 0) - (baseFn.maxNestingDepth || 0);

      if (compDelta > 0 || nestDelta > 0) {
        structuralDeltas.push({
          filePath: headF.filePath,
          symbolName: headFn.symbolName,
          startLine: headFn.startLine,
          baseComplexity: baseFn.cyclomaticComplexity || 1,
          headComplexity: headFn.cyclomaticComplexity || 1,
          complexityDelta: compDelta,
          baseNesting: baseFn.maxNestingDepth || 0,
          headNesting: headFn.maxNestingDepth || 0,
          nestingDelta: nestDelta
        });

        if (compDelta > maxComplexityDelta) maxComplexityDelta = compDelta;
        if (nestDelta > maxNestingDelta) maxNestingDelta = nestDelta;
      }
    }
  }

  // 5. Code Smells Delta (Temporal Distinction: Base vs Head)
  const baseSmells = detectCodeSmells(baseParsedList, {});
  const headSmells = detectCodeSmells(headParsedList, {});

  function getSmellKey(s) {
    return `${s.ruleId}:${s.filePath}:${s.symbolName || ''}`;
  }

  const baseSmellKeySet = new Set(baseSmells.map(getSmellKey));
  const headSmellKeySet = new Set(headSmells.map(getSmellKey));

  const newSmells = [];
  const preExistingSmells = [];

  for (const s of headSmells) {
    if (baseSmellKeySet.has(getSmellKey(s))) {
      preExistingSmells.push(s);
    } else {
      newSmells.push(s);
    }
  }

  const fixedSmells = baseSmells.filter(s => !headSmellKeySet.has(getSmellKey(s)));

  // 6. Blast Radius Calculation
  const touchedFilePaths = parsedDiff.files.map(f => f.filePath).filter(Boolean);
  const touchedSymbols = changedEntities.filter(e => e.entityType !== 'FILE');

  const blastRadiusResult = calculateBlastRadius({
    changedFiles: touchedFilePaths,
    changedSymbols: touchedSymbols,
    relationships,
    maxDepth
  });

  // 7. CP7 Defect Propensity Integration (File-Level Only)
  const perFilePredictions = {};
  let maxFileRiskScore = 0;
  let maxFileProbability = 0;
  let highRiskFilesCount = 0;
  let mediumRiskFilesCount = 0;
  let criticalRiskFilesCount = 0;

  for (const fPath of touchedFilePaths) {
    const fileObj = headParsedMap.get(fPath) || baseParsedMap.get(fPath);
    if (!fileObj) continue;

    const fileSmellList = headSmells.filter(s => s.filePath === fPath);
    const fileFeatures = extractSingleFileFeatures(fileObj, fileSmellList, allRepoPaths);
    const prediction = predictFileDefectRisk(fileFeatures);

    perFilePredictions[fPath] = prediction;

    if (prediction.riskScore > maxFileRiskScore) maxFileRiskScore = prediction.riskScore;
    if (prediction.probability > maxFileProbability) maxFileProbability = prediction.probability;

    if (prediction.riskCategory === 'CRITICAL') {
      criticalRiskFilesCount++;
      highRiskFilesCount++;
    } else if (prediction.riskCategory === 'HIGH') {
      highRiskFilesCount++;
    } else if (prediction.riskCategory === 'MEDIUM') {
      mediumRiskFilesCount++;
    }
  }

  const cp7Signals = {
    aggregationExplanation: 'CP7 signals reflect individual file-level defect propensity for files touched by this PR. File probabilities are NOT averaged or aggregated into a PR-level probability.',
    maxFileRiskScore,
    maxFileProbability,
    highRiskFilesCount,
    mediumRiskFilesCount,
    criticalRiskFilesCount,
    perFilePredictions
  };

  // 8. Deterministic Risk Score Computation
  const cfg = RISK_SCORING_CONFIG;
  const baseline = cfg.BASELINE_SCORE;

  // Churn Contribution (0 - 25)
  const churnContribution = Math.min(cfg.MAX_CHURN_POINTS, Math.round(cfg.MAX_CHURN_POINTS * (totalChurn / 1000)));

  // Structural Contribution (0 - 20)
  const complexityPts = Math.min(12, Math.round(Math.max(0, maxComplexityDelta) * 1.5));
  const nestingPts = Math.min(8, Math.max(0, maxNestingDelta) * cfg.WEIGHTS.NESTING_DELTA_PER_ONE);
  const structuralContribution = Math.min(cfg.MAX_STRUCTURAL_POINTS, complexityPts + nestingPts);

  // New Smells Contribution (0 - 25)
  let smellPts = 0;
  for (const s of newSmells) {
    if (s.severity === 'high') smellPts += cfg.WEIGHTS.NEW_SMELL_HIGH;
    else if (s.severity === 'medium') smellPts += cfg.WEIGHTS.NEW_SMELL_MEDIUM;
    else smellPts += cfg.WEIGHTS.NEW_SMELL_LOW;
  }
  const codeSmellsContribution = Math.min(cfg.MAX_SMELL_POINTS, smellPts);

  // Blast Radius Contribution (0 - 15)
  const directCount = blastRadiusResult.directlyAffected.length;
  const transitiveCount = blastRadiusResult.transitivelyAffected.length;
  const blastPts = Math.round((directCount * cfg.WEIGHTS.DIRECT_CALLER) + (transitiveCount * cfg.WEIGHTS.TRANSITIVE_CALLER));
  const blastRadiusContribution = Math.min(cfg.MAX_BLAST_POINTS, blastPts);

  // CP7 Highest File Risk Contribution (0 - 15)
  let cp7Contribution = 0;
  if (maxFileRiskScore >= 80) cp7Contribution = cfg.WEIGHTS.CP7_CRITICAL;
  else if (maxFileRiskScore >= 60) cp7Contribution = cfg.WEIGHTS.CP7_HIGH;
  else if (maxFileRiskScore >= 40) cp7Contribution = cfg.WEIGHTS.CP7_MEDIUM;

  const rawScore = baseline + churnContribution + structuralContribution + codeSmellsContribution + blastRadiusContribution + cp7Contribution;
  const boundedScore = Math.max(0, Math.min(100, rawScore));

  // Risk Category
  let riskCategory = 'LOW';
  if (boundedScore >= 80) riskCategory = 'CRITICAL';
  else if (boundedScore >= 60) riskCategory = 'HIGH';
  else if (boundedScore >= 30) riskCategory = 'MEDIUM';

  // 9. Quality Gate Decision
  let qualityGate = 'APPROVED';
  const decisionReasons = [];

  const hasNewHighSmell = newSmells.some(s => s.severity === 'high');
  const hasExtremeComplexitySmell = newSmells.some(s => s.ruleId === 'HIGH_COMPLEXITY' && s.measuredValue >= cfg.THRESHOLDS.CRITICAL_CYCLOMATIC_COMPLEXITY);
  const hasNewMediumSmell = newSmells.some(s => s.severity === 'medium');

  if (
    boundedScore >= 85 ||
    hasExtremeComplexitySmell ||
    (blastRadiusResult.affectedFiles.length >= cfg.THRESHOLDS.CRITICAL_BLAST_RADIUS_FILES && hasNewHighSmell)
  ) {
    qualityGate = 'BLOCKED';
    if (boundedScore >= 85) decisionReasons.push(`Risk score of ${boundedScore} reaches critical threshold (>= 85).`);
    if (hasExtremeComplexitySmell) decisionReasons.push('Introduced a critical cyclomatic complexity smell (complexity >= 25).');
    if (blastRadiusResult.affectedFiles.length >= cfg.THRESHOLDS.CRITICAL_BLAST_RADIUS_FILES) decisionReasons.push(`Broad critical blast radius (${blastRadiusResult.affectedFiles.length} files) with high-severity changes.`);
  } else if (
    hasNewHighSmell ||
    maxComplexityDelta >= cfg.THRESHOLDS.BLOCKING_COMPLEXITY_DELTA ||
    boundedScore >= 60 ||
    highRiskFilesCount >= 2
  ) {
    qualityGate = 'CHANGES_REQUESTED';
    if (hasNewHighSmell) decisionReasons.push('Introduced at least one new high-severity code smell.');
    if (maxComplexityDelta >= cfg.THRESHOLDS.BLOCKING_COMPLEXITY_DELTA) decisionReasons.push(`Function cyclomatic complexity increased substantially (+${maxComplexityDelta}).`);
    if (boundedScore >= 60) decisionReasons.push(`Risk score of ${boundedScore} exceeds changes-requested threshold (>= 60).`);
    if (highRiskFilesCount >= 2) decisionReasons.push(`Modifies ${highRiskFilesCount} files associated with high CP7 defect propensity.`);
  } else if (
    hasNewMediumSmell ||
    boundedScore >= 35 ||
    totalChurn > cfg.THRESHOLDS.LARGE_CHURN_LINES ||
    blastRadiusResult.affectedFiles.length >= cfg.THRESHOLDS.BROAD_BLAST_RADIUS_FILES
  ) {
    qualityGate = 'WARNING';
    if (hasNewMediumSmell) decisionReasons.push('Introduced one or more medium-severity code smells.');
    if (boundedScore >= 35) decisionReasons.push(`Risk score of ${boundedScore} warrants caution (>= 35).`);
    if (totalChurn > cfg.THRESHOLDS.LARGE_CHURN_LINES) decisionReasons.push(`Total churn of ${totalChurn} lines exceeds standard advisory limit.`);
    if (blastRadiusResult.affectedFiles.length >= cfg.THRESHOLDS.BROAD_BLAST_RADIUS_FILES) decisionReasons.push(`Modifications affect ${blastRadiusResult.affectedFiles.length} downstream files.`);
  } else {
    decisionReasons.push('All deterministic quality checks passed; low blast radius and no newly introduced issues.');
  }

  // 10. Deterministic Review Findings
  const findings = [];

  // Finding 1: Complexity Increase
  for (const delta of structuralDeltas) {
    if (delta.complexityDelta >= 3) {
      findings.push({
        findingType: 'COMPLEXITY_INCREASE',
        severity: delta.complexityDelta >= cfg.THRESHOLDS.HIGH_COMPLEXITY_DELTA ? 'high' : 'medium',
        filePath: delta.filePath,
        symbolName: delta.symbolName,
        line: delta.startLine,
        evidence: `Cyclomatic complexity increased from ${delta.baseComplexity} to ${delta.headComplexity} (+${delta.complexityDelta})`,
        explanation: `Function ${delta.symbolName} complexity increased by ${delta.complexityDelta}, which is associated with higher verification overhead and technical debt.`,
        suggestedAction: `Consider decomposing ${delta.symbolName} into smaller helper functions or reducing branching logic.`
      });
    }
  }

  // Finding 2: Newly Introduced Code Smells
  for (const smell of newSmells) {
    findings.push({
      findingType: 'NEW_CODE_SMELL',
      severity: smell.severity,
      filePath: smell.filePath,
      symbolName: smell.symbolName,
      line: smell.line,
      evidence: `Detected ${smell.ruleId} with measured value ${smell.measuredValue} (threshold: ${smell.threshold})`,
      explanation: smell.message,
      suggestedAction: getSmellRemediation(smell.ruleId)
    });
  }

  // Finding 3: High Defect Propensity File Touched
  for (const [filePath, pred] of Object.entries(perFilePredictions)) {
    if (pred.riskScore >= 60) {
      findings.push({
        findingType: 'HIGH_DEFECT_PROPENSITY_FILE',
        severity: pred.riskCategory === 'CRITICAL' ? 'high' : 'medium',
        filePath,
        symbolName: null,
        line: 1,
        evidence: `Estimated file-level defect propensity probability = ${pred.probability} (risk score: ${pred.riskScore}/100, category: ${pred.riskCategory})`,
        explanation: `Modifications touch ${filePath}, which static AST metrics associate with elevated defect propensity based on historical defect patterns.`,
        suggestedAction: `Ensure comprehensive automated unit and integration tests cover changes within ${filePath}.`
      });
    }
  }

  // Finding 4: Broad Blast Radius
  if (blastRadiusResult.affectedFiles.length >= cfg.THRESHOLDS.BROAD_BLAST_RADIUS_FILES) {
    findings.push({
      findingType: 'BROAD_BLAST_RADIUS',
      severity: blastRadiusResult.affectedFiles.length >= 8 ? 'high' : 'medium',
      filePath: touchedFilePaths[0] || 'PR',
      symbolName: null,
      line: 1,
      evidence: `${blastRadiusResult.totalAffectedNodes} downstream dependent nodes across ${blastRadiusResult.affectedFiles.length} files (${blastRadiusResult.directlyAffected.length} direct, ${blastRadiusResult.transitivelyAffected.length} transitive; max depth: ${blastRadiusResult.maxDepthReached})`,
      explanation: `Modifications in ${touchedFilePaths.join(', ')} propagate downstream across the repository dependency graph to consumer modules.`,
      suggestedAction: `Run integration test suites covering affected downstream files: ${blastRadiusResult.affectedFiles.slice(0, 5).join(', ')}${blastRadiusResult.affectedFiles.length > 5 ? '...' : ''}.`
    });
  }

  // Finding 5: Large Churn
  if (totalChurn > cfg.THRESHOLDS.LARGE_CHURN_LINES) {
    findings.push({
      findingType: 'LARGE_CHURN',
      severity: 'medium',
      filePath: largestFileChange?.filePath || 'PR',
      symbolName: null,
      line: 1,
      evidence: `Total churn of ${totalChurn} lines (+${totalAdditions}/-${totalDeletions}) across ${changedFileCount} files (largest: ${largestFileChange?.filePath} with ${largestFileChange?.totalChurn} lines)`,
      explanation: 'Large pull requests exhibit higher cognitive review load and greater likelihood of latent defects escaping manual review.',
      suggestedAction: 'Consider splitting large refactoring or multi-feature changes into smaller, focused pull requests.'
    });
  }

  // 11. Human-readable Summary String
  const summary = `PR modifies ${changedFileCount} file(s) (+${totalAdditions}/-${totalDeletions}, total churn ${totalChurn}). Risk: ${riskCategory} (${boundedScore}/100). Quality Gate: ${qualityGate}. Downstream blast radius: ${blastRadiusResult.affectedFiles.length} file(s). Findings: ${findings.length}.`;

  return {
    analysisVersion: ENGINE_VERSION,
    riskScore: boundedScore,
    riskCategory,
    qualityGate,
    decisionReasons,
    summary,
    churnMetrics,
    changedFiles: touchedFilePaths,
    changedEntities,
    blastRadius: blastRadiusResult,
    cp7Signals,
    scoreBreakdown: {
      baseline,
      churnContribution,
      structuralContribution,
      codeSmellsContribution,
      blastRadiusContribution,
      cp7Contribution,
      rawScore,
      boundedScore
    },
    structuralDeltas,
    smellDeltas: {
      newSmells,
      preExistingSmells,
      fixedSmells
    },
    findings
  };
}

/**
 * Persists PR analysis results into PostgreSQL pull_request_analyses and pull_request_diffs tables.
 *
 * @param {Object} options
 * @param {Object} options.client - pg client
 * @param {string} options.pullRequestId - UUID of pull_requests
 * @param {string} options.commitSha - Head commit SHA
 * @param {string} [options.baseSnapshotId] - Base snapshot UUID
 * @param {Object} options.analysisResult - Output of analyzePullRequest
 * @param {Array<Object>} [options.diffFiles=[]] - Files from parsedDiff
 * @returns {Promise<string>} Created or updated analysis ID
 */
export async function savePullRequestAnalysis({
  client,
  pullRequestId,
  commitSha,
  baseSnapshotId = null,
  analysisResult,
  diffFiles = []
}) {
  if (!client || !pullRequestId) {
    throw new Error('Database client and pullRequestId are required');
  }

  const {
    riskScore,
    riskCategory,
    qualityGate,
    churnMetrics,
    blastRadius,
    findings,
    summary,
    analysisVersion
  } = analysisResult;

  const insRes = await client.query(
    `INSERT INTO pull_request_analyses (
       pull_request_id, base_snapshot_id, commit_sha, status,
       analysis_version, risk_score, risk_category, quality_gate,
       churn_metrics, blast_radius, findings, summary, completed_at
     ) VALUES (
       $1, $2, $3, 'completed',
       $4, $5, $6, $7,
       $8, $9, $10, $11, NOW()
     ) RETURNING id`,
    [
      pullRequestId,
      baseSnapshotId,
      commitSha,
      analysisVersion || ENGINE_VERSION,
      riskScore,
      riskCategory,
      qualityGate,
      JSON.stringify(churnMetrics || {}),
      JSON.stringify(blastRadius || {}),
      JSON.stringify(findings || []),
      summary
    ]
  );

  const analysisId = insRes.rows[0].id;

  for (const f of diffFiles) {
    await client.query(
      `INSERT INTO pull_request_diffs (
         pull_request_id, analysis_id, file_path, old_path,
         change_type, additions, deletions, changed_line_ranges, patch, touched_symbols
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8, $9, $10
       )`,
      [
        pullRequestId,
        analysisId,
        f.filePath,
        f.oldPath || null,
        f.changeType || 'modified',
        f.additions || 0,
        f.deletions || 0,
        JSON.stringify(f.changedLineRanges || []),
        f.patch || null,
        JSON.stringify(f.touchedSymbols || [])
      ]
    );
  }

  return analysisId;
}
