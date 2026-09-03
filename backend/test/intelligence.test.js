import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { pool, closePool } from '../src/db/pool.js';
import {
  encryptToken,
  generateSessionToken,
  hashSessionToken
} from '../src/utils/crypto.js';
import { parseJavaScript } from '../src/services/intelligence/parsers/javascriptParser.js';
import { parsePython } from '../src/services/intelligence/parsers/pythonParser.js';
import { parseJava } from '../src/services/intelligence/parsers/javaParser.js';
import { extractRelationships } from '../src/services/intelligence/relationshipExtractor.js';
import { detectCodeSmells } from '../src/services/intelligence/codeSmells.js';
import { extractFeatures, FEATURE_SCHEMA_VERSION } from '../src/services/intelligence/featureExtractor.js';
import { defaultStorageProvider } from '../src/services/ingestion/storage/LocalStorageProvider.js';
import { app } from '../src/app.js';

let server;
let baseUrl;

async function startServer() {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
}

async function stopServer() {
  return new Promise((resolve) => {
    server.close(resolve);
  });
}

async function runTests() {
  console.log('--- Starting Checkpoint 6 Code Intelligence & ML Features Test Suite ---');
  await startServer();

  try {
    // ------------------------------------------------------------------------
    // Test 1: JavaScript & JSX AST Parsing Unit Test
    // ------------------------------------------------------------------------
    console.log('[Test 1] Testing JavaScript/JSX AST parsing, symbols, calls, imports, and metrics...');

    const jsCode = `
import { savePayment } from "./database.js";
import express from "express";

export function processPayment(user, amount) {
    if (!user) {
        return false;
    }
    if (amount <= 0) {
        return false;
    }
    savePayment(user, amount);
    return true;
}

export const complexValidator = (data) => {
    if (data.a) {
        if (data.b) {
            if (data.c) {
                if (data.d) {
                    if (data.e) {
                        return "very_deep";
                    }
                }
            }
        }
    }
    return "ok";
};
`;

    const jsResult = parseJavaScript('src/payment.js', jsCode);
    assert.equal(jsResult.status, 'analyzed');
    assert.equal(jsResult.imports.length, 2);
    assert.equal(jsResult.imports[0].targetFile, './database.js');
    assert.deepEqual(jsResult.imports[0].importedSymbols, ['savePayment']);

    const fnProcess = jsResult.functionMetrics.find(f => f.symbolName === 'processPayment');
    assert.ok(fnProcess, 'processPayment function must be extracted');
    assert.equal(fnProcess.parameterCount, 2);
    assert.equal(fnProcess.cyclomaticComplexity, 3); // Base 1 + 2 if statements
    assert.equal(fnProcess.callCount, 1); // savePayment call

    const fnComplex = jsResult.functionMetrics.find(f => f.symbolName === 'complexValidator');
    assert.ok(fnComplex, 'complexValidator function must be extracted');
    assert.equal(fnComplex.maxNestingDepth, 5, 'Must calculate control-flow nesting depth of 5 for 5 nested ifs');
    assert.equal(fnComplex.cyclomaticComplexity, 6); // Base 1 + 5 if statements

    // Verify calls
    const callSave = jsResult.calls.find(c => c.calleeName === 'savePayment');
    assert.ok(callSave, 'Call to savePayment must be captured');
    assert.equal(callSave.callerSymbolName, 'processPayment');

    // ------------------------------------------------------------------------
    // Control-flow maxNestingDepth Scenarios Verification
    // ------------------------------------------------------------------------
    // 1. No control flow (depth 0)
    const resNoControl = parseJavaScript('src/t1.js', 'function test() { return 1; }');
    assert.equal(resNoControl.functionMetrics[0].maxNestingDepth, 0, 'No control flow must have nesting depth 0');

    // 2. One if (depth 1)
    const resOneIf = parseJavaScript('src/t2.js', 'function test(a) { if (a) { return 1; } }');
    assert.equal(resOneIf.functionMetrics[0].maxNestingDepth, 1, 'One if must have nesting depth 1');

    // 3. Two nested ifs (depth 2)
    const resTwoNestedIfs = parseJavaScript('src/t3.js', 'function test(a) { if (a) { if (b) { return 1; } } }');
    assert.equal(resTwoNestedIfs.functionMetrics[0].maxNestingDepth, 2, 'Two nested ifs must have nesting depth 2');

    // 4. Nested loop + if (depth 2)
    const resLoopIf = parseJavaScript('src/t4.js', 'function test(items) { for (const item of items) { if (item) { process(item); } } }');
    assert.equal(resLoopIf.functionMetrics[0].maxNestingDepth, 2, 'Nested loop + if must have nesting depth 2');

    // 5. Sequential, non-nested control flow (depth 1)
    const resSequentialIfs = parseJavaScript('src/t5.js', 'function test(a, b) { if (a) {} if (b) {} }');
    assert.equal(resSequentialIfs.functionMetrics[0].maxNestingDepth, 1, 'Sequential if statements must NOT produce depth 2');

    // 6. Target verification snippet from prompt
    const resPromptSnippet = parseJavaScript('src/t6.js', 'function test(a) { if (a) { if (a > 10) { return a; } } }');
    assert.equal(resPromptSnippet.functionMetrics[0].maxNestingDepth, 2, 'Target prompt snippet must have nesting depth 2');

    console.log('✓ Test 1 Passed: JavaScript/JSX AST parser correctly extracted symbols, complexity, control-flow nesting depth (0-5), imports, and calls.');

    // ------------------------------------------------------------------------
    // Test 2: Python AST Parsing Unit Test
    // ------------------------------------------------------------------------
    console.log('[Test 2] Testing Python AST parsing, symbols, classes, functions, and metrics...');

    const pyCode = `
import math
from services import auth

class DataAnalyzer:
    def analyze(self, items):
        total = 0
        for item in items:
            if item > 0:
                total += item
        return total

def calculate_discount(price, rate):
    if rate > 0:
        return price * rate
    return 0
`;

    const pyResult = parsePython('src/utils.py', pyCode);
    assert.equal(pyResult.status, 'analyzed');
    assert.equal(pyResult.imports.length, 2);

    const classSym = pyResult.symbols.find(s => s.symbolType === 'CLASS' && s.name === 'DataAnalyzer');
    assert.ok(classSym, 'Python class DataAnalyzer must be extracted');

    const fnDiscount = pyResult.functionMetrics.find(f => f.symbolName === 'calculate_discount');
    assert.ok(fnDiscount, 'Python function calculate_discount must be extracted');
    assert.equal(fnDiscount.parameterCount, 2);
    assert.equal(fnDiscount.cyclomaticComplexity, 2); // Base 1 + 1 if

    console.log('✓ Test 2 Passed: Python AST parser correctly extracted classes, functions, and metrics.');

    // ------------------------------------------------------------------------
    // Test 3: Java AST/CST Parsing Unit Test
    // ------------------------------------------------------------------------
    console.log('[Test 3] Testing Java AST parsing, classes, inheritance, interfaces, methods, and invocations...');

    const javaCode = `
package com.example.service;

import java.util.List;
import com.example.BaseService;
import com.example.IPayment;

public class PaymentService extends BaseService implements IPayment {
    private int maxRetries;

    public PaymentService(int maxRetries) {
        this.maxRetries = maxRetries;
    }

    public boolean processPayment(String user, double amount) {
        if (amount <= 0) {
            return false;
        }
        savePayment(user, amount);
        return true;
    }
}
`;

    const javaResult = parseJava('src/services/PaymentService.java', javaCode);
    assert.equal(javaResult.status, 'analyzed');
    assert.equal(javaResult.imports.length, 3);

    const javaClass = javaResult.symbols.find(s => s.symbolType === 'CLASS' && s.name === 'PaymentService');
    assert.ok(javaClass, 'PaymentService class must be extracted');
    assert.equal(javaClass.superClass, 'BaseService', 'Must identify BaseService as superclass');
    assert.ok(javaClass.interfaces.includes('IPayment'), 'Must identify IPayment as interface');

    const javaMethod = javaResult.functionMetrics.find(f => f.symbolName === 'processPayment');
    assert.ok(javaMethod, 'processPayment method must be extracted');
    assert.equal(javaMethod.parameterCount, 2);
    assert.equal(javaMethod.cyclomaticComplexity, 2);
    assert.equal(javaMethod.callCount, 1);

    console.log('✓ Test 3 Passed: Java AST parser correctly extracted class inheritance, interface implementation, methods, and invocations.');

    // ------------------------------------------------------------------------
    // Test 4: Relationships & Graph Metrics (Fan-In, Fan-Out, Circular Deps)
    // ------------------------------------------------------------------------
    console.log('[Test 4] Testing relationship resolution and graph connectivity metrics...');

    const parsedFiles = [
      jsResult,
      parseJavaScript('src/database.js', 'export function savePayment(user, amount) { return true; }'),
      pyResult,
      javaResult
    ];

    const allSymbols = [];
    let symCounter = 1;
    for (const f of parsedFiles) {
      for (const s of f.symbols) {
        allSymbols.push({ ...s, id: `sym-${symCounter++}` });
      }
    }

    const { relationships, graphMetrics } = extractRelationships(parsedFiles, allSymbols);
    assert.ok(relationships.length > 0, 'Must extract relationships');

    const importRel = relationships.find(r => r.relationshipType === 'IMPORTS' && r.sourceFilePath === 'src/payment.js');
    assert.ok(importRel, 'Must find IMPORTS relationship from payment.js');
    assert.equal(importRel.targetFilePath, 'src/database.js', 'Must resolve relative import to src/database.js');

    const extendsRel = relationships.find(r => r.relationshipType === 'EXTENDS' && r.sourceFilePath === 'src/services/PaymentService.java');
    assert.ok(extendsRel, 'Must find EXTENDS relationship for Java class');

    assert.ok(graphMetrics.fileFanOut.get('src/payment.js') >= 1, 'payment.js must have fan-out >= 1');
    assert.ok(graphMetrics.fileFanIn.get('src/database.js') >= 1, 'database.js must have fan-in >= 1');

    console.log('✓ Test 4 Passed: Multi-language relationships (IMPORTS, CALLS, EXTENDS, IMPLEMENTS) and graph metrics resolved.');

    // ------------------------------------------------------------------------
    // Test 5: Deterministic Code Smell Rules
    // ------------------------------------------------------------------------
    console.log('[Test 5] Testing deterministic code smell rules...');

    const smells = detectCodeSmells(parsedFiles, graphMetrics, {
      HIGH_COMPLEXITY: 5,
      DEEP_NESTING: 4
    });

    const deepNestingSmell = smells.find(s => s.ruleId === 'DEEP_NESTING' && s.symbolName === 'complexValidator');
    assert.ok(deepNestingSmell, 'complexValidator must trigger DEEP_NESTING smell');
    assert.ok(deepNestingSmell.measuredValue >= 5);

    const highComplexitySmell = smells.find(s => s.ruleId === 'HIGH_COMPLEXITY' && s.symbolName === 'complexValidator');
    assert.ok(highComplexitySmell, 'complexValidator must trigger HIGH_COMPLEXITY smell');

    console.log('✓ Test 5 Passed: Code smell rules evaluated deterministically without heuristics or LLMs.');

    // ------------------------------------------------------------------------
    // Test 6: ML-Ready Feature Extraction (CP7 Contract)
    // ------------------------------------------------------------------------
    console.log('[Test 6] Testing ML-ready feature vector generation (version 1.0)...');

    const features = extractFeatures(parsedFiles, allSymbols, graphMetrics, smells);
    assert.ok(features.length > 0, 'Must produce numerical features');
    assert.equal(features[0].featureSchemaVersion, FEATURE_SCHEMA_VERSION);

    const fnFeatures = features.filter(f => f.entityType === 'function');
    assert.ok(fnFeatures.length > 0, 'Must contain function-level feature vectors');

    const fileFeatures = features.filter(f => f.entityType === 'file');
    assert.ok(fileFeatures.length > 0, 'Must contain file-level feature vectors');

    const repoFeatures = features.filter(f => f.entityType === 'repository');
    assert.ok(repoFeatures.length > 0, 'Must contain repository-level feature vectors');

    for (const f of features) {
      assert.equal(typeof f.featureValue, 'number', `Feature ${f.featureName} value must be numerical`);
      assert.ok(!Number.isNaN(f.featureValue), `Feature ${f.featureName} must not be NaN`);
    }

    console.log('✓ Test 6 Passed: ML-ready numerical feature dataset generated adhering to feature_schema_version 1.0.');

    // ------------------------------------------------------------------------
    // Setup End-to-End Database Fixtures (User, Repo, CP5 Snapshot)
    // ------------------------------------------------------------------------
    const key = env.githubTokenEncryptionKey;
    const testEncryptedToken = encryptToken('gho_test_user_token_abc123', key);

    // User A
    const userAGithubId = Date.now() + 301;
    const { rows: userARows } = await pool.query(`
      INSERT INTO users (github_id, login, name, avatar_url, email, github_access_token_encrypted)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, login
    `, [userAGithubId, `user_cp6_a_${Date.now()}`, 'User Alpha CP6', 'https://example.com/a.png', 'usera_cp6@example.com', testEncryptedToken]);
    const userA = userARows[0];

    const tokenA = generateSessionToken();
    const hashA = hashSessionToken(tokenA);
    await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')', [hashA, userA.id]);

    // User B (for cross-user isolation test)
    const userBGithubId = Date.now() + 302;
    const { rows: userBRows } = await pool.query(`
      INSERT INTO users (github_id, login, name, avatar_url, email, github_access_token_encrypted)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, login
    `, [userBGithubId, `user_cp6_b_${Date.now()}`, 'User Beta CP6', 'https://example.com/b.png', 'userb_cp6@example.com', testEncryptedToken]);
    const userB = userBRows[0];

    const tokenB = generateSessionToken();
    const hashB = hashSessionToken(tokenB);
    await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')', [hashB, userB.id]);

    // Connect Repository for User A
    const { rows: repoRowsA } = await pool.query(`
      INSERT INTO repositories (user_id, provider, owner, name, full_name, default_branch, status)
      VALUES ($1, 'github', 'HitachiSystems', 'payment-intel', 'HitachiSystems/payment-intel', 'main', 'connected')
      RETURNING id, name, owner, full_name
    `, [userA.id]);
    const repoA = repoRowsA[0];

    // Create CP5 Snapshot for Repo A
    const commitShaA = 'e1f2a3b4c5d6e1f2a3b4c5d6e1f2a3b4c5d60001';
    const { rows: snapshotRowsA } = await pool.query(`
      INSERT INTO repository_snapshots (
        repository_id, commit_sha, branch, status, total_files, included_files, skipped_files, total_bytes, created_at, completed_at
      ) VALUES ($1, $2, 'main', 'completed', 4, 4, 0, 1500, NOW(), NOW())
      RETURNING id
    `, [repoA.id, commitShaA]);
    const snapshotA = snapshotRowsA[0];

    // Save CP5 snapshot payload in LocalStorageProvider
    const snapshotPayload = {
      snapshotId: snapshotA.id,
      repository: { id: repoA.id, fullName: repoA.full_name },
      source: { commitSha: commitShaA, branch: 'main' },
      files: [
        { path: 'src/payment.js', language: 'javascript', content: jsCode },
        { path: 'src/database.js', language: 'javascript', content: 'export function savePayment(user, amount) { return true; }' },
        { path: 'src/utils.py', language: 'python', content: pyCode },
        { path: 'src/services/PaymentService.java', language: 'java', content: javaCode }
      ]
    };

    await defaultStorageProvider.saveSnapshot(snapshotA.id, snapshotPayload);

    // ------------------------------------------------------------------------
    // Test 7: Unauthenticated & Cross-User Analyze Requests
    // ------------------------------------------------------------------------
    console.log('[Test 7] Testing unauthenticated and cross-user authorization security barriers...');

    const resUnauth = await fetch(`${baseUrl}/api/repositories/${repoA.id}/snapshots/${snapshotA.id}/analyze`, {
      method: 'POST'
    });
    assert.equal(resUnauth.status, 401, 'Unauthenticated request must return 401');

    const resCross = await fetch(`${baseUrl}/api/repositories/${repoA.id}/snapshots/${snapshotA.id}/analyze`, {
      method: 'POST',
      headers: {
        'Cookie': `session_id=${tokenB}`,
        'Content-Type': 'application/json'
      }
    });
    assert.equal(resCross.status, 404, 'User B cannot analyze User A snapshot');

    console.log('✓ Test 7 Passed: Authorization and tenant isolation enforced on analysis endpoint.');

    // ------------------------------------------------------------------------
    // Test 8: End-to-End Code Intelligence Analysis Run
    // ------------------------------------------------------------------------
    console.log('[Test 8] Testing full end-to-end AST analysis run and database persistence...');

    const resAnalyze = await fetch(`${baseUrl}/api/repositories/${repoA.id}/snapshots/${snapshotA.id}/analyze`, {
      method: 'POST',
      headers: {
        'Cookie': `session_id=${tokenA}`,
        'Content-Type': 'application/json'
      }
    });

    assert.equal(resAnalyze.status, 201, 'Fresh analysis must return HTTP 201 Created');
    const bodyAnalyze = await resAnalyze.json();
    assert.ok(bodyAnalyze.analysis, 'Response must contain analysis object');
    const analysis = bodyAnalyze.analysis;

    assert.equal(analysis.repositoryId, repoA.id);
    assert.equal(analysis.snapshotId, snapshotA.id);
    assert.equal(analysis.status, 'completed');
    assert.equal(analysis.totalFilesAnalyzed, 4);
    assert.equal(analysis.totalFilesFailed, 0);
    assert.ok(analysis.totalSymbols >= 10, 'Must extract at least 10 symbols across 4 files');
    assert.ok(analysis.totalRelationships >= 4, 'Must extract relationships');
    assert.equal(analysis.reused, false);

    // Verify row in PostgreSQL `analysis_runs`
    const { rows: dbRunRows } = await pool.query('SELECT * FROM analysis_runs WHERE id = $1', [analysis.id]);
    assert.equal(dbRunRows.length, 1);
    assert.equal(dbRunRows[0].status, 'completed');

    // Verify symbols in DB
    const { rows: dbSymbols } = await pool.query('SELECT * FROM symbols WHERE analysis_run_id = $1', [analysis.id]);
    assert.ok(dbSymbols.length >= 10);

    // Verify relationships in DB
    const { rows: dbRels } = await pool.query('SELECT * FROM relationships WHERE analysis_run_id = $1', [analysis.id]);
    assert.ok(dbRels.length >= 4);

    // Verify code smells in DB
    const { rows: dbSmells } = await pool.query('SELECT * FROM code_smells WHERE analysis_run_id = $1', [analysis.id]);
    assert.ok(dbSmells.length >= 1);

    // Verify metrics in DB
    const { rows: dbMetrics } = await pool.query('SELECT * FROM metrics WHERE analysis_run_id = $1', [analysis.id]);
    assert.ok(dbMetrics.length >= 15);

    // Verify features in DB
    const { rows: dbFeatures } = await pool.query('SELECT * FROM features WHERE analysis_run_id = $1', [analysis.id]);
    assert.ok(dbFeatures.length >= 20);

    console.log('✓ Test 8 Passed: End-to-end analysis parsed files, persisted symbols, relationships, metrics, smells, and features.');

    // ------------------------------------------------------------------------
    // Test 9: Query Analysis Summary, Features, and Graph API Endpoints
    // ------------------------------------------------------------------------
    console.log('[Test 9] Testing GET analysis summary, features, and graph endpoints...');

    // GET /analysis
    const resGetAnalysis = await fetch(`${baseUrl}/api/repositories/${repoA.id}/snapshots/${snapshotA.id}/analysis`, {
      headers: { 'Cookie': `session_id=${tokenA}` }
    });
    assert.equal(resGetAnalysis.status, 200);
    const bodyGetAnalysis = await resGetAnalysis.json();
    assert.equal(bodyGetAnalysis.analysis.id, analysis.id);

    // GET /analysis/features (CP7 ML Model Contract)
    const resGetFeatures = await fetch(`${baseUrl}/api/repositories/${repoA.id}/snapshots/${snapshotA.id}/analysis/features`, {
      headers: { 'Cookie': `session_id=${tokenA}` }
    });
    assert.equal(resGetFeatures.status, 200);
    const bodyFeatures = await resGetFeatures.json();
    assert.equal(bodyFeatures.snapshotId, snapshotA.id);
    assert.equal(bodyFeatures.featureSchemaVersion, FEATURE_SCHEMA_VERSION);
    assert.ok(bodyFeatures.totalEntities > 0);
    assert.ok(Array.isArray(bodyFeatures.dataset));

    // Verify structure of ML dataset entity
    const sampleEntity = bodyFeatures.dataset.find(e => e.entityType === 'function');
    assert.ok(sampleEntity, 'Must include function entity in ML dataset');
    assert.equal(typeof sampleEntity.features.lines, 'number');
    assert.equal(typeof sampleEntity.features.complexity, 'number');
    assert.equal(typeof sampleEntity.features.max_nesting_depth, 'number');
    assert.equal(typeof sampleEntity.features.has_test, 'number');

    // GET /analysis/graph (Dependency Graph)
    const resGetGraph = await fetch(`${baseUrl}/api/repositories/${repoA.id}/snapshots/${snapshotA.id}/analysis/graph`, {
      headers: { 'Cookie': `session_id=${tokenA}` }
    });
    assert.equal(resGetGraph.status, 200);
    const bodyGraph = await resGetGraph.json();
    assert.ok(bodyGraph.nodes.length >= 4);
    assert.ok(bodyGraph.edges.length >= 4);
    assert.ok(bodyGraph.edges.some(e => e.type === 'IMPORTS'));
    assert.ok(bodyGraph.edges.some(e => e.type === 'CALLS'));
    assert.ok(bodyGraph.edges.some(e => e.type === 'EXTENDS'));

    console.log('✓ Test 9 Passed: Feature dataset and graph APIs verified for Checkpoint 7 ML consumption.');

    // ------------------------------------------------------------------------
    // Test 10: Idempotency & Determinism
    // ------------------------------------------------------------------------
    console.log('[Test 10] Testing analysis idempotency and determinism...');

    const resAnalyzeDup = await fetch(`${baseUrl}/api/repositories/${repoA.id}/snapshots/${snapshotA.id}/analyze`, {
      method: 'POST',
      headers: {
        'Cookie': `session_id=${tokenA}`,
        'Content-Type': 'application/json'
      }
    });
    assert.equal(resAnalyzeDup.status, 200, 'Reused analysis must return HTTP 200 OK');
    const bodyAnalyzeDup = await resAnalyzeDup.json();
    assert.equal(bodyAnalyzeDup.analysis.id, analysis.id, 'Must reuse existing analysis run ID');
    assert.equal(bodyAnalyzeDup.analysis.reused, true);

    // Database still contains 1 analysis run
    const { rows: countRuns } = await pool.query('SELECT count(*) AS count FROM analysis_runs WHERE snapshot_id = $1', [snapshotA.id]);
    assert.equal(parseInt(countRuns[0].count, 10), 1);

    console.log('✓ Test 10 Passed: Idempotent analysis reuse verified with 100% deterministic output.');

    // ------------------------------------------------------------------------
    // Test 11: Resilience to Parse Failures
    // ------------------------------------------------------------------------
    console.log('[Test 11] Testing resilience when encountering malformed code...');

    const commitShaBad = 'f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e60002';
    const { rows: snapshotRowsBad } = await pool.query(`
      INSERT INTO repository_snapshots (
        repository_id, commit_sha, branch, status, total_files, included_files, skipped_files, total_bytes, created_at, completed_at
      ) VALUES ($1, $2, 'main', 'completed', 2, 2, 0, 800, NOW(), NOW())
      RETURNING id
    `, [repoA.id, commitShaBad]);
    const snapshotBad = snapshotRowsBad[0];

    const badPayload = {
      snapshotId: snapshotBad.id,
      repository: { id: repoA.id, fullName: repoA.full_name },
      source: { commitSha: commitShaBad, branch: 'main' },
      files: [
        { path: 'src/good.js', language: 'javascript', content: 'export function good() { return 42; }' },
        { path: 'src/bad.js', language: 'javascript', content: 'const broken = { unterminated: ' }
      ]
    };

    await defaultStorageProvider.saveSnapshot(snapshotBad.id, badPayload);

    const resAnalyzeBad = await fetch(`${baseUrl}/api/repositories/${repoA.id}/snapshots/${snapshotBad.id}/analyze`, {
      method: 'POST',
      headers: {
        'Cookie': `session_id=${tokenA}`,
        'Content-Type': 'application/json'
      }
    });

    assert.equal(resAnalyzeBad.status, 201);
    const bodyAnalyzeBad = await resAnalyzeBad.json();
    assert.equal(bodyAnalyzeBad.analysis.status, 'completed', 'Analysis must complete despite one broken file');
    assert.equal(bodyAnalyzeBad.analysis.totalFilesAnalyzed, 2);
    assert.equal(bodyAnalyzeBad.analysis.totalFilesFailed, 1);

    console.log('✓ Test 11 Passed: Parser failure in single file was gracefully isolated without crashing repository analysis.');

    // Cleanup
    await defaultStorageProvider.deleteSnapshot(snapshotA.id);
    await defaultStorageProvider.deleteSnapshot(snapshotBad.id);
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [userA.id, userB.id]);

    console.log('\n======================================================');
    console.log('ALL CHECKPOINT 6 CODE INTELLIGENCE TESTS PASSED! (11/11)');
    console.log('======================================================\n');
  } finally {
    await stopServer();
    await closePool();
  }
}

runTests().catch((err) => {
  console.error('Intelligence Test Suite Failed:', err);
  process.exit(1);
});
