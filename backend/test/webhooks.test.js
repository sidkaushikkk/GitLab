import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { app } from '../src/app.js';
import { pool, closePool } from '../src/db/pool.js';
import { env } from '../src/config/env.js';

let server;
let baseUrl;

let testUserId;
let testRepoId;
const testRepoFullName = 'test-org/webhook-repo';
const testGitLabProject = 'gitlab-org/webhook-project';

function signGitHubPayload(payload, secret = env.githubWebhookSecret) {
  const jsonStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(jsonStr);
  return `sha256=${hmac.digest('hex')}`;
}

async function setupTestData() {
  const client = await pool.connect();
  try {
    const gId = Math.floor(Date.now() + Math.random() * 10000);
    const uRes = await client.query(`
      INSERT INTO users (github_id, login, name, email)
      VALUES ($1, 'webhook_tester', 'Webhook Tester', 'webhook@test.com')
      RETURNING id
    `, [gId]);
    testUserId = uRes.rows[0].id;

    // Insert GitHub repo
    const rRes = await client.query(`
      INSERT INTO repositories (name, full_name, description, owner, user_id, default_branch, provider_repo_id)
      VALUES ('webhook-repo', $1, 'Test repo for webhook events', 'test-org', $2, 'main', 999111)
      RETURNING id
    `, [testRepoFullName, testUserId]);
    testRepoId = rRes.rows[0].id;

    // Insert GitLab repo
    await client.query(`
      INSERT INTO repositories (name, full_name, description, owner, user_id, default_branch, provider)
      VALUES ('webhook-project', $1, 'GitLab test repo', 'gitlab-org', $2, 'main', 'gitlab')
    `, [testGitLabProject, testUserId]);

  } finally {
    client.release();
  }
}

async function cleanupTestData() {
  const client = await pool.connect();
  try {
    if (testUserId) {
      await client.query('DELETE FROM repositories WHERE user_id = $1', [testUserId]);
      await client.query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
  } finally {
    client.release();
  }
}

test('webhooks: setup test server and fixtures', async () => {
  await setupTestData();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

test('webhooks: 1. GitHub webhook with missing signature returns 401', async () => {
  const payload = { action: 'opened' };
  const res = await fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request'
    },
    body: JSON.stringify(payload)
  });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.match(data.error.message, /Missing X-Hub-Signature-256/);
});

test('webhooks: 2. GitHub webhook with invalid signature returns 401', async () => {
  const payload = { action: 'opened' };
  const res = await fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request',
      'X-Hub-Signature-256': 'sha256=invalid_hex_signature_that_does_not_match_payload_0000000000'
    },
    body: JSON.stringify(payload)
  });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.match(data.error.message, /Invalid webhook signature/);
});

test('webhooks: 3. GitHub opened event with valid signature upserts PR and triggers analysis', async () => {
  const payload = {
    action: 'opened',
    repository: {
      full_name: testRepoFullName,
      id: 999111
    },
    pull_request: {
      number: 301,
      title: 'Add authentication feature',
      body: 'Implements login and session security',
      state: 'open',
      merged: false,
      user: { login: 'octocat' },
      head: { ref: 'feature/auth', sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      base: { ref: 'main', sha: '0000000000000000000000000000000000000000' }
    },
    diffText: 'diff --git a/auth.js b/auth.js\n--- a/auth.js\n+++ b/auth.js\n@@ -1,1 +1,2 @@\n const a = 1;\n+const b = 2;\n'
  };

  const bodyStr = JSON.stringify(payload);
  const signature = signGitHubPayload(bodyStr);

  const res = await fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'delivery-uuid-001',
      'X-Hub-Signature-256': signature
    },
    body: bodyStr
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'completed');
  assert.ok(data.pullRequestId);

  // Query DB to verify PR and analysis were created
  const { rows: prRows } = await pool.query(
    'SELECT * FROM pull_requests WHERE repository_id = $1 AND pr_number = 301',
    [testRepoId]
  );
  assert.equal(prRows.length, 1);
  assert.equal(prRows[0].title, 'Add authentication feature');
  assert.equal(prRows[0].status, 'open');

  const { rows: anaRows } = await pool.query(
    'SELECT * FROM pull_request_analyses WHERE pull_request_id = $1',
    [prRows[0].id]
  );
  assert.equal(anaRows.length, 1);
  assert.equal(anaRows[0].status, 'completed');
});

