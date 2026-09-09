import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, closePool } from '../src/db/pool.js';
import {
  generateSessionToken,
  hashSessionToken
} from '../src/utils/crypto.js';
import {
  analyzeAndPersistApiReliability
} from '../src/services/intelligence/apiDiscoveryEngine.js';

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

test('API Reliability & Endpoint Contract REST APIs and Tenant Isolation', async (t) => {
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
        VALUES (777701, 'api-tenant-a', 'Tenant A API', 'api_tenant_a@example.com')
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
        VALUES (777702, 'api-tenant-b', 'Tenant B API', 'api_tenant_b@example.com')
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
        VALUES ('api-repo-a', 'tenant-a/api-repo-a', 'tenant-a', 'github', $1, 'main')
        RETURNING id
      `, [userAId]);
      repoAId = repoARes.rows[0].id;

      // 4. Create Repo B (owned by Tenant B)
      const repoBRes = await client.query(`
        INSERT INTO repositories (name, full_name, owner, provider, user_id, default_branch)
        VALUES ('api-repo-b', 'tenant-b/api-repo-b', 'tenant-b', 'github', $1, 'main')
        RETURNING id
      `, [userBId]);
      repoBId = repoBRes.rows[0].id;

      // 5. Create 2 Snapshots for Repo A
      const snapA1Res = await client.query(`
        INSERT INTO repository_snapshots (repository_id, commit_sha, status, commit_timestamp)
        VALUES ($1, 'commit-api-001', 'completed', '2026-08-01T12:00:00Z')
        RETURNING id
      `, [repoAId]);
      snapA1Id = snapA1Res.rows[0].id;

      const snapA2Res = await client.query(`
        INSERT INTO repository_snapshots (repository_id, commit_sha, status, commit_timestamp)
        VALUES ($1, 'commit-api-002', 'completed', '2026-08-15T12:00:00Z')
        RETURNING id
      `, [repoAId]);
      snapA2Id = snapA2Res.rows[0].id;

      // 6. Analyze and persist API endpoints for snapA1
      const sampleFiles1 = [
        {
          path: 'src/server.js',
          language: 'javascript',
          content: `
            import express from 'express';
            import authRoutes from './routes/auth.js';
            const app = express();
            app.get('/health', (req, res) => res.status(200).send('OK'));
            app.use('/api/auth', authRoutes);
          `
        },
        {
          path: 'src/routes/auth.js',
          language: 'javascript',
          content: `
            import express from 'express';
            const router = express.Router();
            router.post('/login', (req, res) => {
              const { username, password } = req.body;
              res.status(200).json({ token: '123' });
            });
            export default router;
          `
        }
      ];

      await analyzeAndPersistApiReliability(snapA1Id, repoAId, sampleFiles1, {}, pool);

      // 7. Analyze and persist API endpoints for snapA2 (added an endpoint + modified)
      const sampleFiles2 = [
        ...sampleFiles1,
        {
          path: 'src/routes/items.js',
          language: 'javascript',
          content: `
            import express from 'express';
            const router = express.Router();
            router.get('/api/items', requireAuth, async (req, res) => {
              res.status(200).json({ items: [] });
            });
            export default router;
          `
        }
      ];

      await analyzeAndPersistApiReliability(snapA2Id, repoAId, sampleFiles2, {}, pool);

    } finally {
      client.release();
    }

    // TEST 1: Unauthenticated request returns 401
    await t.test('Unauthenticated access to API reliability returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/api-reliability`);
      assert.equal(res.status, 401);
    });

    // TEST 2: Tenant Isolation: Tenant B accessing Repo A returns 404
    await t.test('Tenant B accessing Repo A returns 404 (strict tenant isolation)', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/api-reliability`, {
        headers: { 'Cookie': userBCookie }
      });
      assert.equal(res.status, 404);
      const json = await res.json();
      assert.ok(json.error.message.includes('not found') || json.error.message.includes('access denied'));
    });

    // TEST 3: Tenant A accessing Repo A returns 200 with summary and endpoints
    await t.test('GET /api/repositories/:id/api-reliability returns active overview', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/api-reliability`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.repositoryId, repoAId);
      assert.equal(data.state, 'ACTIVE');
      assert.ok(data.summary !== null);
      assert.ok(data.endpoints.length > 0);
      assert.ok('reliability_score' in data.summary);
    });

    // TEST 4: GET /summary returns aggregate metrics
    await t.test('GET /api/repositories/:id/api-reliability/summary returns summary', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/api-reliability/summary`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.repositoryId, repoAId);
      assert.ok(data.summary !== null);
      assert.ok(Number(data.summary.total_endpoints) > 0);
    });

    // TEST 5: GET /endpoints returns filterable endpoint inventory
    await t.test('GET /api/repositories/:id/api-reliability/endpoints returns endpoints with filter', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/api-reliability/endpoints?method=GET`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.endpoints));
      for (const ep of data.endpoints) {
        assert.equal(ep.method, 'GET');
      }
    });

    // TEST 6: GET /endpoints/:id returns single endpoint details
    await t.test('GET /api/repositories/:id/api-reliability/endpoints/:id returns detail', async () => {
      // First fetch all endpoints to obtain a real endpoint ID
      const listRes = await fetch(`${baseUrl}/api/repositories/${repoAId}/api-reliability/endpoints`, {
        headers: { 'Cookie': userACookie }
      });
      const listData = await listRes.json();
      const firstEp = listData.endpoints[0];
      assert.ok(firstEp);

      const detailRes = await fetch(`${baseUrl}/api/repositories/${repoAId}/api-reliability/endpoints/${firstEp.id}`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(detailRes.status, 200);
      const detailData = await detailRes.json();
      assert.equal(detailData.endpoint.id, firstEp.id);
      assert.ok(Array.isArray(detailData.findings));
    });

    // TEST 7: Cross-repository snapshot comparison returns 404
    await t.test('Comparing snapshot from another repo rejected with 404', async () => {
      const client = await pool.connect();
      let snapBId;
      try {
        const sRes = await client.query(`
          INSERT INTO repository_snapshots (repository_id, commit_sha, status)
          VALUES ($1, 'commit-b-foreign', 'completed')
          RETURNING id
        `, [repoBId]);
        snapBId = sRes.rows[0].id;
      } finally {
        client.release();
      }

      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/api-reliability/compare/${snapA1Id}/${snapBId}`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 404, 'Foreign snapshot must return 404');
    });

    // TEST 8: Self-comparison rejected with HTTP 400
    await t.test('Self-comparison of identical snapshots rejected with 400', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/api-reliability/compare/${snapA1Id}/${snapA1Id}`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.message.includes('distinct snapshots'));
    });

    // TEST 9: Single snapshot baseline comparison
    await t.test('Single snapshot baseline comparison returns isBaseline=true and deltas=null', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/api-reliability/compare/none/${snapA1Id}`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.isBaseline, true);
      assert.equal(data.base, null);
      assert.equal(data.deltas, null);
    });

    // TEST 10: Multi-snapshot trajectory history
    await t.test('GET /api/repositories/:id/api-reliability/history returns multi-snapshot trajectory', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/api-reliability/history`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.state, 'TRAJECTORY_AVAILABLE');
      assert.equal(data.snapshotCount, 2);
      assert.equal(data.timeline.length, 2);
      assert.equal(data.timeline[0].isBaseline, true);
    });

    // TEST 11: Longitudinal differential comparison detects added endpoint
    await t.test('Differential comparison detects added endpoint across snapshots', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/api-reliability/compare/${snapA1Id}/${snapA2Id}`, {
        headers: { 'Cookie': userACookie }
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.isBaseline, false);
      assert.ok(data.deltas.endpoints.addedCount >= 1, 'Must detect at least 1 added endpoint');
      assert.ok(data.deltas.endpoints.added.some(e => e.routePath === '/api/items'));
    });

  } finally {
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
