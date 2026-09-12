import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { app } from '../src/app.js';
import { pool, closePool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { validateProductionSecrets } from '../src/config/env.js';
import { createRateLimiter } from '../src/middleware/security.js';
import { codeIntelligenceService } from '../src/services/intelligence/analysisRunner.js';

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

test('Checkpoint 14: Production Hardening, Observability & Resilience', async (t) => {
  await startServer();

  try {
    // -------------------------------------------------------------
    // 1. Health & Liveness Probe (/health)
    // -------------------------------------------------------------
    await t.test('GET /health returns 200 with process liveness metrics', async () => {
      const res = await fetch(`${baseUrl}/health`);
      assert.strictEqual(res.status, 200, 'Liveness probe must return 200 OK');

      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.strictEqual(data.service, 'gitlab-intelligence-backend');
      assert.strictEqual(typeof data.uptime, 'number');
      assert.ok(data.uptime >= 0, 'Uptime must be non-negative');
      assert.ok(data.timestamp, 'Timestamp must be present');
    });

    // -------------------------------------------------------------
    // 2. Readiness Probe (/ready)
    // -------------------------------------------------------------
    await t.test('GET /ready returns 200 when database is reachable', async () => {
      const res = await fetch(`${baseUrl}/ready`);
      assert.strictEqual(res.status, 200, 'Readiness probe must return 200 OK');

      const data = await res.json();
      assert.strictEqual(data.status, 'ready');
      assert.strictEqual(data.db, 'connected');
      assert.ok(data.timestamp, 'Timestamp must be present');
    });

    // -------------------------------------------------------------
    // 3. Security Headers
    // -------------------------------------------------------------
    await t.test('HTTP responses include defense-in-depth security headers', async () => {
      const res = await fetch(`${baseUrl}/health`);

      assert.strictEqual(
        res.headers.get('x-content-type-options'),
        'nosniff',
        'X-Content-Type-Options must be nosniff'
      );
      assert.strictEqual(
        res.headers.get('x-frame-options'),
        'DENY',
        'X-Frame-Options must be DENY'
      );
      assert.strictEqual(
        res.headers.get('x-xss-protection'),
        '0',
        'X-XSS-Protection must be 0'
      );
      assert.strictEqual(
        res.headers.get('referrer-policy'),
        'strict-origin-when-cross-origin',
        'Referrer-Policy must be strict-origin-when-cross-origin'
      );
      assert.strictEqual(
        res.headers.get('x-powered-by'),
        null,
        'X-Powered-By header must be stripped'
      );
    });

    // -------------------------------------------------------------
    // 4. Request ID Tracing & Propagation
    // -------------------------------------------------------------
    await t.test('Generates X-Request-Id when missing and echoes when provided', async () => {
      // Missing header: server generates UUID
      const resGenerated = await fetch(`${baseUrl}/health`);
      const generatedId = resGenerated.headers.get('x-request-id');
      assert.ok(generatedId, 'Server must generate X-Request-Id when not provided');
      assert.match(
        generatedId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        'Generated X-Request-Id must be a valid UUID'
      );

      // Provided header: server propagates it
      const customId = 'test-trace-correlation-id-9988';
      const resPropagated = await fetch(`${baseUrl}/health`, {
        headers: { 'X-Request-Id': customId }
      });
      assert.strictEqual(
        resPropagated.headers.get('x-request-id'),
        customId,
        'Server must propagate provided X-Request-Id'
      );
    });

    // -------------------------------------------------------------
    // 5. Malformed JSON Body Protection
    // -------------------------------------------------------------
    await t.test('Malformed JSON returns 400 Bad Request with clean structured response', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: '{"malformed": "json, missing_brace'
      });

      assert.strictEqual(res.status, 400, 'Malformed JSON must yield 400');
      const data = await res.json();
      assert.ok(data.error, 'Error object must be present');
      assert.strictEqual(data.error.status, 400);
      assert.strictEqual(data.error.message, 'Malformed JSON payload in request body.');
      assert.ok(data.error.requestId, 'Error response must attach requestId');
    });

    // -------------------------------------------------------------
    // 6. Sliding-Window Rate Limiter
    // -------------------------------------------------------------
    await t.test('Rate limiter provides headers and enforces request throttling', async () => {
      // Test custom mini rate limiter
      const miniApp = express();
      miniApp.use(createRateLimiter({ windowMs: 1000, max: 3 }));
      miniApp.get('/test-limit', (req, res) => res.json({ ok: true }));

      const miniServer = miniApp.listen(0);
      const miniPort = miniServer.address().port;
      const miniUrl = `http://localhost:${miniPort}/test-limit`;

      try {
        // Request 1: OK
        const r1 = await fetch(miniUrl);
        assert.strictEqual(r1.status, 200);
        assert.strictEqual(r1.headers.get('ratelimit-limit'), '3');
        assert.strictEqual(r1.headers.get('ratelimit-remaining'), '2');

        // Request 2: OK
        const r2 = await fetch(miniUrl);
        assert.strictEqual(r2.status, 200);
        assert.strictEqual(r2.headers.get('ratelimit-remaining'), '1');

        // Request 3: OK
        const r3 = await fetch(miniUrl);
        assert.strictEqual(r3.status, 200);
        assert.strictEqual(r3.headers.get('ratelimit-remaining'), '0');

        // Request 4: Rate Limited (429)
        const r4 = await fetch(miniUrl);
        assert.strictEqual(r4.status, 429, 'Excessive request must return 429');
        const errData = await r4.json();
        assert.strictEqual(errData.error, 'TooManyRequests');
        assert.ok(r4.headers.get('retry-after'), 'Retry-After header must be provided');
      } finally {
        await new Promise((resolve) => miniServer.close(resolve));
      }
    });

    // -------------------------------------------------------------
    // 7. Production Secret Validation & Fail-Fast Safety
    // -------------------------------------------------------------
    await t.test('Production secret validation enforces cryptographic safety', () => {
      // Development mode should not throw even with defaults
      assert.doesNotThrow(() => {
        validateProductionSecrets('development', 'dev-secret', 'dummy-key');
      });

      // Production mode with insecure session secret must throw
      assert.throws(() => {
        validateProductionSecrets(
          'production',
          'gitlab_super_secret_session_key_for_development_only',
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        );
      }, /Insecure SESSION_SECRET in production/);

      // Production mode with invalid 32-byte key must throw
      assert.throws(() => {
        validateProductionSecrets(
          'production',
          'valid-and-secure-random-session-secret-key-123456',
          'short-key'
        );
      }, /Invalid GITHUB_TOKEN_ENCRYPTION_KEY/);

      // Production mode with strong secret and 64-hex-char key passes
      assert.doesNotThrow(() => {
        validateProductionSecrets(
          'production',
          'valid-and-secure-random-session-secret-key-123456',
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        );
      });
    });

    // -------------------------------------------------------------
    // 8. Database Migrations Idempotency
    // -------------------------------------------------------------
    await t.test('Database migrations apply idempotently without error', async () => {
      await assert.doesNotReject(async () => {
        await runMigrations();
      }, 'Running migrations on an already-migrated database must succeed cleanly');
    });

    // -------------------------------------------------------------
    // 9. Analysis Concurrency Protection & Stale Run Recovery
    // -------------------------------------------------------------
    await t.test('Concurrency guard prevents duplicate analysis and recovers stale runs', async () => {
      // Create test user and repository
      const userRes = await pool.query(`
        INSERT INTO users (github_id, login, name, email)
        VALUES (990099, 'hardening-user', 'Hardening User', 'hardening@example.com')
        ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login
        RETURNING id
      `);
      const userId = userRes.rows[0].id;

      const repoRes = await pool.query(`
        INSERT INTO repositories (user_id, provider, owner, name, full_name, private, default_branch)
        VALUES ($1, 'github', 'hardening-owner', 'hardening-repo', 'hardening-owner/hardening-repo', false, 'main')
        RETURNING id
      `, [userId]);
      const repoId = repoRes.rows[0].id;

      const snapRes = await pool.query(`
        INSERT INTO repository_snapshots (
          repository_id, commit_sha, branch, total_files, total_bytes, status, storage_key
        ) VALUES ($1, 'commit-hard-001', 'main', 1, 100, 'completed', 'snap-hard-001')
        RETURNING id
      `, [repoId]);
      const snapId = snapRes.rows[0].id;

      try {
        // Case A: Create an active running analysis run
        const activeRunRes = await pool.query(`
          INSERT INTO analysis_runs (
            repository_id, snapshot_id, commit_sha, status, started_at
          ) VALUES ($1, $2, 'commit-hard-001', 'running', NOW())
          RETURNING id
        `, [repoId, snapId]);
        const activeRunId = activeRunRes.rows[0].id;

        // Attempting to analyze should throw 409 Conflict
        await assert.rejects(
          async () => {
            await codeIntelligenceService.analyzeSnapshot({
              repositoryId: repoId,
              snapshotId: snapId,
              userId: userId
            });
          },
          (err) => {
            assert.strictEqual(err.status, 409, 'Must return 409 Conflict when run is active');
            assert.match(err.message, /already in progress/i);
            return true;
          }
        );

        // Case B: Convert active run to stale (>15 mins ago)
        await pool.query(`
          UPDATE analysis_runs
          SET started_at = NOW() - INTERVAL '20 minutes'
          WHERE id = $1
        `, [activeRunId]);

        // Attempting to run should now auto-recover the stale run (mark as failed)
        // Note: the run will continue to load snapshot from storage, which might throw snapshot not found,
        // but the stale run itself will have been recovered to 'failed'.
        try {
          await codeIntelligenceService.analyzeSnapshot({
            repositoryId: repoId,
            snapshotId: snapId,
            userId: userId,
            storageProvider: {
              getSnapshot: async () => ({ files: [] })
            }
          });
        } catch (err) {
          // If it fails on downstream parsing that's okay, but verify stale run was marked failed
        }

        const { rows: staleCheck } = await pool.query(
          'SELECT status, error_message FROM analysis_runs WHERE id = $1',
          [activeRunId]
        );
        assert.strictEqual(
          staleCheck[0].status,
          'failed',
          'Stale run must have been marked as failed by auto-recovery'
        );
        assert.match(
          staleCheck[0].error_message,
          /stale run auto-recovery/i,
          'Stale run error message must indicate recovery'
        );
      } finally {
        await pool.query('DELETE FROM analysis_runs WHERE repository_id = $1', [repoId]);
        await pool.query('DELETE FROM repository_snapshots WHERE repository_id = $1', [repoId]);
        await pool.query('DELETE FROM repositories WHERE id = $1', [repoId]);
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      }
    });

  } finally {
    await stopServer();
    await closePool();
  }
});
