import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool, closePool } from '../src/db/pool.js';
import { generateSessionToken, hashSessionToken } from '../src/utils/crypto.js';

let server;
let baseUrl;

let userAId;
let userBId;
let tokenA;
let tokenB;
let repoAId;

async function setupTestData() {
  const client = await pool.connect();
  try {
    const gIdA = Math.floor(Date.now() + Math.random() * 10000);
    const gIdB = gIdA + 1;

    // Create User A
    const uARes = await client.query(`
      INSERT INTO users (github_id, login, name, email)
      VALUES ($1, 'pr_api_user_a', 'User A', 'user_a@prtest.com')
      RETURNING id
    `, [gIdA]);
    userAId = uARes.rows[0].id;

    // Create User B
    const uBRes = await client.query(`
      INSERT INTO users (github_id, login, name, email)
      VALUES ($1, 'pr_api_user_b', 'User B', 'user_b@prtest.com')
      RETURNING id
    `, [gIdB]);
    userBId = uBRes.rows[0].id;

    // Create session for User A
    tokenA = generateSessionToken();
    const hashA = hashSessionToken(tokenA);
    await client.query(`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '1 day')
    `, [userAId, hashA]);

    // Create session for User B
    tokenB = generateSessionToken();
    const hashB = hashSessionToken(tokenB);
    await client.query(`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '1 day')
    `, [userBId, hashB]);

    // Create Repo for User A
    const rARes = await client.query(`
      INSERT INTO repositories (name, full_name, description, owner, user_id, default_branch)
      VALUES ('repo-a', 'user_a/repo-a', 'Repo A for PR API tests', 'user_a', $1, 'main')
      RETURNING id
    `, [userAId]);
    repoAId = rARes.rows[0].id;

    // Insert 2 test PRs in Repo A
    const pr1Res = await client.query(`
      INSERT INTO pull_requests (
        repository_id, pr_number, title, description, author,
        source_branch, target_branch, source_commit_sha, target_commit_sha, status
      ) VALUES ($1, 101, 'Fix typo', 'Minor doc fix', 'user_a', 'fix/typo', 'main', 'sha111', 'sha000', 'open')
      RETURNING id
    `, [repoAId]);
    const pr1Id = pr1Res.rows[0].id;

    const pr2Res = await client.query(`
      INSERT INTO pull_requests (
        repository_id, pr_number, title, description, author,
        source_branch, target_branch, source_commit_sha, target_commit_sha, status
      ) VALUES ($1, 102, 'Feature X', 'Adds feature X', 'contributor', 'feat/x', 'main', 'sha222', 'sha000', 'merged')
      RETURNING id
    `, [repoAId]);
    const pr2Id = pr2Res.rows[0].id;

    // Insert analysis for PR 1
    await client.query(`
      INSERT INTO pull_request_analyses (
        pull_request_id, commit_sha, status, analysis_version,
        risk_score, risk_category, quality_gate, summary
      ) VALUES ($1, 'sha111', 'completed', '1.0.0', 15, 'LOW', 'APPROVED', 'Small clean PR')
    `, [pr1Id]);

    // Insert analysis for PR 2
    await client.query(`
      INSERT INTO pull_request_analyses (
        pull_request_id, commit_sha, status, analysis_version,
        risk_score, risk_category, quality_gate, summary
      ) VALUES ($1, 'sha222', 'completed', '1.0.0', 70, 'HIGH', 'CHANGES_REQUESTED', 'High risk PR')
    `, [pr2Id]);

  } finally {
    client.release();
  }
}

async function cleanupTestData() {
  const client = await pool.connect();
  try {
    if (userAId) {
      await client.query('DELETE FROM repositories WHERE user_id = $1', [userAId]);
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userAId]);
      await client.query('DELETE FROM users WHERE id = $1', [userAId]);
    }
    if (userBId) {
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userBId]);
      await client.query('DELETE FROM users WHERE id = $1', [userBId]);
    }
  } finally {
    client.release();
  }
}

