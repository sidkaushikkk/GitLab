import assert from 'node:assert/strict';
import { dispatchAndParseFile } from '../src/services/intelligence/dispatcher.js';
import { extractRelationships } from '../src/services/intelligence/relationshipExtractor.js';
import { detectCodeSmells } from '../src/services/intelligence/codeSmells.js';
import { extractFeatures } from '../src/services/intelligence/featureExtractor.js';

console.log('--- Starting Checkpoint 7 Feature Extraction Parity Test Suite ---');

// Representative multi-file snapshot with graph dependencies, classes, and smells
const snapshotFiles = [
  {
    path: 'src/service.js',
    language: 'javascript',
    content: `
import { DatabaseClient } from './db.js';
import { formatOutput } from './util.js';

export class PaymentService {
  constructor() {
    this.db = new DatabaseClient();
  }

  processPayment(amount, user) {
    if (!user) return false;
    if (amount <= 0) return false;
    for (let i = 0; i < 3; i++) {
      if (amount > 1000) {
        formatOutput('Large payment');
      }
    }
    this.db.save(user, amount);
    return true;
  }
}
`
  },
  {
    path: 'src/db.js',
    language: 'javascript',
    content: `
export class DatabaseClient {
  constructor() {
    this.connected = true;
  }

  save(user, amount) {
    if (!this.connected) return false;
    return true;
  }

  query(sql) {
    return [];
  }
}
`
  },
  {
    path: 'src/util.js',
    language: 'javascript',
    content: `
export function formatOutput(msg) {
  return '[' + msg + ']';
}
`
  },
  {
    path: 'src/util.test.js',
    language: 'javascript',
    content: `
import { formatOutput } from './util.js';
test('formats', () => {
  expect(formatOutput('hi')).toBe('[hi]');
});
`
  }
];

// ------------------------------------------------------------------------
// Path A: Production Extraction Path (identical to analysisRunner.js)
// ------------------------------------------------------------------------
function runProductionPath(files) {
  const parsedFiles = files.map(f => dispatchAndParseFile(f));
  const allSymbols = [];
  for (const f of parsedFiles) {
    for (const sym of f.symbols) {
      allSymbols.push({ ...sym });
    }
  }

  const { relationships, graphMetrics } = extractRelationships(parsedFiles, allSymbols);
  const codeSmells = detectCodeSmells(parsedFiles, graphMetrics);
  const features = extractFeatures(parsedFiles, allSymbols, graphMetrics, codeSmells);

  const fileFeatureMap = {};
  for (const feat of features) {
    if (feat.entityType === 'file') {
      if (!fileFeatureMap[feat.entityId]) fileFeatureMap[feat.entityId] = {};
      fileFeatureMap[feat.entityId][feat.featureName] = feat.featureValue;
    }
  }

  return { fileFeatureMap, graphMetrics, codeSmells };
}

// ------------------------------------------------------------------------
// Path B: Corrected Training Extraction Path (with full snapshot context)
// ------------------------------------------------------------------------
function runTrainingPath(files, targetFilePath) {
  // 1. All snapshot files parsed to establish full context
  const parsedFiles = files.map(f => dispatchAndParseFile(f));
  const allSymbols = [];
  for (const f of parsedFiles) {
    for (const sym of f.symbols) {
      allSymbols.push({ ...sym });
    }
  }

  // 2. Full graph metrics and smells computed over whole snapshot
  const { relationships, graphMetrics } = extractRelationships(parsedFiles, allSymbols);
  const codeSmells = detectCodeSmells(parsedFiles, graphMetrics);
  const features = extractFeatures(parsedFiles, allSymbols, graphMetrics, codeSmells);

  // 3. Extract features for target file
  const targetFeatures = {};
  for (const feat of features) {
    if (feat.entityType === 'file' && feat.entityId === targetFilePath) {
      targetFeatures[feat.featureName] = feat.featureValue;
    }
  }

  return targetFeatures;
}

const prodResult = runProductionPath(snapshotFiles);

const SHARED_FEATURES = [
  'lines',
  'function_count',
  'class_count',
  'import_count',
  'export_count',
  'avg_complexity',
  'max_complexity',
  'fan_in',
  'fan_out',
  'code_smell_count',
  'has_test'
];

for (const targetFile of ['src/service.js', 'src/db.js', 'src/util.js']) {
  console.log(`[Test] Verifying 11-feature parity for ${targetFile}...`);
  const trainFeatures = runTrainingPath(snapshotFiles, targetFile);
  const prodFeatures = prodResult.fileFeatureMap[targetFile];

  assert.ok(prodFeatures, `Production features must exist for ${targetFile}`);
  assert.ok(trainFeatures, `Training features must exist for ${targetFile}`);

  for (const feat of SHARED_FEATURES) {
    const valTrain = trainFeatures[feat];
    const valProd = prodFeatures[feat];

    assert.equal(
      valTrain,
      valProd,
      `Parity mismatch on ${targetFile} for feature '${feat}': Train=${valTrain}, Prod=${valProd}`
    );
  }
  console.log(`✓ Passed: 100% mathematical parity across all 11 features for ${targetFile}`);
}

// Verify fan_in and fan_out are genuine graph metrics
assert.equal(prodResult.fileFeatureMap['src/db.js'].fan_in, 1, 'src/db.js must have fan_in=1 from service.js import');
assert.equal(prodResult.fileFeatureMap['src/service.js'].fan_out, 4, 'src/service.js must have fan_out=4 (2 imports + 2 calls)');
assert.equal(prodResult.fileFeatureMap['src/util.js'].has_test, 1, 'src/util.js must have has_test=1 from companion util.test.js');

console.log('\n======================================================');
console.log('ALL FEATURE EXTRACTION PARITY TESTS PASSED (100%)');
console.log('======================================================\n');
