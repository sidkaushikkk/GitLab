import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePullRequest, savePullRequestAnalysis } from '../src/services/intelligence/prRiskEngine.js';
import { pool, closePool } from '../src/db/pool.js';

test('prRiskEngine: 1. tiny low-risk PR', () => {
  const baseCode = `
export function add(a, b) {
  return a + b;
}
`;
  const headCode = `
export function add(a, b) {
  // Add two numbers
  return a + b;
}
`;
  const diff = `diff --git a/src/math.js b/src/math.js
--- a/src/math.js
+++ b/src/math.js
@@ -2,1 +2,2 @@
+  // Add two numbers
   return a + b;
`;

  const result = analyzePullRequest({
    diffText: diff,
    baseFiles: [{ filePath: 'src/math.js', content: baseCode, language: 'javascript' }],
    headFiles: [{ filePath: 'src/math.js', content: headCode, language: 'javascript' }],
    relationships: []
  });

  assert.equal(result.riskCategory, 'LOW');
  assert.equal(result.qualityGate, 'APPROVED');
  assert.ok(result.riskScore < 30);
  assert.equal(result.findings.length, 0);
  assert.equal(result.churnMetrics.totalChurn, 1);
});

test('prRiskEngine: 2. large-churn PR triggers churn contribution and advisory finding', () => {
  // Generate large diff of 900 additions
  const addedLines = Array.from({ length: 900 }, (_, i) => `+const var_${i} = ${i};`).join('\n');
  const diff = `diff --git a/src/data.js b/src/data.js
--- a/src/data.js
+++ b/src/data.js
@@ -1,1 +1,900 @@
${addedLines}
`;

  const baseCode = `const x = 1;`;
  const headCode = Array.from({ length: 900 }, (_, i) => `const var_${i} = ${i};`).join('\n');

  const result = analyzePullRequest({
    diffText: diff,
    baseFiles: [{ filePath: 'src/data.js', content: baseCode, language: 'javascript' }],
    headFiles: [{ filePath: 'src/data.js', content: headCode, language: 'javascript' }],
    relationships: []
  });

  assert.equal(result.churnMetrics.totalChurn, 900);
  assert.ok(result.scoreBreakdown.churnContribution >= 20);
  const churnFinding = result.findings.find(f => f.findingType === 'LARGE_CHURN');
  assert.ok(churnFinding, 'Should report LARGE_CHURN finding');
  assert.equal(result.qualityGate, 'WARNING');
});

test('prRiskEngine: 3. complexity increase detected between base and head', () => {
  const baseCode = `
export function process(val) {
  return val * 2;
}
`;
  // Add 6 branching if statements
  const headCode = `
export function process(val) {
  if (val > 100) return 100;
  if (val > 50) return 50;
  if (val > 25) return 25;
  if (val > 10) return 10;
  if (val > 5) return 5;
  if (val > 0) return 1;
  return 0;
}
`;
  const diff = `diff --git a/src/calc.js b/src/calc.js
--- a/src/calc.js
+++ b/src/calc.js
@@ -2,1 +2,7 @@
+  if (val > 100) return 100;
+  if (val > 50) return 50;
+  if (val > 25) return 25;
+  if (val > 10) return 10;
+  if (val > 5) return 5;
+  if (val > 0) return 1;
   return 0;
`;

  const result = analyzePullRequest({
    diffText: diff,
    baseFiles: [{ filePath: 'src/calc.js', content: baseCode, language: 'javascript' }],
    headFiles: [{ filePath: 'src/calc.js', content: headCode, language: 'javascript' }],
    relationships: []
  });

  assert.ok(result.structuralDeltas.length > 0);
  const delta = result.structuralDeltas[0];
  assert.equal(delta.symbolName, 'process');
  assert.ok(delta.complexityDelta >= 5);

  const finding = result.findings.find(f => f.findingType === 'COMPLEXITY_INCREASE');
  assert.ok(finding, 'Should report COMPLEXITY_INCREASE');
  assert.ok(result.scoreBreakdown.structuralContribution > 0);
});

