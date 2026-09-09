import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../src/db/pool.js';
import {
  calculatePercentageDelta,
  buildMetricDelta,
  getChronologicalSnapshots,
  compareFileLevelChanges,
  compareDuplicationBetweenSnapshots,
  compareSnapshotsDetailed,
  getRepositoryHistory
} from '../src/services/intelligence/historyEngine.js';

test('Longitudinal History & Trajectory Engine', async (t) => {
  t.after(async () => {
    await closePool();
  });

  await t.test('calculatePercentageDelta handles zero denominators and boundaries safely', () => {
    // Zero to zero -> 0%
    assert.equal(calculatePercentageDelta(0, 0), 0);

    // Zero to positive -> +100%
    assert.equal(calculatePercentageDelta(0, 10), 100.0);

    // Zero to negative -> -100%
    assert.equal(calculatePercentageDelta(0, -5), -100.0);

    // Standard progression
    assert.equal(calculatePercentageDelta(10, 15), 50.0);
    assert.equal(calculatePercentageDelta(20, 10), -50.0);
    assert.equal(calculatePercentageDelta(100, 100), 0.0);

    // Large churn
    assert.equal(calculatePercentageDelta(1, 1000), 99900.0);

    // Never produces NaN or Infinity
    const badMath = calculatePercentageDelta(null, undefined);
    assert.ok(Number.isFinite(badMath), 'Must be finite number');
  });

  await t.test('buildMetricDelta constructs complete delta object', () => {
    const delta = buildMetricDelta(10, 14);
    assert.deepEqual(delta, {
      previous: 10,
      current: 14,
      absoluteDelta: 4,
      percentageDelta: 40.0
    });
  });

  await t.test('orders snapshots chronologically using commit_timestamp and created_at', async () => {
    const client = await pool.connect();
    try {
      // Create test user and repository
      const userRes = await client.query(`
        INSERT INTO users (github_id, login, name, email)
        VALUES (9999902, 'order-test-user', 'Order Test', 'order@example.com')
        ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login
        RETURNING id
      `);
      const userId = userRes.rows[0].id;

      const repoRes = await client.query(`
        INSERT INTO repositories (name, full_name, owner, provider, user_id, default_branch)
        VALUES ('order-test-repo', 'test/order-test-repo', 'test', 'github', $1, 'main')
        RETURNING id
      `, [userId]);
      const repoId = repoRes.rows[0].id;

      // Ingest 3 snapshots:
      // snap3 created earlier in ingestion, but its commit_timestamp is LATER
      // snap1 commit_timestamp is 2026-08-01
      // snap2 commit_timestamp is 2026-08-10
      // snap3 commit_timestamp is 2026-08-20
      const s3 = await client.query(`
        INSERT INTO repository_snapshots (repository_id, commit_sha, status, commit_timestamp, created_at)
        VALUES ($1, 'sha-33333333333333333333', 'completed', '2026-08-20T10:00:00Z', '2026-08-01T08:00:00Z')
        RETURNING id
      `, [repoId]);

      const s1 = await client.query(`
        INSERT INTO repository_snapshots (repository_id, commit_sha, status, commit_timestamp, created_at)
        VALUES ($1, 'sha-11111111111111111111', 'completed', '2026-08-01T10:00:00Z', '2026-08-01T09:00:00Z')
        RETURNING id
      `, [repoId]);

      const s2 = await client.query(`
        INSERT INTO repository_snapshots (repository_id, commit_sha, status, commit_timestamp, created_at)
        VALUES ($1, 'sha-22222222222222222222', 'completed', '2026-08-10T10:00:00Z', '2026-08-01T10:00:00Z')
        RETURNING id
      `, [repoId]);

      const ordered = await getChronologicalSnapshots(repoId, pool);

      assert.equal(ordered.length, 3, 'Must return all 3 completed snapshots');
      assert.equal(ordered[0].commit_sha, 'sha-11111111111111111111', 'First must be earliest commit (2026-08-01)');
      assert.equal(ordered[1].commit_sha, 'sha-22222222222222222222', 'Second must be 2026-08-10');
      assert.equal(ordered[2].commit_sha, 'sha-33333333333333333333', 'Third must be 2026-08-20');

      // Cleanup
      await client.query('DELETE FROM repositories WHERE id = $1', [repoId]);
    } finally {
      client.release();
    }
  });

  await t.test('compares duplication between snapshots (new, persistent, resolved, changed)', async () => {
    const client = await pool.connect();
    try {
      const userRes = await client.query(`
        INSERT INTO users (github_id, login, name, email)
        VALUES (9999903, 'dup-traj-user', 'Dup Traj', 'duptraj@example.com')
        ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login
        RETURNING id
      `);
      const userId = userRes.rows[0].id;

      const repoRes = await client.query(`
        INSERT INTO repositories (name, full_name, owner, provider, user_id, default_branch)
        VALUES ('dup-traj-repo', 'test/dup-traj-repo', 'test', 'github', $1, 'main')
        RETURNING id
      `, [userId]);
      const repoId = repoRes.rows[0].id;

      const snapBase = await client.query(`
        INSERT INTO repository_snapshots (repository_id, commit_sha, status)
        VALUES ($1, 'base-sha-1234567890', 'completed')
        RETURNING id
      `, [repoId]);
      const baseId = snapBase.rows[0].id;

      const snapTarget = await client.query(`
        INSERT INTO repository_snapshots (repository_id, commit_sha, status)
        VALUES ($1, 'target-sha-0987654321', 'completed')
        RETURNING id
      `, [repoId]);
      const targetId = snapTarget.rows[0].id;

      // Base snapshot has:
      // - hash1 (will persist)
      // - hash2 (will be resolved / removed)
      await client.query(`
        INSERT INTO snapshot_duplications (snapshot_id, repository_id, clone_hash, token_count, line_count, instances)
        VALUES 
          ($1, $2, 'hash1', 50, 10, '[{"filePath":"a.js","startLine":1,"endLine":10},{"filePath":"b.js","startLine":1,"endLine":10}]'),
          ($1, $2, 'hash2', 60, 12, '[{"filePath":"c.js","startLine":1,"endLine":12},{"filePath":"d.js","startLine":1,"endLine":12}]')
      `, [baseId, repoId]);

      // Target snapshot has:
      // - hash1 (persistent)
      // - hash3 (newly introduced duplication)
      await client.query(`
        INSERT INTO snapshot_duplications (snapshot_id, repository_id, clone_hash, token_count, line_count, instances)
        VALUES 
          ($1, $2, 'hash1', 50, 10, '[{"filePath":"a.js","startLine":1,"endLine":10},{"filePath":"b.js","startLine":1,"endLine":10}]'),
          ($1, $2, 'hash3', 45, 8, '[{"filePath":"e.js","startLine":1,"endLine":8},{"filePath":"f.js","startLine":1,"endLine":8}]')
      `, [targetId, repoId]);

      const diff = await compareDuplicationBetweenSnapshots(baseId, targetId, pool);

      assert.equal(diff.summary.newCloneCount, 1, 'Must have 1 new clone (hash3)');
      assert.equal(diff.newClones[0].cloneHash, 'hash3');

      assert.equal(diff.summary.persistentCloneCount, 1, 'Must have 1 persistent clone (hash1)');
      assert.equal(diff.persistentClones[0].cloneHash, 'hash1');

      assert.equal(diff.summary.resolvedCloneCount, 1, 'Must have 1 resolved clone (hash2)');
      assert.equal(diff.resolvedClones[0].cloneHash, 'hash2');

      // Cleanup
      await client.query('DELETE FROM repositories WHERE id = $1', [repoId]);
    } finally {
      client.release();
    }
  });

  await t.test('single snapshot returns meaningful baseline state rather than fabricated trend', async () => {
    const client = await pool.connect();
    try {
      const userRes = await client.query(`
        INSERT INTO users (github_id, login, name, email)
        VALUES (9999904, 'single-snap-user', 'Single Snap', 'single@example.com')
        ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login
        RETURNING id
      `);
      const userId = userRes.rows[0].id;

      const repoRes = await client.query(`
        INSERT INTO repositories (name, full_name, owner, provider, user_id, default_branch)
        VALUES ('single-snap-repo', 'test/single-snap-repo', 'test', 'github', $1, 'main')
        RETURNING id
      `, [userId]);
      const repoId = repoRes.rows[0].id;

      await client.query(`
        INSERT INTO repository_snapshots (repository_id, commit_sha, status)
        VALUES ($1, 'single-sha-123', 'completed')
      `, [repoId]);

      const history = await getRepositoryHistory(repoId, {}, pool);

      assert.equal(history.state, 'BASELINE', 'Single snapshot must return BASELINE state');
      assert.equal(history.snapshotCount, 1);
      assert.ok(history.message.includes('requires at least two analyzed snapshots'));
      assert.equal(history.timeline[0].isBaseline, true);
      assert.equal(history.timeline[0].deltas, null, 'Baseline snapshot has no deltas');

      // Cleanup
      await client.query('DELETE FROM repositories WHERE id = $1', [repoId]);
    } finally {
      client.release();
    }
  });

  await t.test('compareSnapshotsDetailed rejects self-comparison with 400 error', async () => {
    const fakeSnapId = '11111111-1111-1111-1111-111111111111';
    await assert.rejects(
      async () => {
        await compareSnapshotsDetailed('repo-fake', fakeSnapId, fakeSnapId, pool);
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.ok(err.message.includes('distinct snapshots'));
        return true;
      }
    );
  });

  await t.test('compareSnapshotsDetailed treats null or none baseSnapshotId as baseline with no fabricated deltas', async () => {
    const client = await pool.connect();
    let repoId;
    let userId;
    try {
      const userRes = await client.query(`
        INSERT INTO users (github_id, login, name, email)
        VALUES (9999905, 'base-test-user', 'Base Test', 'base@example.com')
        ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login
        RETURNING id
      `);
      userId = userRes.rows[0].id;

      await client.query('DELETE FROM repositories WHERE user_id = $1', [userId]);

      const repoRes = await client.query(`
        INSERT INTO repositories (name, full_name, owner, provider, user_id, default_branch)
        VALUES ('base-test-repo', 'test/base-test-repo', 'test', 'github', $1, 'main')
        RETURNING id
      `, [userId]);
      repoId = repoRes.rows[0].id;

      const sRes = await client.query(`
        INSERT INTO repository_snapshots (repository_id, commit_sha, status)
        VALUES ($1, 'base-sha-target', 'completed')
        RETURNING id
      `, [repoId]);
      const targetId = sRes.rows[0].id;

      // With null base
      const resNull = await compareSnapshotsDetailed(repoId, null, targetId, pool);
      assert.equal(resNull.isBaseline, true);
      assert.equal(resNull.base, null);
      assert.equal(resNull.deltas, null);
      assert.equal(resNull.target.id, targetId);

      // With 'none' base
      const resNone = await compareSnapshotsDetailed(repoId, 'none', targetId, pool);
      assert.equal(resNone.isBaseline, true);
      assert.equal(resNone.base, null);
      assert.equal(resNone.deltas, null);
      assert.equal(resNone.target.id, targetId);
    } finally {
      if (repoId) {
        await client.query('DELETE FROM repositories WHERE id = $1', [repoId]);
      }
      if (userId) {
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
      }
      client.release();
    }
  });
});

