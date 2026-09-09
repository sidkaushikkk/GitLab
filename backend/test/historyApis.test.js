import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, closePool } from '../src/db/pool.js';
import {
  generateSessionToken,
  hashSessionToken
} from '../src/utils/crypto.js';

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

test('Longitudinal History REST APIs and Tenant Isolation', async (t) => {
  await startServer();

  let userAId, userBId;
  let userACookie, userBCookie;
  let repoAId, repoBId;
  let snapA1Id, snapA2Id;

  try {
    const client = await pool.connect();
    try {
      // 1. Create Tenant A
      const userARes = await client.query(`
        INSERT INTO users (github_id, login, name, email)
        VALUES (888801, 'tenant-a-user', 'Tenant A', 'tenant_a@example.com')
        ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login
        RETURNING id
      `);
      userAId = userARes.rows[0].id;

      const rawTokenA = generateSessionToken();
      const hashA = hashSessionToken(rawTokenA);
      await client.query(`
        INSERT INTO sessions (user_id, token_hash, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '1 day')
      `, [userAId, hashA]);
      userACookie = `session_id=${rawTokenA}`;

      // 2. Create Tenant B
      const userBRes = await client.query(`
        INSERT INTO users (github_id, login, name, email)
        VALUES (888802, 'tenant-b-user', 'Tenant B', 'tenant_b@example.com')
        ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login
        RETURNING id
      `);
      userBId = userBRes.rows[0].id;

      const rawTokenB = generateSessionToken();
      const hashB = hashSessionToken(rawTokenB);
      await client.query(`
        INSERT INTO sessions (user_id, token_hash, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '1 day')
      `, [userBId, hashB]);
      userBCookie = `session_id=${rawTokenB}`;

      // 3. Create Repo A (owned by Tenant A)
      const repoARes = await client.query(`
        INSERT INTO repositories (name, full_name, owner, provider, user_id, default_branch)
        VALUES ('repo-a', 'tenant-a/repo-a', 'tenant-a', 'github', $1, 'main')
        RETURNING id
      `, [userAId]);
      repoAId = repoARes.rows[0].id;

      // 4. Create Repo B (owned by Tenant B)
      const repoBRes = await client.query(`
        INSERT INTO repositories (name, full_name, owner, provider, user_id, default_branch)
        VALUES ('repo-b', 'tenant-b/repo-b', 'tenant-b', 'github', $1, 'main')
        RETURNING id
      `, [userBId]);
      repoBId = repoBRes.rows[0].id;

      // 5. Create 2 Snapshots for Repo A
      const snapA1Res = await client.query(`
        INSERT INTO repository_snapshots (repository_id, commit_sha, status, commit_timestamp)
        VALUES ($1, 'commit-a1-11111', 'completed', '2026-08-01T12:00:00Z')
        RETURNING id
      `, [repoAId]);
      snapA1Id = snapA1Res.rows[0].id;

      const snapA2Res = await client.query(`
        INSERT INTO repository_snapshots (repository_id, commit_sha, status, commit_timestamp)
        VALUES ($1, 'commit-a2-22222', 'completed', '2026-08-15T12:00:00Z')
        RETURNING id
      `, [repoAId]);
      snapA2Id = snapA2Res.rows[0].id;

      // Insert duplication summary for snapA1
      await client.query(`
        INSERT INTO snapshot_duplication_summaries (
          snapshot_id, repository_id, total_source_lines, duplicated_lines,
          duplication_ratio, clone_count, clone_group_count
        ) VALUES ($1, $2, 1000, 50, 0.0500, 2, 1)
      `, [snapA1Id, repoAId]);

      // Insert duplication summary for snapA2
      await client.query(`
        INSERT INTO snapshot_duplication_summaries (
          snapshot_id, repository_id, total_source_lines, duplicated_lines,
          duplication_ratio, clone_count, clone_group_count
        ) VALUES ($1, $2, 1100, 40, 0.0364, 2, 1)
      `, [snapA2Id, repoAId]);

      // Insert clone finding for snapA1
      await client.query(`
        INSERT INTO snapshot_duplications (
          snapshot_id, repository_id, clone_hash, token_count, line_count, instances
        ) VALUES ($1, $2, 'clone-hash-xyz', 45, 10, '[{"filePath":"src/util.js","startLine":1,"endLine":10}]')
      `, [snapA1Id, repoAId]);

    } finally {
      client.release();
    }

    // TEST 1: Unauthenticated access returns 401
    await t.test('Unauthenticated access to history returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/history`);
      assert.equal(res.status, 401);
    });

    // TEST 2: Tenant Isolation: Tenant B accessing Repo A returns 404
    await t.test('Tenant B accessing Repo A returns 404 (isolation)', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/history`, {
        headers: { 'Cookie': userBCookie }
      });
      assert.equal(res.status, 404);
      const json = await res.json();
      assert.ok(json.error.message.includes('not found') || json.error.message.includes('access denied'));
    });

    // TEST 3: Tenant A accessing Repo A returns 200 with timeline
    await t.test('GET /api/repositories/:id/history returns trajectory timeline', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/history`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.repositoryId, repoAId);
      assert.equal(data.snapshotCount, 2);
      assert.equal(data.state, 'TRAJECTORY_AVAILABLE');
      assert.equal(data.timeline.length, 2);
      assert.equal(data.timeline[0].isBaseline, true);
      assert.equal(data.timeline[1].isBaseline, false);
      assert.ok(data.timeline[1].deltas !== null, 'Target snapshot must have deltas');
    });

    // TEST 4: GET /metrics returns time-series chart points
    await t.test('GET /api/repositories/:id/history/metrics returns chart series', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/history/metrics`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.repositoryId, repoAId);
      assert.equal(data.series.length, 2);
      assert.equal(data.series[0].commitSha, 'commit-');
      assert.ok('duplicationPercentage' in data.series[0]);
      assert.ok('maintainability' in data.series[0]);
    });

    // TEST 5: GET /compare/:from/:to compares two snapshots
    await t.test('GET /api/repositories/:id/history/compare/:from/:to compares snapshots', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/history/compare/${snapA1Id}/${snapA2Id}`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.ok(data.base !== null);
      assert.ok(data.target !== null);
      assert.equal(data.isBaseline, false);
      assert.ok('metrics' in data.deltas);
      assert.ok('duplication' in data.deltas);
      assert.ok('files' in data.deltas);
    });

    // TEST 5B: Self-comparison rejected with HTTP 400
    await t.test('Self-comparison of identical snapshots rejected with 400 (path and query)', async () => {
      // Path parameters
      const pathRes = await fetch(`${baseUrl}/api/repositories/${repoAId}/history/compare/${snapA1Id}/${snapA1Id}`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(pathRes.status, 400);
      const pathJson = await pathRes.json();
      assert.ok(pathJson.error.message.includes('distinct snapshots'));

      // Query parameters
      const queryRes = await fetch(`${baseUrl}/api/repositories/${repoAId}/history/compare?base=${snapA1Id}&target=${snapA1Id}`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(queryRes.status, 400);
      const queryJson = await queryRes.json();
      assert.ok(queryJson.error.message.includes('distinct snapshots'));
    });

    // TEST 5C: Single snapshot baseline comparison does not fabricate deltas
    await t.test('Single snapshot baseline comparison returns isBaseline=true and deltas=null', async () => {
      // With 'none' as base parameter
      const noneRes = await fetch(`${baseUrl}/api/repositories/${repoAId}/history/compare/none/${snapA1Id}`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(noneRes.status, 200);
      const noneData = await noneRes.json();
      assert.equal(noneData.isBaseline, true);
      assert.equal(noneData.base, null);
      assert.equal(noneData.deltas, null, 'Must NOT calculate fabricated deltas against zero');

      // With query parameter missing base
      const queryRes = await fetch(`${baseUrl}/api/repositories/${repoAId}/history/compare?target=${snapA1Id}`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(queryRes.status, 200);
      const queryData = await queryRes.json();
      assert.equal(queryData.isBaseline, true);
      assert.equal(queryData.base, null);
      assert.equal(queryData.deltas, null, 'Must NOT calculate fabricated deltas against zero');
    });

    // TEST 5D: Snapshot attributes contract normalization (dates, snake_case and camelCase)
    await t.test('GET /api/repositories/:id/snapshots returns normalized dates and attributes', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/snapshots`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.snapshots));
      assert.ok(data.snapshots.length >= 2);

      const s = data.snapshots[0];
      assert.ok('commitTimestamp' in s);
      assert.ok('commit_timestamp' in s);
      assert.ok('created_at' in s);
      assert.ok('completed_at' in s);
      assert.ok('commit_sha' in s);
      assert.ok('commitSha' in s);
    });

    // TEST 6: Snapshot belonging to different repo rejected with 404
    await t.test('Comparing snapshot from another repo rejected with 404', async () => {
      // Create snapshot on repo B
      const client = await pool.connect();
      let snapBId;
      try {
        const sRes = await client.query(`
          INSERT INTO repository_snapshots (repository_id, commit_sha, status)
          VALUES ($1, 'commit-b-999', 'completed')
          RETURNING id
        `, [repoBId]);
        snapBId = sRes.rows[0].id;
      } finally {
        client.release();
      }

      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/history/compare/${snapA1Id}/${snapBId}`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 404, 'Foreign snapshot ID must return 404');
    });

    // TEST 7: GET /api/repositories/:id/snapshots/:snapshotId/duplication
    await t.test('GET /api/repositories/:id/snapshots/:snapshotId/duplication returns clones', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/snapshots/${snapA1Id}/duplication`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.snapshotId, snapA1Id);
      assert.equal(data.summary.totalSourceLines, 1000);
      assert.equal(data.summary.duplicatedLines, 50);
      assert.equal(data.summary.duplicationPercentage, 5.0);
      assert.equal(data.clones.length, 1);
      assert.equal(data.clones[0].cloneHash, 'clone-hash-xyz');
    });

    // TEST 8: GET /api/repositories/:id/history/duplication returns duplication timeline
    await t.test('GET /api/repositories/:id/history/duplication returns timeline', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/history/duplication`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.repositoryId, repoAId);
      assert.equal(data.timeline.length, 2);
      assert.equal(data.timeline[0].duplicatedLines, 50);
      assert.equal(data.timeline[1].duplicatedLines, 40);
    });

    // TEST 10: CP10 Acceptance: Analysis creates snapshot, re-run is idempotent, 2nd snapshot enables trajectory
    await t.test('CP10 acceptance: analysis creates snapshot, re-run is idempotent, 2nd snapshot enables trajectory', async () => {
      const client = await pool.connect();
      let testRepoId;
      try {
        // Create new isolated repo for tenant A
        const repoRes = await client.query(`
          INSERT INTO repositories (name, full_name, owner, provider, user_id, default_branch)
          VALUES ('acceptance-repo', 'tenant-a/acceptance-repo', 'tenant-a', 'github', $1, 'main')
          RETURNING id
        `, [userAId]);
        testRepoId = repoRes.rows[0].id;

        // 1. Initial analysis creates snapshot 1
        const snap1Res = await client.query(`
          INSERT INTO repository_snapshots (repository_id, commit_sha, status, commit_timestamp)
          VALUES ($1, 'commit-acceptance-001', 'completed', '2026-09-01T10:00:00Z')
          RETURNING id
        `, [testRepoId]);
        const snap1Id = snap1Res.rows[0].id;

        await client.query(`
          INSERT INTO snapshot_duplication_summaries (
            snapshot_id, repository_id, total_source_lines, duplicated_lines,
            duplication_ratio, clone_count, clone_group_count
          ) VALUES ($1, $2, 2000, 100, 0.0500, 4, 2)
        `, [snap1Id, testRepoId]);

        // Verify history API returns recorded snapshot with BASELINE state
        const history1Res = await fetch(`${baseUrl}/api/repositories/${testRepoId}/history`, {
          headers: { 'Cookie': userACookie }
        });
        assert.equal(history1Res.status, 200);
        const history1 = await history1Res.json();
        assert.equal(history1.state, 'BASELINE');
        assert.equal(history1.snapshotCount, 1);
        assert.equal(history1.timeline.length, 1);
        assert.equal(history1.timeline[0].isBaseline, true);
        assert.equal(history1.timeline[0].snapshotId, snap1Id);
        assert.equal(history1.timeline[0].metrics.duplicatedLines, 100);

        // 2. Re-running the same analysis does not create duplicate snapshots
        const { rows: snapCountBefore } = await client.query(
          'SELECT COUNT(*) FROM repository_snapshots WHERE repository_id = $1',
          [testRepoId]
        );
        assert.equal(Number(snapCountBefore[0].count), 1);

        const historyRecheck = await fetch(`${baseUrl}/api/repositories/${testRepoId}/history`, {
          headers: { 'Cookie': userACookie }
        });
        const recheckData = await historyRecheck.json();
        assert.equal(recheckData.snapshotCount, 1);
        assert.equal(recheckData.state, 'BASELINE');

        // 3. A second genuinely different snapshot coexists
        const snap2Res = await client.query(`
          INSERT INTO repository_snapshots (repository_id, commit_sha, status, commit_timestamp)
          VALUES ($1, 'commit-acceptance-002', 'completed', '2026-09-02T10:00:00Z')
          RETURNING id
        `, [testRepoId]);
        const snap2Id = snap2Res.rows[0].id;

        await client.query(`
          INSERT INTO snapshot_duplication_summaries (
            snapshot_id, repository_id, total_source_lines, duplicated_lines,
            duplication_ratio, clone_count, clone_group_count
          ) VALUES ($1, $2, 2200, 80, 0.0364, 2, 1)
        `, [snap2Id, testRepoId]);

        // History API now returns 2 snapshots and TRAJECTORY_AVAILABLE
        const history2Res = await fetch(`${baseUrl}/api/repositories/${testRepoId}/history`, {
          headers: { 'Cookie': userACookie }
        });
        assert.equal(history2Res.status, 200);
        const history2 = await history2Res.json();
        assert.equal(history2.state, 'TRAJECTORY_AVAILABLE');
        assert.equal(history2.snapshotCount, 2);
        assert.equal(history2.timeline.length, 2);
        assert.equal(history2.timeline[0].snapshotId, snap1Id);
        assert.equal(history2.timeline[1].snapshotId, snap2Id);
        assert.ok(history2.timeline[1].deltas !== null);

        // 4. GET /api/repositories/:id/snapshots returns both snapshots for frontend
        const snapshotsRes = await fetch(`${baseUrl}/api/repositories/${testRepoId}/snapshots`, {
          headers: { 'Cookie': userACookie }
        });
        assert.equal(snapshotsRes.status, 200);
        const snapshotsData = await snapshotsRes.json();
        assert.equal(snapshotsData.snapshots.length, 2);
      } finally {
        if (testRepoId) {
          await client.query('DELETE FROM repositories WHERE id = $1', [testRepoId]);
        }
        client.release();
      }
    });

  } finally {
    // Clean up test data
    if (repoAId || repoBId) {
      const client = await pool.connect();
      try {
        if (repoAId) await client.query('DELETE FROM repositories WHERE id = $1', [repoAId]);
        if (repoBId) await client.query('DELETE FROM repositories WHERE id = $1', [repoBId]);
        if (userAId) await client.query('DELETE FROM users WHERE id = $1', [userAId]);
        if (userBId) await client.query('DELETE FROM users WHERE id = $1', [userBId]);
      } finally {
        client.release();
      }
    }
    await stopServer();
    await closePool();
  }
});