test('prRiskEngine: 4. newly introduced code smell vs 5. pre-existing smell invariance', () => {
  // Base code has a large function smell (> 50 lines)
  const longBaseLines = Array.from({ length: 60 }, (_, i) => `  const a_${i} = ${i};`).join('\n');
  const baseCode = `
function preExistingLongFunction() {
${longBaseLines}
  return 0;
}
`;

  // Head code keeps the pre-existing long function, but introduces a deep nesting smell (> 4 depth)
  const headCode = `
function preExistingLongFunction() {
${longBaseLines}
  return 0;
}

function newlyIntroducedDeepNesting(a) {
  if (a > 0) {
    if (a > 1) {
      if (a > 2) {
        if (a > 3) {
          if (a > 4) {
            return true;
          }
        }
      }
    }
  }
  return false;
}
`;

  const diff = `diff --git a/src/smelly.js b/src/smelly.js
--- a/src/smelly.js
+++ b/src/smelly.js
@@ -64,0 +65,15 @@
+function newlyIntroducedDeepNesting(a) {
+  if (a > 0) {
+    if (a > 1) {
+      if (a > 2) {
+        if (a > 3) {
+          if (a > 4) {
+            return true;
+          }
+        }
+      }
+    }
+  }
+  return false;
+}
`;

  const result = analyzePullRequest({
    diffText: diff,
    baseFiles: [{ filePath: 'src/smelly.js', content: baseCode, language: 'javascript' }],
    headFiles: [{ filePath: 'src/smelly.js', content: headCode, language: 'javascript' }],
    relationships: []
  });

  // Verify temporal distinction
  assert.ok(result.smellDeltas.preExistingSmells.some(s => s.symbolName === 'preExistingLongFunction'), 'preExistingLongFunction must be in preExistingSmells');
  assert.ok(result.smellDeltas.newSmells.some(s => s.symbolName === 'newlyIntroducedDeepNesting'), 'newlyIntroducedDeepNesting must be in newSmells');

  // Assert pre-existing smell is NOT in newSmells
  assert.ok(!result.smellDeltas.newSmells.some(s => s.symbolName === 'preExistingLongFunction'), 'preExistingLongFunction must NOT be reported as new');

  // Verify review findings only report the NEW smell
  const smellFindings = result.findings.filter(f => f.findingType === 'NEW_CODE_SMELL');
  assert.ok(smellFindings.some(f => f.symbolName === 'newlyIntroducedDeepNesting'));
  assert.ok(!smellFindings.some(f => f.symbolName === 'preExistingLongFunction'));
});

test('prRiskEngine: 6. high-risk CP7 file touched (transparent signals without probability averaging)', () => {
  // Construct a complex file that triggers high CP7 risk (high complexity, high imports, smells)
  const complexLines = Array.from({ length: 300 }, (_, i) => `const val_${i} = ${i};`).join('\n');
  const baseCode = `
import { a } from 'modA';
import { b } from 'modB';
import { c } from 'modC';
import { d } from 'modD';
import { e } from 'modE';
import { f } from 'modF';
import { g } from 'modG';
import { h } from 'modH';

export function complexLogic(x) {
${complexLines}
  if (x > 1) { if (x > 2) { if (x > 3) { if (x > 4) { if (x > 5) { return x * 10; } } } } }
  return 0;
}
`;
  const headCode = baseCode.replace('return x * 10;', 'return x * 20;');
  const diff = `diff --git a/src/complexEngine.js b/src/complexEngine.js
--- a/src/complexEngine.js
+++ b/src/complexEngine.js
@@ -17,1 +17,1 @@
-  if (x > 1) { if (x > 2) { if (x > 3) { if (x > 4) { if (x > 5) { return x * 10; } } } } }
+  if (x > 1) { if (x > 2) { if (x > 3) { if (x > 4) { if (x > 5) { return x * 20; } } } } }
`;

  const result = analyzePullRequest({
    diffText: diff,
    baseFiles: [{ filePath: 'src/complexEngine.js', content: baseCode, language: 'javascript' }],
    headFiles: [{ filePath: 'src/complexEngine.js', content: headCode, language: 'javascript' }],
    relationships: []
  });

  // Verify CP7 transparent signals
  assert.ok(result.cp7Signals.maxFileRiskScore >= 40);
  assert.ok(typeof result.cp7Signals.maxFileProbability === 'number');
  assert.ok(result.cp7Signals.perFilePredictions['src/complexEngine.js'] !== undefined);

  // Verify CP7 does not expose a PR-level probability
  assert.equal(result.cp7Signals.probability, undefined);
  assert.equal(result.probability, undefined);

  // Score contribution from CP7 is added
  assert.ok(result.scoreBreakdown.cp7Contribution > 0);
});