test('prRestApi: setup test server and fixtures', async () => {
  await setupTestData();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

test('prRestApi: 1. GET /api/repositories/:id/pulls lists PRs with pagination and filters', async () => {
  // Unfiltered list
  const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/pulls`, {
    headers: { 'Cookie': `session_id=${tokenA}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.pullRequests.length, 2);
  assert.equal(data.pagination.totalCount, 2);

  // Status filter: open
  const resOpen = await fetch(`${baseUrl}/api/repositories/${repoAId}/pulls?status=open`, {
    headers: { 'Cookie': `session_id=${tokenA}` }
  });
  const dataOpen = await resOpen.json();
  assert.equal(dataOpen.pullRequests.length, 1);
  assert.equal(dataOpen.pullRequests[0].prNumber, 101);

  // Risk filter: HIGH
  const resHigh = await fetch(`${baseUrl}/api/repositories/${repoAId}/pulls?risk=HIGH`, {
    headers: { 'Cookie': `session_id=${tokenA}` }
  });
  const dataHigh = await resHigh.json();
  assert.equal(dataHigh.pullRequests.length, 1);
  assert.equal(dataHigh.pullRequests[0].prNumber, 102);
  assert.equal(dataHigh.pullRequests[0].riskCategory, 'HIGH');
});

test('prRestApi: 2. GET /api/repositories/:id/pulls/:prId returns PR metadata and latest analysis', async () => {
  const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/pulls/101`, {
    headers: { 'Cookie': `session_id=${tokenA}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.pullRequest.prNumber, 101);
  assert.equal(data.pullRequest.title, 'Fix typo');
  assert.ok(data.analysis);
  assert.equal(data.analysis.riskScore, 15);
  assert.equal(data.analysis.qualityGate, 'APPROVED');
});

test('prRestApi: 3. POST /api/repositories/:id/pulls/analyze triggers manual simulation analysis', async () => {
  const diffText = `diff --git a/src/index.js b/src/index.js
--- a/src/index.js
+++ b/src/index.js
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;
`;

  const res = await fetch(`${baseUrl}/api/repositories/${repoAId}/pulls/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `session_id=${tokenA}`
    },
    body: JSON.stringify({
      prNumber: 201,
      title: 'Analyze Simulation PR',
      sourceCommitSha: '4444444444444444444444444444444444444444',
      targetCommitSha: '0000000000000000000000000000000000000000',
      diffText,
      baseFiles: [{ filePath: 'src/index.js', content: 'const a = 1;\n', language: 'javascript' }],
      headFiles: [{ filePath: 'src/index.js', content: 'const a = 1;\nconst b = 2;\n', language: 'javascript' }]
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.pullRequest.prNumber, 201);
  assert.equal(data.analysis.status, 'completed');
  assert.ok(data.analysis.riskScore < 30);
  assert.equal(data.analysis.qualityGate, 'APPROVED');
});

test('prRestApi: 4. Multi-tenant authorization (User B accessing User A repo rejected with 404)', async () => {
  const resCross = await fetch(`${baseUrl}/api/repositories/${repoAId}/pulls`, {
    headers: { 'Cookie': `session_id=${tokenB}` }
  });
  assert.equal(resCross.status, 404, 'User B must not be able to list User A repo PRs');

  const resCrossSingle = await fetch(`${baseUrl}/api/repositories/${repoAId}/pulls/101`, {
    headers: { 'Cookie': `session_id=${tokenB}` }
  });
  assert.equal(resCrossSingle.status, 404, 'User B must not be able to view User A PR');
});

test('prRestApi: 5. Unauthenticated requests rejected with 401', async () => {
  const resUnauth = await fetch(`${baseUrl}/api/repositories/${repoAId}/pulls`);
  assert.equal(resUnauth.status, 401);
});

test('prRestApi: 6. Nonexistent PR returns 404', async () => {
  const resNotFound = await fetch(`${baseUrl}/api/repositories/${repoAId}/pulls/9999999`, {
    headers: { 'Cookie': `session_id=${tokenA}` }
  });
  assert.equal(resNotFound.status, 404);
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await cleanupTestData();
  await closePool();
});
