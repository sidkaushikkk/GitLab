import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../src/db/pool.js';
import {
  detectDuplication,
  detectAndPersistSnapshotDuplication
} from '../src/services/intelligence/duplicationEngine.js';

test('Deterministic Code Duplication Engine', async (t) => {
  t.after(async () => {
    await closePool();
  });

  await t.test('detects Type-1 exact clones between two files', () => {
    // 50+ tokens function spanning 12 lines
    const cloneFunction = `
      function validateCustomerCredentials(username, passwordHash, tenantId) {
        if (!username || typeof username !== 'string') {
          return { isValid: false, reason: 'INVALID_USERNAME' };
        }
        if (!passwordHash || passwordHash.length < 32) {
          return { isValid: false, reason: 'INVALID_HASH' };
        }
        const record = databaseLookup(tenantId, username);
        if (!record || record.isLocked) {
          return { isValid: false, reason: 'ACCOUNT_LOCKED' };
        }
        return { isValid: true, account: record };
      }
    `;

    const files = [
      {
        path: 'src/services/authService.js',
        content: `// Service logic\n${cloneFunction}\nexport default validateCustomerCredentials;`
      },
      {
        path: 'src/legacy/oldAuth.js',
        content: `// Legacy copy-pasted logic\n${cloneFunction}\nmodule.exports = validateCustomerCredentials;`
      }
    ];

    const result = detectDuplication(files, { minTokenThreshold: 35, minLineThreshold: 4 });

    assert.ok(result.summary.cloneCount >= 2, 'Must detect at least 2 clone instances');
    assert.ok(result.summary.cloneGroupCount >= 1, 'Must detect 1 clone cluster');
    assert.equal(result.summary.interFileClones, 1, 'Must be classified as inter-file clone');
    assert.equal(result.clones[0].cloneType, 'TYPE_1', 'Identical tokens must be TYPE_1');
    assert.ok(result.summary.duplicationRatio > 0, 'Duplication ratio must be positive');
  });

  await t.test('detects Type-2 parameterized clones with renamed variables', () => {
    const original = `
      function processEmployeeBonus(empId, baseSalary, performanceScore) {
        if (performanceScore < 1.0) {
          return { eligible: false, bonusAmount: 0 };
        }
        let multiplier = 0.10;
        if (performanceScore >= 4.5) {
          multiplier = 0.35;
        } else if (performanceScore >= 3.0) {
          multiplier = 0.20;
        }
        const bonus = baseSalary * multiplier;
        return { eligible: true, bonusAmount: bonus };
      }
    `;

    // Same AST structure, different variable and function names
    const renamedClone = `
      function calculateVendorPayout(vendorId, contractFee, qualityRating) {
        if (qualityRating < 1.0) {
          return { eligible: false, bonusAmount: 0 };
        }
        let rate = 0.10;
        if (qualityRating >= 4.5) {
          rate = 0.35;
        } else if (qualityRating >= 3.0) {
          rate = 0.20;
        }
        const payout = contractFee * rate;
        return { eligible: true, bonusAmount: payout };
      }
    `;

    const files = [
      { path: 'src/payroll/bonus.js', content: original },
      { path: 'src/billing/payout.js', content: renamedClone }
    ];

    const result = detectDuplication(files, { minTokenThreshold: 35, minLineThreshold: 4 });

    assert.ok(result.summary.cloneGroupCount >= 1, 'Must detect Type-2 clone cluster');
    assert.equal(result.clones[0].cloneType, 'TYPE_2', 'Parameterized rename must be classified as TYPE_2');
    assert.equal(result.clones[0].instances.length, 2, 'Clone cluster must have 2 instances');
  });

  await t.test('filters out trivial fragments below threshold', () => {
    // 3 short boilerplate lines under 20 tokens
    const shortSnippet = `
      if (err) {
        return callback(err);
      }
    `;

    const files = [
      { path: 'src/handler1.js', content: shortSnippet },
      { path: 'src/handler2.js', content: shortSnippet }
    ];

    const result = detectDuplication(files, { minTokenThreshold: 40, minLineThreshold: 4 });

    assert.equal(result.summary.cloneGroupCount, 0, 'Sub-threshold snippet must not be reported as a clone');
    assert.equal(result.summary.duplicatedLines, 0);
    assert.equal(result.summary.duplicationRatio, 0);
  });

  await t.test('detects intra-file duplicate blocks within the same file', () => {
    const duplicateBlock = `
      if (config && config.enableLogging) {
        console.log("Trace starting operation", traceId);
        logger.info({ traceId, tenantId, timestamp: Date.now() }, "Starting telemetry logging");
        metrics.increment("operations.started", 1);
      }
    `;

    const singleFileContent = `
      function firstAction(traceId, tenantId, config) {
        ${duplicateBlock}
        return doFirst();
      }

      function secondAction(traceId, tenantId, config) {
        ${duplicateBlock}
        return doSecond();
      }
    `;

    const files = [
      { path: 'src/actions/telemetry.js', content: singleFileContent }
    ];

    const result = detectDuplication(files, { minTokenThreshold: 30, minLineThreshold: 4 });

    assert.ok(result.summary.cloneGroupCount >= 1, 'Must identify intra-file clone');
    assert.equal(result.summary.intraFileClones, 1, 'Must be marked as intra-file');
    assert.equal(result.clones[0].isIntraFile, true);
  });

  await t.test('persists duplication findings to database idempotently', async () => {
    const client = await pool.connect();
    try {
      // 1. Create a dummy test user, repo and snapshot
      const userRes = await client.query(`
        INSERT INTO users (github_id, login, name, email)
        VALUES (9999901, 'dup-test-user', 'Dup Test', 'duptest@example.com')
        ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login
        RETURNING id
      `);
      const userId = userRes.rows[0].id;

      const repoRes = await client.query(`
        INSERT INTO repositories (name, full_name, owner, provider, user_id, default_branch)
        VALUES ('dup-test-repo', 'test/dup-test-repo', 'test', 'github', $1, 'main')
        RETURNING id
      `, [userId]);
      const repoId = repoRes.rows[0].id;

      const snapRes = await client.query(`
        INSERT INTO repository_snapshots (repository_id, commit_sha, status)
        VALUES ($1, 'aabbccddee1122334455', 'completed')
        RETURNING id
      `, [repoId]);
      const snapshotId = snapRes.rows[0].id;

      const codeBlock = `
        function executeTransactionBatch(records, connectionPool) {
          if (!records || records.length === 0) return { count: 0, status: 'EMPTY' };
          const results = [];
          for (let i = 0; i < records.length; i++) {
            const item = records[i];
            const processed = connectionPool.executeSingle(item);
            results.push(processed);
          }
          return { count: results.length, status: 'SUCCESS', details: results };
        }
      `;

      const files = [
        { path: 'src/batchA.js', content: codeBlock },
        { path: 'src/batchB.js', content: codeBlock }
      ];

      // 2. First Run: compute and persist
      const res1 = await detectAndPersistSnapshotDuplication(snapshotId, repoId, files, { minTokenThreshold: 35 }, pool);
      assert.equal(res1.summary.reused, false, 'First run should not be reused');
      assert.ok(res1.summary.cloneGroupCount >= 1);

      // 3. Second Run: idempotent reuse without recalculation
      const res2 = await detectAndPersistSnapshotDuplication(snapshotId, repoId, files, { minTokenThreshold: 35 }, pool);
      assert.equal(res2.summary.reused, true, 'Second run should reuse persisted database records');
      assert.equal(res2.summary.cloneGroupCount, res1.summary.cloneGroupCount);
      assert.equal(res2.summary.duplicatedLines, res1.summary.duplicatedLines);

      // 4. Verify database records
      const { rows: dbSummaries } = await pool.query(
        'SELECT * FROM snapshot_duplication_summaries WHERE snapshot_id = $1',
        [snapshotId]
      );
      assert.equal(dbSummaries.length, 1, 'Only 1 summary row per snapshot');

      const { rows: dbClones } = await pool.query(
        'SELECT * FROM snapshot_duplications WHERE snapshot_id = $1',
        [snapshotId]
      );
      assert.ok(dbClones.length >= 1, 'Clones must be persisted in database');

      // Cleanup
      await client.query('DELETE FROM repositories WHERE id = $1', [repoId]);
    } finally {
      client.release();
    }
  });
});