test('prRiskEngine: 7. large blast radius affects downstream consumers', () => {
  const diff = `diff --git a/src/core.js b/src/core.js
--- a/src/core.js
+++ b/src/core.js
@@ -1,1 +1,1 @@
-export const VERSION = 1;
+export const VERSION = 2;
`;
  const relationships = [
    { sourceFilePath: 'src/consumerA.js', targetFilePath: 'src/core.js', relationshipType: 'IMPORTS' },
    { sourceFilePath: 'src/consumerB.js', targetFilePath: 'src/core.js', relationshipType: 'IMPORTS' },
    { sourceFilePath: 'src/consumerC.js', targetFilePath: 'src/core.js', relationshipType: 'IMPORTS' },
    { sourceFilePath: 'src/consumerD.js', targetFilePath: 'src/consumerA.js', relationshipType: 'IMPORTS' }
  ];

  const result = analyzePullRequest({
    diffText: diff,
    baseFiles: [{ filePath: 'src/core.js', content: 'export const VERSION = 1;', language: 'javascript' }],
    headFiles: [{ filePath: 'src/core.js', content: 'export const VERSION = 2;', language: 'javascript' }],
    relationships
  });

  assert.equal(result.blastRadius.affectedFiles.length, 4);
  assert.equal(result.blastRadius.directlyAffected.length, 3);
  assert.equal(result.blastRadius.transitivelyAffected.length, 1);

  // Verify blast radius does NOT count seed file
  assert.ok(!result.blastRadius.affectedFiles.includes('src/core.js'));

  // Finding BROAD_BLAST_RADIUS reported
  const blastFinding = result.findings.find(f => f.findingType === 'BROAD_BLAST_RADIUS');
  assert.ok(blastFinding, 'Should report BROAD_BLAST_RADIUS finding');
  assert.ok(result.scoreBreakdown.blastRadiusContribution > 0);
});

test('prRiskEngine: 8. multiple compounding risk factors trigger BLOCKED / CHANGES_REQUESTED', () => {
  // 600 lines churn + extreme complexity smell + large blast radius
  const extraLines = Array.from({ length: 600 }, (_, i) => `const var_${i} = ${i};`).join('\n');
  const baseCode = `
export function compute(x) {
  return x;
}
`;
  const headCode = `
export function compute(x) {
${extraLines}
  if (x == 1) return 1;
  if (x == 2) return 2;
  if (x == 3) return 3;
  if (x == 4) return 4;
  if (x == 5) return 5;
  if (x == 6) return 6;
  if (x == 7) return 7;
  if (x == 8) return 8;
  if (x == 9) return 9;
  if (x == 10) return 10;
  if (x == 11) return 11;
  if (x == 12) return 12;
  return 0;
}
`;
  const diffLines = Array.from({ length: 600 }, (_, i) => `+const var_${i} = ${i};`).join('\n');
  const diff = `diff --git a/src/critical.js b/src/critical.js
--- a/src/critical.js
+++ b/src/critical.js
@@ -1,3 +1,615 @@
 export function compute(x) {
${diffLines}
+  if (x == 1) return 1;
+  if (x == 2) return 2;
+  if (x == 3) return 3;
+  if (x == 4) return 4;
+  if (x == 5) return 5;
+  if (x == 6) return 6;
+  if (x == 7) return 7;
+  if (x == 8) return 8;
+  if (x == 9) return 9;
+  if (x == 10) return 10;
+  if (x == 11) return 11;
+  if (x == 12) return 12;
   return 0;
 }
`;

  const relationships = [
    { sourceFilePath: 'src/app1.js', targetFilePath: 'src/critical.js', relationshipType: 'IMPORTS' },
    { sourceFilePath: 'src/app2.js', targetFilePath: 'src/critical.js', relationshipType: 'IMPORTS' },
    { sourceFilePath: 'src/app3.js', targetFilePath: 'src/critical.js', relationshipType: 'IMPORTS' }
  ];

  const result = analyzePullRequest({
    diffText: diff,
    baseFiles: [{ filePath: 'src/critical.js', content: baseCode, language: 'javascript' }],
    headFiles: [{ filePath: 'src/critical.js', content: headCode, language: 'javascript' }],
    relationships
  });

  assert.ok(result.riskScore >= 60, `Risk score should be elevated (actual: ${result.riskScore})`);
  assert.ok(['CHANGES_REQUESTED', 'BLOCKED'].includes(result.qualityGate));
  assert.ok(result.findings.length >= 2);
});

test('prRiskEngine: 9. no changed files (empty diff)', () => {
  const result = analyzePullRequest({
    diffText: '',
    baseFiles: [],
    headFiles: []
  });

  assert.equal(result.riskScore, 0);
  assert.equal(result.riskCategory, 'LOW');
  assert.equal(result.qualityGate, 'APPROVED');
  assert.equal(result.findings.length, 0);
  assert.equal(result.changedFiles.length, 0);
});

test('prRiskEngine: 10. deleted file handling', () => {
  const baseCode = `export function oldUtil() { return 'bye'; }`;
  const diff = `diff --git a/src/oldUtil.js b/src/oldUtil.js
deleted file mode 100644
--- a/src/oldUtil.js
+++ /dev/null
@@ -1,1 +0,0 @@
-export function oldUtil() { return 'bye'; }
`;

  const result = analyzePullRequest({
    diffText: diff,
    baseFiles: [{ filePath: 'src/oldUtil.js', content: baseCode, language: 'javascript' }],
    headFiles: []
  });

  assert.equal(result.churnMetrics.deletions, 1);
  assert.equal(result.qualityGate, 'APPROVED');
  assert.ok(result.riskScore < 30);
});

