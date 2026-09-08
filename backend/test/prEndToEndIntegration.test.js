import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { app } from '../src/app.js';
import { pool, closePool } from '../src/db/pool.js';
import { env } from '../src/config/env.js';
import { generateSessionToken, hashSessionToken } from '../src/utils/crypto.js';

let server;
let baseUrl;

let userId;
let repoId;
let sessionToken;
const repoFullName = 'e2e-org/full-pipeline-repo';

function signPayload(payload) {
  const jsonStr = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', env.githubWebhookSecret);
  hmac.update(jsonStr);
  return { signature: `sha256=${hmac.digest('hex')}`, bodyStr: jsonStr };
}

async function setupFixtures() {
  const client = await pool.connect();
  try {
    const gId = Math.floor(Date.now() + Math.random() * 100000);
    const uRes = await client.query(`
      INSERT INTO users (github_id, login, name, email)
      VALUES ($1, 'e2e_analyst', 'E2E Analyst', 'e2e@pipeline.com')
      RETURNING id
    `, [gId]);
    userId = uRes.rows[0].id;

    sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    await client.query(`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '1 day')
    `, [userId, tokenHash]);

    const rRes = await client.query(`
      INSERT INTO repositories (name, full_name, description, owner, user_id, default_branch, provider_repo_id)
      VALUES ('full-pipeline-repo', $1, 'Repository for full E2E pipeline verification', 'e2e-org', $2, 'main', 555888)
      RETURNING id
    `, [repoFullName, userId]);
    repoId = rRes.rows[0].id;

  } finally {
    client.release();
  }
}

async function cleanupFixtures() {
  const client = await pool.connect();
  try {
    if (userId) {
      await client.query('DELETE FROM repositories WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
    }
  } finally {
    client.release();
  }
}

test('prEndToEndIntegration: setup server and test database', async () => {
  await setupFixtures();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

test('prEndToEndIntegration: Webhook -> PR upsert -> Code Intelligence Pipeline -> PR Risk Engine -> Persistence -> GET /pulls/:id', async () => {
  // 1. Prepare Base and Head Code Fixtures
  const baseAuthCode = `
export function verifyCredentials(user, pass) {
  return user === 'admin' && pass === 'secret';
}
`;
  const baseUserCode = `
import { verifyCredentials } from './auth.js';

export function loginService(u, p) {
  return verifyCredentials(u, p);
}
`;

  const headAuthCode = `
export function verifyCredentials(user, pass) {
  if (!user) throw new Error('user required');
  if (!pass) throw new Error('pass required');
  if (user.length < 3) return false;
  if (pass.length < 6) return false;
  return user === 'admin' && pass === 'secret';
}
`;

  const diffText = `diff --git a/src/auth.js b/src/auth.js
--- a/src/auth.js
+++ b/src/auth.js
@@ -2,2 +2,6 @@
 export function verifyCredentials(user, pass) {
+  if (!user) throw new Error('user required');
+  if (!pass) throw new Error('pass required');
+  if (user.length < 3) return false;
+  if (pass.length < 6) return false;
   return user === 'admin' && pass === 'secret';
`;

  const relationships = [
    {
      sourceFilePath: 'src/userService.js',
      targetFilePath: 'src/auth.js',
      relationshipType: 'IMPORTS',
      symbolsImported: ['verifyCredentials']
    }
  ];

  // 2. Construct GitHub Webhook Payload
  const webhookPayload = {
    action: 'opened',
    repository: {
      full_name: repoFullName,
      id: 555888
    },
    pull_request: {
      number: 777,
      title: 'Harden credential verification and validation',
      body: 'Adds length checks and input validation for authentication',
      state: 'open',
      merged: false,
      user: { login: 'security_eng' },
      head: { ref: 'feature/auth-hardening', sha: '9999999999999999999999999999999999999999' },
      base: { ref: 'main', sha: '1111111111111111111111111111111111111111' }
    },
    diffText,
    baseFiles: [
      { filePath: 'src/auth.js', content: baseAuthCode, language: 'javascript' },
      { filePath: 'src/userService.js', content: baseUserCode, language: 'javascript' }
    ],
    headFiles: [
      { filePath: 'src/auth.js', content: headAuthCode, language: 'javascript' },
      { filePath: 'src/userService.js', content: baseUserCode, language: 'javascript' }
    ],
    relationships
  };

  const { signature, bodyStr } = signPayload(webhookPayload);

  // 3. Dispatch Webhook
  const webhookRes = await fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'e2e-delivery-001',
      'X-Hub-Signature-256': signature
    },
    body: bodyStr
  });

  assert.equal(webhookRes.status, 200, 'Webhook response should be 200 OK');
  const webhookData = await webhookRes.json();
  assert.equal(webhookData.status, 'completed');
  assert.ok(webhookData.pullRequestId);
  assert.ok(webhookData.analysisId);

  // 4. Retrieve Analyzed Pull Request via REST API
  const getPrRes = await fetch(`${baseUrl}/api/repositories/${repoId}/pulls/777`, {
    headers: {
      'Cookie': `session_id=${sessionToken}`
    }
  });

  assert.equal(getPrRes.status, 200, 'GET /pulls/:prId should return 200 OK');
  const prDetail = await getPrRes.json();

  // 5. Assert Real Non-Fabricated Results
  const pr = prDetail.pullRequest;
  assert.equal(pr.prNumber, 777);
  assert.equal(pr.title, 'Harden credential verification and validation');
  assert.equal(pr.author, 'security_eng');
  assert.equal(pr.sourceCommitSha, '9999999999999999999999999999999999999999');

  const analysis = prDetail.analysis;
  assert.ok(analysis, 'Analysis must be populated');
  assert.equal(analysis.status, 'completed');
  assert.equal(analysis.analysisVersion, '1.0.0');
  assert.ok(analysis.riskScore > 0, 'Risk score must be calculated and > 0');
  assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(analysis.riskCategory));
  assert.ok(['APPROVED', 'WARNING', 'CHANGES_REQUESTED'].includes(analysis.qualityGate));

  // Blast Radius asserts real downstream file
  assert.deepEqual(analysis.blastRadius.affectedFiles, ['src/userService.js']);
  assert.equal(analysis.blastRadius.directlyAffected.length, 1);
  assert.equal(analysis.blastRadius.directlyAffected[0].filePath, 'src/userService.js');
  assert.equal(analysis.blastRadius.directlyAffected[0].dependedOn, 'src/auth.js');

  // Churn metrics assert real diff numbers
  assert.equal(analysis.churnMetrics.additions, 4);
  assert.equal(analysis.churnMetrics.deletions, 0);
  assert.equal(analysis.churnMetrics.totalChurn, 4);
  assert.equal(analysis.churnMetrics.changedFileCount, 1);

  // Deterministic review findings assert real complexity increase
  const compFinding = analysis.findings.find(f => f.findingType === 'COMPLEXITY_INCREASE');
  assert.ok(compFinding, 'Must identify COMPLEXITY_INCREASE finding');
  assert.equal(compFinding.symbolName, 'verifyCredentials');
  assert.ok(compFinding.evidence.includes('Cyclomatic complexity increased'));
  assert.ok(compFinding.explanation.includes('verifyCredentials'));

  // Diff findings
  assert.ok(prDetail.diffs.length > 0);
  assert.equal(prDetail.diffs[0].filePath, 'src/auth.js');
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await cleanupFixtures();
  await closePool();
});
