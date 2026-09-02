import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { pool, closePool } from '../src/db/pool.js';
import {
  encryptToken,
  generateSessionToken,
  hashSessionToken
} from '../src/utils/crypto.js';
import { githubService } from '../src/services/github.js';
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
  console.log('--- Starting Checkpoint 4 Repository Connection & Per-User Uniqueness Test Suite ---');
  await startServer();

  try {
    // ------------------------------------------------------------------------
    // Test 1: Unauthenticated Endpoints Return HTTP 401
    // ------------------------------------------------------------------------
    console.log('[Test 1] Testing unauthenticated access to repository endpoints...');
    
    const resGithubUnauth = await fetch(`${baseUrl}/api/repositories/github`);
    assert.equal(resGithubUnauth.status, 401, 'GET /api/repositories/github must require authentication');

    const resPostUnauth = await fetch(`${baseUrl}/api/repositories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'octocat', name: 'Hello-World' })
    });
    assert.equal(resPostUnauth.status, 401, 'POST /api/repositories must require authentication');

    const resListUnauth = await fetch(`${baseUrl}/api/repositories`);
    assert.equal(resListUnauth.status, 401, 'GET /api/repositories must require authentication');

    console.log('✓ Test 1 Passed: Unauthenticated requests correctly rejected with HTTP 401.');

    // ------------------------------------------------------------------------
    // Setup Test Users & Sessions in PostgreSQL
    // ------------------------------------------------------------------------
    const key = env.githubTokenEncryptionKey;
    const testEncryptedToken = encryptToken('gho_test_user_token_abc123', key);

    // User A
    const userAGithubId = Date.now() + 100;
    const { rows: userARows } = await pool.query(`
      INSERT INTO users (github_id, login, name, avatar_url, email, github_access_token_encrypted)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, login
    `, [userAGithubId, `user_a_${Date.now()}`, 'User Alpha', 'https://example.com/a.png', 'usera@example.com', testEncryptedToken]);
    const userA = userARows[0];

    const tokenA = generateSessionToken();
    const hashA = hashSessionToken(tokenA);
    await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')', [hashA, userA.id]);

    // User B
    const userBGithubId = Date.now() + 200;
    const { rows: userBRows } = await pool.query(`
      INSERT INTO users (github_id, login, name, avatar_url, email, github_access_token_encrypted)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, login
    `, [userBGithubId, `user_b_${Date.now()}`, 'User Beta', 'https://example.com/b.png', 'userb@example.com', testEncryptedToken]);
    const userB = userBRows[0];

    const tokenB = generateSessionToken();
    const hashB = hashSessionToken(tokenB);
    await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')', [hashB, userB.id]);

    // Mock githubService.verifyAndGetRepository for deterministic unit testing
    const originalVerify = githubService.verifyAndGetRepository;
    const originalGetRepos = githubService.getUserRepositories;

    githubService.verifyAndGetRepository = async (userId, owner, name) => {
      if (owner === 'forbidden-org') {
        const err = new Error(`Repository ${owner}/${name} not found or access denied.`);
        err.status = 403;
        throw err;
      }
      return {
        providerRepoId: 98765432,
        owner,
        name,
        fullName: `${owner}/${name}`,
        description: 'Mock verified repository for testing',
        defaultBranch: 'main',
        language: 'TypeScript',
        private: true,
        stars: 42,
        forks: 10
      };
    };

    githubService.getUserRepositories = async (userId, options) => {
      return [
        {
          id: 98765432,
          name: 'payment-service',
          fullName: 'HitachiSystems/payment-service',
          owner: 'HitachiSystems',
          description: 'Core payment processing engine',
          private: true,
          visibility: 'Private',
          defaultBranch: 'main',
          language: 'TypeScript',
          stars: 48,
          forks: 12,
          updatedAt: '2026-08-31T12:00:00Z'
        }
      ];
    };

    // ------------------------------------------------------------------------
    // Test 2: Discovery via GET /api/repositories/github
    // ------------------------------------------------------------------------
    console.log('[Test 2] Testing GitHub repository discovery for authenticated user...');
    const resDiscovery = await fetch(`${baseUrl}/api/repositories/github`, {
      headers: { 'Cookie': `session_id=${tokenA}` }
    });
    assert.equal(resDiscovery.status, 200, 'Discovery must return HTTP 200');
    const bodyDiscovery = await resDiscovery.json();
    assert.ok(Array.isArray(bodyDiscovery.repositories), 'Must return repositories array');
    assert.equal(bodyDiscovery.repositories.length, 1);
    assert.equal(bodyDiscovery.repositories[0].name, 'payment-service');
    assert.equal(bodyDiscovery.repositories[0].isImported, false, 'Should be marked as not imported initially');
    console.log('✓ Test 2 Passed: GitHub repository discovery returned real formatted repositories.');

    // ------------------------------------------------------------------------
    // Test 3: User A Connects Repo X -> 1 row
    // ------------------------------------------------------------------------
    console.log('[Test 3] Testing User A connecting repository X...');
    const resConnectA = await fetch(`${baseUrl}/api/repositories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `session_id=${tokenA}`
      },
      body: JSON.stringify({
        owner: 'HitachiSystems',
        name: 'payment-service',
        provider: 'github'
      })
    });
    assert.equal(resConnectA.status, 201, 'Connecting repository must return HTTP 201 Created');
    const bodyConnectA = await resConnectA.json();
    assert.equal(bodyConnectA.repository.fullName, 'HitachiSystems/payment-service');
    assert.equal(bodyConnectA.repository.userId, userA.id);

    // Verify row in PostgreSQL for User A
    const { rows: dbRowsA } = await pool.query(
      'SELECT * FROM repositories WHERE user_id = $1 AND name = $2',
      [userA.id, 'payment-service']
    );
    assert.equal(dbRowsA.length, 1, 'User A must have 1 repository row in PostgreSQL');
    console.log('✓ Test 3 Passed: User A connected repo X (1 row created for User A).');

    // ------------------------------------------------------------------------
    // Test 4: User A Connects Repo X Again -> Still 1 row (Idempotent per user)
    // ------------------------------------------------------------------------
    console.log('[Test 4] Testing User A connecting repository X again (idempotency)...');
    const resConnectAAgain = await fetch(`${baseUrl}/api/repositories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `session_id=${tokenA}`
      },
      body: JSON.stringify({
        owner: 'HitachiSystems',
        name: 'payment-service',
        provider: 'github'
      })
    });
    assert.equal(resConnectAAgain.status, 201, 'Connecting same repository again must succeed without error');
    
    // Ensure no duplicate row was created for User A
    const { rows: dupCheckA } = await pool.query(
      'SELECT count(*) AS count FROM repositories WHERE user_id = $1 AND provider = \'github\' AND owner = \'HitachiSystems\' AND name = \'payment-service\'',
      [userA.id]
    );
    assert.equal(parseInt(dupCheckA[0].count, 10), 1, 'User A must still have exactly 1 row');
    console.log('✓ Test 4 Passed: User A connecting repo X again maintains 1 row.');

    // ------------------------------------------------------------------------
    // Test 5: User B Connects Repo X -> Allowed, Separate Row Created
    // ------------------------------------------------------------------------
    console.log('[Test 5] Testing User B connecting the same repository X (per-user uniqueness)...');
    const resConnectB = await fetch(`${baseUrl}/api/repositories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `session_id=${tokenB}`
      },
      body: JSON.stringify({
        owner: 'HitachiSystems',
        name: 'payment-service',
        provider: 'github'
      })
    });
    assert.equal(resConnectB.status, 201, 'User B connecting same repo must return HTTP 201 Created');
    const bodyConnectB = await resConnectB.json();
    assert.equal(bodyConnectB.repository.fullName, 'HitachiSystems/payment-service');
    assert.equal(bodyConnectB.repository.userId, userB.id, 'Repository must be assigned to User B');

    // Verify database contains 2 separate rows for payment-service (one for User A, one for User B)
    const { rows: totalRepoRows } = await pool.query(
      'SELECT id, user_id FROM repositories WHERE user_id IN ($1, $2) AND provider = \'github\' AND owner = \'HitachiSystems\' AND name = \'payment-service\'',
      [userA.id, userB.id]
    );
    assert.equal(totalRepoRows.length, 2, 'Total rows for payment-service across both users must be 2');
    const userIds = totalRepoRows.map(r => r.user_id);
    assert.ok(userIds.includes(userA.id), 'User A must retain their row');
    assert.ok(userIds.includes(userB.id), 'User B must have their own row');
    console.log('✓ Test 5 Passed: User B connected same repo X -> separate row created, User A row not overwritten.');

    // ------------------------------------------------------------------------
    // Test 6: Cross-Tenant Isolation (User A cannot see User B's row & vice versa)
    // ------------------------------------------------------------------------
    console.log('[Test 6] Testing cross-tenant isolation between User A and User B...');
    
    // User A list
    const resListA = await fetch(`${baseUrl}/api/repositories`, {
      headers: { 'Cookie': `session_id=${tokenA}` }
    });
    const bodyListA = await resListA.json();
    assert.equal(bodyListA.repositories.length, 1, 'User A sees 1 repository');
    assert.equal(bodyListA.repositories[0].id, dbRowsA[0].id, 'User A sees only their own repository id');

    // User B list
    const resListB = await fetch(`${baseUrl}/api/repositories`, {
      headers: { 'Cookie': `session_id=${tokenB}` }
    });
    const bodyListB = await resListB.json();
    assert.equal(bodyListB.repositories.length, 1, 'User B sees 1 repository');
    assert.equal(bodyListB.repositories[0].id, bodyConnectB.repository.id, 'User B sees only their own repository id');
    assert.notEqual(bodyListA.repositories[0].id, bodyListB.repositories[0].id, 'Repository IDs must be distinct between users');

    // User A cannot access User B's repository by direct ID
    const userBRepoId = bodyConnectB.repository.id;
    const resCrossAccess = await fetch(`${baseUrl}/api/repositories/${userBRepoId}`, {
      headers: { 'Cookie': `session_id=${tokenA}` }
    });
    assert.equal(resCrossAccess.status, 404, 'User A must receive 404 accessing User B repository ID');
    console.log('✓ Test 6 Passed: User A and User B cannot view or access each other\'s repository records.');

    // ------------------------------------------------------------------------
    // Test 7: Inaccessible Repository Rejected (Verification Check)
    // ------------------------------------------------------------------------
    console.log('[Test 7] Testing verification against GitHub rejects inaccessible repository...');
    const resInaccessible = await fetch(`${baseUrl}/api/repositories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `session_id=${tokenA}`
      },
      body: JSON.stringify({
        owner: 'forbidden-org',
        name: 'secret-vault',
        provider: 'github'
      })
    });
    assert.equal(resInaccessible.status, 403, 'Inaccessible repository must return HTTP 403');
    console.log('✓ Test 7 Passed: Inaccessible repository correctly rejected prior to insertion.');

    // Clean up test data
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [userA.id, userB.id]);
    githubService.verifyAndGetRepository = originalVerify;
    githubService.getUserRepositories = originalGetRepos;

    console.log('\n======================================================');
    console.log('ALL CHECKPOINT 4 PER-USER REPOSITORY TESTS PASSED! (7/7)');
    console.log('======================================================\n');
  } finally {
    await stopServer();
    await closePool();
  }
}

runTests().catch((err) => {
  console.error('Repository Test Suite Failed:', err);
  process.exit(1);
});