test('prRiskEngine: 11. renamed file handling', () => {
  const baseCode = `export const X = 1;`;
  const headCode = `export const X = 2;`;
  const diff = `diff --git a/src/oldName.js b/src/newName.js
similarity index 90%
rename from src/oldName.js
rename to src/newName.js
--- a/src/oldName.js
+++ b/src/newName.js
@@ -1,1 +1,1 @@
-export const X = 1;
+export const X = 2;
`;

  const result = analyzePullRequest({
    diffText: diff,
    baseFiles: [{ filePath: 'src/oldName.js', content: baseCode, language: 'javascript' }],
    headFiles: [{ filePath: 'src/newName.js', content: headCode, language: 'javascript' }]
  });

  assert.equal(result.changedFiles.length, 1);
  assert.equal(result.changedFiles[0], 'src/newName.js');
  assert.equal(result.qualityGate, 'APPROVED');
});

test('prRiskEngine: 12. deterministic repeated execution (10 runs produce strictly identical output)', () => {
  const diff = `diff --git a/src/app.js b/src/app.js
--- a/src/app.js
+++ b/src/app.js
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;
`;
  const baseFiles = [{ filePath: 'src/app.js', content: 'const a = 1;\n', language: 'javascript' }];
  const headFiles = [{ filePath: 'src/app.js', content: 'const a = 1;\nconst b = 2;\n', language: 'javascript' }];

  const firstRun = analyzePullRequest({ diffText: diff, baseFiles, headFiles });

  for (let i = 0; i < 9; i++) {
    const nextRun = analyzePullRequest({ diffText: diff, baseFiles, headFiles });
    assert.deepEqual(nextRun, firstRun, `Run ${i + 2} must be strictly deep-equal to first run`);
  }
});

test('prRiskEngine: 13. database persistence via savePullRequestAnalysis', async () => {
  const client = await pool.connect();
  try {
    let repoRes = await client.query('SELECT id FROM repositories LIMIT 1');
    let repoId = repoRes.rows[0]?.id;

    if (!repoId) {
      const uRes = await client.query(`INSERT INTO users (username, email, password_hash) VALUES ('pr_engine_user', 'pr_engine@test.com', 'h') RETURNING id`);
      const rRes = await client.query(`INSERT INTO repositories (name, description, owner_id) VALUES ('pr_engine_repo', 'desc', $1) RETURNING id`, [uRes.rows[0].id]);
      repoId = rRes.rows[0].id;
    }

    const testPrNum = 888888;
    await client.query('DELETE FROM pull_requests WHERE repository_id = $1 AND pr_number = $2', [repoId, testPrNum]);

    const prRes = await client.query(`
      INSERT INTO pull_requests (
        repository_id, pr_number, title, source_branch, target_branch,
        source_commit_sha, target_commit_sha, status
      ) VALUES ($1, $2, 'Engine Test PR', 'feat', 'main', '3000000000000000000000000000000000000000', '2000000000000000000000000000000000000000', 'open')
      RETURNING id
    `, [repoId, testPrNum]);
    const prId = prRes.rows[0].id;

    const diff = `diff --git a/src/testFile.js b/src/testFile.js
--- a/src/testFile.js
+++ b/src/testFile.js
@@ -1,1 +1,2 @@
 const x = 1;
+const y = 2;
`;
    const analysisResult = analyzePullRequest({
      diffText: diff,
      baseFiles: [{ filePath: 'src/testFile.js', content: 'const x = 1;\n', language: 'javascript' }],
      headFiles: [{ filePath: 'src/testFile.js', content: 'const x = 1;\nconst y = 2;\n', language: 'javascript' }]
    });

    const analysisId = await savePullRequestAnalysis({
      client,
      pullRequestId: prId,
      commitSha: '3000000000000000000000000000000000000000',
      analysisResult,
      diffFiles: [
        {
          filePath: 'src/testFile.js',
          changeType: 'modified',
          additions: 1,
          deletions: 0,
          changedLineRanges: [{ start: 2, end: 2 }]
        }
      ]
    });

    assert.ok(analysisId, 'Analysis ID must be returned');

    const checkRes = await client.query('SELECT risk_score, risk_category, quality_gate, summary FROM pull_request_analyses WHERE id = $1', [analysisId]);
    assert.equal(checkRes.rows.length, 1);
    assert.equal(checkRes.rows[0].risk_category, analysisResult.riskCategory);
    assert.equal(checkRes.rows[0].quality_gate, analysisResult.qualityGate);

    // Clean up
    await client.query('DELETE FROM pull_requests WHERE id = $1', [prId]);
  } finally {
    client.release();
  }
});

after(async () => {
  await closePool();
});
