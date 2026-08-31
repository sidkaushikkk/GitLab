import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { pool, closePool } from '../src/db/pool.js';
import {
  encryptToken,
  decryptToken,
  generateSessionToken,
  hashSessionToken,
  generateOAuthState
} from '../src/utils/crypto.js';
import { app } from '../src/app.js';
import http from 'node:http';

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
  console.log('--- Starting Checkpoint 3 Authentication & Security Test Suite ---');
  await startServer();

  try {
    // ------------------------------------------------------------------------
    // Test 1: AES-256-GCM Token Encryption & Decryption
    // ------------------------------------------------------------------------
    console.log('[Test 1] Testing AES-256-GCM token encryption and authentication tag validation...');
    const originalToken = 'gho_SuperSecretGitHubToken_1234567890abcdef';
    const key = env.githubTokenEncryptionKey;

    const encrypted = encryptToken(originalToken, key);
    assert.ok(encrypted.includes(':'), 'Encrypted format must contain iv:authTag:cipherText');
    const parts = encrypted.split(':');
    assert.equal(parts.length, 3, 'Must have 3 parts (IV, AuthTag, CipherText)');
    assert.notEqual(encrypted, originalToken, 'Encrypted token must not equal plaintext');

    const decrypted = decryptToken(encrypted, key);
    assert.equal(decrypted, originalToken, 'Decrypted token must match original plaintext');

    // Tampering test: modify 1 byte in ciphertext
    const tamperedCipher = parts[0] + ':' + parts[1] + ':' + (parts[2].slice(0, -2) + 'ff');
    assert.throws(
      () => decryptToken(tamperedCipher, key),
      /Unsupported state or unable to authenticate data|bad decrypt/i,
      'Tampered ciphertext must fail authentication tag verification'
    );
    console.log('✓ Test 1 Passed: AES-256-GCM encryption, decryption, and tampering detection verified.');

    // ------------------------------------------------------------------------
    // Test 2: Cryptographic Session Token Generation & Hashing
    // ------------------------------------------------------------------------
    console.log('[Test 2] Testing session token generation and SHA-256 hashing...');
    const token1 = generateSessionToken();
    const token2 = generateSessionToken();
    assert.equal(token1.length, 64, '32-byte hex token must be 64 characters');
    assert.notEqual(token1, token2, 'Generated tokens must be distinct and random');

    const hash1 = hashSessionToken(token1);
    const hash1Repeat = hashSessionToken(token1);
    assert.equal(hash1.length, 64, 'SHA-256 hash must be 64 characters');
    assert.equal(hash1, hash1Repeat, 'Hash must be deterministic');
    assert.notEqual(hash1, token1, 'Hash must not equal raw token');
    console.log('✓ Test 2 Passed: Cryptographic session token generation and hashing verified.');

    // ------------------------------------------------------------------------
    // Test 3: Unauthenticated /api/auth/me returns 401
    // ------------------------------------------------------------------------
    console.log('[Test 3] Testing unauthenticated GET /api/auth/me...');
    const resUnauth = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(resUnauth.status, 401, 'Unauthenticated request must return HTTP 401');
    const bodyUnauth = await resUnauth.json();
    assert.ok(bodyUnauth.error, 'Response must have structured error object');
    assert.equal(bodyUnauth.error.status, 401);
    console.log('✓ Test 3 Passed: Unauthenticated request rejected with HTTP 401.');

    // ------------------------------------------------------------------------
    // Test 4: OAuth CSRF State Protection
    // ------------------------------------------------------------------------
    console.log('[Test 4] Testing OAuth state verification on callback...');
    // Callback with no state
    const resNoState = await fetch(`${baseUrl}/api/auth/github/callback?code=fake_code`);
    assert.equal(resNoState.status, 400, 'Callback with missing state must return 400');

    // Callback with mismatched state
    const resMismatchedState = await fetch(`${baseUrl}/api/auth/github/callback?code=fake_code&state=mismatched_state`, {
      headers: {
        'Cookie': 'oauth_state=original_state'
      }
    });
    assert.equal(resMismatchedState.status, 400, 'Callback with mismatched state must return 400');
    const bodyMismatch = await resMismatchedState.json();
    assert.match(bodyMismatch.error.message, /CSRF|OAuth state/i, 'Error message must mention state/CSRF');
    console.log('✓ Test 4 Passed: OAuth CSRF state protection verified.');

    // ------------------------------------------------------------------------
    // Test 5: End-to-End User & Session Lifecycle in PostgreSQL
    // ------------------------------------------------------------------------
    console.log('[Test 5] Testing session creation, lookup, /me verification, and logout...');
    const testGithubId = Date.now(); // Unique github ID for test
    const testLogin = `testuser_${Date.now()}`;
    const testEncryptedToken = encryptToken('gho_test_token_987654321', key);

    // Upsert test user
    const { rows: userRows } = await pool.query(`
      INSERT INTO users (github_id, login, name, avatar_url, email, github_access_token_encrypted)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, github_id, login, name, avatar_url, email
    `, [testGithubId, testLogin, 'Test Developer', 'https://example.com/avatar.jpg', 'dev@example.com', testEncryptedToken]);

    const createdUser = userRows[0];
    assert.ok(createdUser.id, 'User record must have UUID id');

    // Create session in PostgreSQL
    const testSessionToken = generateSessionToken();
    const testTokenHash = hashSessionToken(testSessionToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await pool.query(`
      INSERT INTO sessions (token_hash, user_id, expires_at)
      VALUES ($1, $2, $3)
    `, [testTokenHash, createdUser.id, expiresAt]);

    // Test GET /api/auth/me with valid session cookie
    const resMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        'Cookie': `session_id=${testSessionToken}`
      }
    });
    assert.equal(resMe.status, 200, 'Valid session must return HTTP 200 on /api/auth/me');
    const bodyMe = await resMe.json();
    assert.ok(bodyMe.user, 'Response must contain user object');
    assert.equal(bodyMe.user.login, testLogin);
    assert.equal(bodyMe.user.email, 'dev@example.com');
    assert.equal(bodyMe.user.github_access_token_encrypted, undefined, 'Must NEVER leak encrypted token to client');
    assert.equal(bodyMe.user.token_hash, undefined, 'Must NEVER leak session hash to client');

    // Test POST /api/auth/logout
    const resLogout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Cookie': `session_id=${testSessionToken}`
      }
    });
    assert.equal(resLogout.status, 200, 'Logout must return HTTP 200');
    const setCookie = resLogout.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('session_id='), 'Logout must clear session cookie');

    // Verify session was removed from database
    const { rows: sessionCheck } = await pool.query('SELECT id FROM sessions WHERE token_hash = $1', [testTokenHash]);
    assert.equal(sessionCheck.length, 0, 'Session must be deleted from database upon logout');

    // Test GET /api/auth/me after logout -> must return 401
    const resMeAfterLogout = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        'Cookie': `session_id=${testSessionToken}`
      }
    });
    assert.equal(resMeAfterLogout.status, 401, 'Request with revoked session must return HTTP 401');
    console.log('✓ Test 5 Passed: Session lifecycle (create -> /me -> logout -> 401) fully verified.');

    // ------------------------------------------------------------------------
    // Test 6: Expired Session returns 401
    // ------------------------------------------------------------------------
    console.log('[Test 6] Testing expired session handling...');
    const expiredSessionToken = generateSessionToken();
    const expiredTokenHash = hashSessionToken(expiredSessionToken);
    const pastExpiresAt = new Date(Date.now() - 1000 * 60); // 1 minute in the past

    await pool.query(`
      INSERT INTO sessions (token_hash, user_id, expires_at)
      VALUES ($1, $2, $3)
    `, [expiredTokenHash, createdUser.id, pastExpiresAt]);

    const resExpired = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        'Cookie': `session_id=${expiredSessionToken}`
      }
    });
    assert.equal(resExpired.status, 401, 'Expired session must return HTTP 401');
    console.log('✓ Test 6 Passed: Expired session correctly rejected with HTTP 401.');

    // Clean up test user
    await pool.query('DELETE FROM users WHERE id = $1', [createdUser.id]);

    console.log('\n======================================================');
    console.log('ALL CHECKPOINT 3 TESTS PASSED SUCCESSFULLY! (6/6)');
    console.log('======================================================\n');
  } finally {
    await stopServer();
    await closePool();
  }
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
