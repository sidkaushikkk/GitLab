import assert from 'node:assert/strict';
import { predictFileDefectRisk, predictSnapshotDefectRisk } from '../src/services/intelligence/mlInference.js';

console.log('--- Starting Checkpoint 7 ML Inference & Calibration Parity Test Suite ---');

// Test 1: Single file prediction validity
console.log('[Test 1] Testing predictFileDefectRisk schema and bounds...');
const lowRiskFile = {
  lines: 25,
  function_count: 2,
  class_count: 0,
  import_count: 1,
  export_count: 1,
  avg_complexity: 1.5,
  max_complexity: 2,
  fan_in: 5,
  fan_out: 2,
  code_smell_count: 0,
  has_test: 1
};

const lowResult = predictFileDefectRisk(lowRiskFile);
assert.ok(typeof lowResult.probability === 'number');
assert.ok(lowResult.probability >= 0 && lowResult.probability <= 1);
assert.ok(lowResult.riskScore >= 5 && lowResult.riskScore <= 98);
assert.equal(lowResult.riskCategory, 'LOW');
console.log(`  ✓ Low risk file correctly classified: score=${lowResult.riskScore}, prob=${lowResult.probability}, category=${lowResult.riskCategory}`);

// Test 2: High risk file prediction validity
console.log('[Test 2] Testing high complexity / large file prediction...');
const highRiskFile = {
  lines: 4500,
  function_count: 85,
  class_count: 12,
  import_count: 45,
  export_count: 30,
  avg_complexity: 14.5,
  max_complexity: 48,
  fan_in: 2,
  fan_out: 65,
  code_smell_count: 28,
  has_test: 0
};

const highResult = predictFileDefectRisk(highRiskFile);
assert.ok(highResult.probability > lowResult.probability, 'High risk file must have higher probability than low risk file');
assert.ok(highResult.riskScore > lowResult.riskScore, 'High risk file must have higher risk score than low risk file');
assert.ok(['HIGH', 'CRITICAL'].includes(highResult.riskCategory));
assert.ok(highResult.topRiskFactors.length > 0);
console.log(`  ✓ High risk file correctly classified: score=${highResult.riskScore}, prob=${highResult.probability}, category=${highResult.riskCategory}`);
console.log(`  ✓ Top risk factors identified:`, highResult.topRiskFactors.map(f => `${f.factor} (${f.impact})`));

// Test 3: Snapshot-level aggregation and LOC weighting
console.log('[Test 3] Testing predictSnapshotDefectRisk aggregation...');
const snapshotFiles = [
  { filePath: 'src/small.js', lines: 50, ...lowRiskFile },
  { filePath: 'src/monster.js', lines: 3000, ...highRiskFile }
];

const snapshotResult = predictSnapshotDefectRisk(snapshotFiles);
assert.equal(snapshotResult.totalFilesAnalyzed, 2);
assert.ok(snapshotResult.repositoryHealthScore >= 0 && snapshotResult.repositoryHealthScore <= 100);
assert.ok(snapshotResult.hotspots.length === 2);
assert.equal(snapshotResult.hotspots[0].filePath, 'src/monster.js', 'Hotspots must rank highest risk file first');
assert.ok(snapshotResult.modelMetadata.name.includes('DefectPropensity'));
assert.ok(snapshotResult.modelMetadata.datasetVersion.includes('cp7_file_v2.0'));
assert.equal(snapshotResult.modelMetadata.trainingDataset, 'MultiLanguage_SZZ_FileDefect_Corpus_v2');
console.log(`  ✓ Snapshot evaluated: healthScore=${snapshotResult.repositoryHealthScore}, avgRisk=${snapshotResult.averageRiskScore}, topHotspot=${snapshotResult.hotspots[0].filePath}`);

console.log('\n>>> ALL CHECKPOINT 7 ML INFERENCE PARITY TESTS PASSED SUCCESSFULLY <<<\n');