test('webhooks: 4. GitHub duplicate delivery handled safely (idempotent)', async () => {
  const payload = {
    action: 'opened',
    repository: { full_name: testRepoFullName },
    pull_request: {
      number: 301,
      title: 'Add authentication feature',
      state: 'open',
      head: { ref: 'feature/auth', sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      base: { ref: 'main', sha: '0000000000000000000000000000000000000000' }
    }
  };
  const bodyStr = JSON.stringify(payload);
  const signature = signGitHubPayload(bodyStr);

  // Send same delivery ID again
  const res = await fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'delivery-uuid-001',
      'X-Hub-Signature-256': signature
    },
    body: bodyStr
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.message, /Duplicate delivery/);
});

test('webhooks: 5. GitHub synchronize event updates commit SHA and runs analysis', async () => {
  const payload = {
    action: 'synchronize',
    repository: { full_name: testRepoFullName },
    pull_request: {
      number: 301,
      title: 'Add authentication feature (updated)',
      body: 'Pushed new commit',
      state: 'open',
      merged: false,
      head: { ref: 'feature/auth', sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      base: { ref: 'main', sha: '0000000000000000000000000000000000000000' }
    }
  };
  const bodyStr = JSON.stringify(payload);
  const signature = signGitHubPayload(bodyStr);

  const res = await fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'delivery-uuid-002',
      'X-Hub-Signature-256': signature
    },
    body: bodyStr
  });

  assert.equal(res.status, 200);
  const { rows } = await pool.query(
    'SELECT source_commit_sha FROM pull_requests WHERE repository_id = $1 AND pr_number = 301',
    [testRepoId]
  );
  assert.equal(rows[0].source_commit_sha, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
});

test('webhooks: 6. GitHub closed event marks PR as closed without running risk analysis', async () => {
  const payload = {
    action: 'closed',
    repository: { full_name: testRepoFullName },
    pull_request: {
      number: 301,
      title: 'Add authentication feature',
      state: 'closed',
      merged: true,
      head: { ref: 'feature/auth', sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      base: { ref: 'main', sha: '0000000000000000000000000000000000000000' }
    }
  };
  const bodyStr = JSON.stringify(payload);
  const signature = signGitHubPayload(bodyStr);

  const res = await fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'delivery-uuid-003',
      'X-Hub-Signature-256': signature
    },
    body: bodyStr
  });

  assert.equal(res.status, 200);
  const { rows } = await pool.query(
    'SELECT status FROM pull_requests WHERE repository_id = $1 AND pr_number = 301',
    [testRepoId]
  );
  assert.equal(rows[0].status, 'merged');
});

test('webhooks: 7. GitLab webhook with invalid or missing token returns 401', async () => {
  const payload = { object_kind: 'merge_request' };

  // Missing token
  const resMissing = await fetch(`${baseUrl}/api/webhooks/gitlab`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitLab-Event': 'Merge Request Hook'
    },
    body: JSON.stringify(payload)
  });
  assert.equal(resMissing.status, 401);

  // Invalid token
  const resInvalid = await fetch(`${baseUrl}/api/webhooks/gitlab`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitLab-Event': 'Merge Request Hook',
      'X-GitLab-Token': 'wrong-token'
    },
    body: JSON.stringify(payload)
  });
  assert.equal(resInvalid.status, 401);
});

test('webhooks: 8. GitLab merge request webhook with valid token normalizes payload and triggers analysis', async () => {
  const payload = {
    object_kind: 'merge_request',
    project: {
      path_with_namespace: testGitLabProject
    },
    user: {
      username: 'gitlab_dev'
    },
    object_attributes: {
      iid: 401,
      title: 'Refactor database queries',
      description: 'Optimize SQL indexing',
      source_branch: 'refactor/db',
      target_branch: 'main',
      action: 'open',
      state: 'opened',
      last_commit: { id: 'cccccccccccccccccccccccccccccccccccccccc' },
      target: { id: '0000000000000000000000000000000000000000' }
    },
    diffText: 'diff --git a/db.js b/db.js\n--- a/db.js\n+++ b/db.js\n@@ -1,1 +1,2 @@\n const q = 1;\n+const q2 = 2;\n'
  };

  const res = await fetch(`${baseUrl}/api/webhooks/gitlab`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitLab-Event': 'Merge Request Hook',
      'X-GitLab-Token': env.gitlabWebhookToken
    },
    body: JSON.stringify(payload)
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'completed');
  assert.ok(data.pullRequestId);
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await cleanupTestData();
  await closePool();
});
