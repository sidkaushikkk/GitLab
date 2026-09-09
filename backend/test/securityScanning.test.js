import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { pool, closePool } from '../src/db/pool.js';
import {
  encryptToken,
  generateSessionToken,
  hashSessionToken
} from '../src/utils/crypto.js';
import { app } from '../src/app.js';
import { scanSnapshotSecurity } from '../src/services/intelligence/vulnerabilityMatcher.js';
import { queryVulnerabilitiesForPackages } from '../src/services/intelligence/osvClient.js';

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

test('Security Scanning Pipeline and REST APIs', async (t) => {
  await startServer();

  // Save original fetch
  const originalFetch = globalThis.fetch;

  // Intercept fetch for OSV calls while letting localhost test calls through
  globalThis.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes('api.osv.dev')) {
      // Return mocked OSV response
      if (urlStr.includes('querybatch')) {
        const body = JSON.parse(options.body);
        const results = body.queries.map(q => {
          if (q.package?.name === 'lodash' && q.version === '4.17.15') {
            return {
              vulns: [
                {
                  id: 'GHSA-p6mc-m468-83gw',
                  summary: 'Prototype Pollution in lodash',
                  details: 'Prototype pollution vulnerability in lodash before 4.17.21.',
                  aliases: ['CVE-2020-8203'],
                  modified: '2021-05-24T18:00:00Z',
                  published: '2020-07-15T17:00:00Z',
                  severity: [
                    {
                      type: 'CVSS_V3',
                      score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'
                    }
                  ],
                  affected: [
                    {
                      package: { name: 'lodash', ecosystem: 'npm' },
                      ranges: [
                        {
                          type: 'SEMVER',
                          events: [
                            { introduced: '0' },
                            { fixed: '4.17.21' }
                          ]
                        }
                      ],
                      database_specific: {
                        severity: 'CRITICAL',
                        cvss: { score: 9.8, vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }
                      }
                    }
                  ],
                  references: [
                    { type: 'ADVISORY', url: 'https://nvd.nist.gov/vuln/detail/CVE-2020-8203' }
                  ]
                }
              ]
            };
          }
          return { vulns: [] };
        });
        return new Response(JSON.stringify({ results }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    return originalFetch(url, options);
  };

  try {
    // Setup test users & sessions
    const key = env.githubTokenEncryptionKey;
    const testToken = encryptToken('gho_test_sec_token', key);

    const now = Date.now();
    const { rows: uRowsA } = await pool.query(`
      INSERT INTO users (github_id, login, name, avatar_url, email, github_access_token_encrypted)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, login
    `, [now + 1, `sec_user_a_${now}`, 'User A', 'https://example.com/a.png', 'a@example.com', testToken]);
    const userA = uRowsA[0];

    const { rows: uRowsB } = await pool.query(`
      INSERT INTO users (github_id, login, name, avatar_url, email, github_access_token_encrypted)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, login
    `, [now + 2, `sec_user_b_${now}`, 'User B', 'https://example.com/b.png', 'b@example.com', testToken]);
    const userB = uRowsB[0];

    // Sessions
    const sessionTokenA = generateSessionToken();
    const sessionHashA = hashSessionToken(sessionTokenA);
    await pool.query(`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '2 hours')
    `, [userA.id, sessionHashA]);

    const sessionTokenB = generateSessionToken();
    const sessionHashB = hashSessionToken(sessionTokenB);
    await pool.query(`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '2 hours')
    `, [userB.id, sessionHashB]);

    const cookieA = `session_id=${sessionTokenA}`;
    const cookieB = `session_id=${sessionTokenB}`;

    // Create test repository for User A
    const { rows: repoRows } = await pool.query(`
      INSERT INTO repositories (
        user_id, provider, owner, name, full_name,
        default_branch, private
      ) VALUES ($1, 'github', $2, $3, $4, 'main', false)
      RETURNING id
    `, [
      userA.id,
      userA.login,
      `sec-repo-${now}`,
      `${userA.login}/sec-repo-${now}`
    ]);
    const repoA = repoRows[0];

    // Create test snapshot for Repo A
    const { rows: snapRows } = await pool.query(`
      INSERT INTO repository_snapshots (
        repository_id, commit_sha, branch, status
      ) VALUES ($1, $2, $3, 'completed')
      RETURNING id
    `, [repoA.id, 'abcdef1234567890abcdef1234567890abcdef12', 'main']);
    const snapshotA = snapRows[0];

    // Insert test dependencies
    await pool.query(`
      INSERT INTO snapshot_dependencies (
        snapshot_id, repository_id, ecosystem, package_name, normalized_name,
        version, is_direct, dependency_type, depth, parent_package, source_file
      ) VALUES
        ($1, $2, 'npm', 'lodash', 'lodash', '4.17.15', true, 'production', 1, '', 'package-lock.json'),
        ($1, $2, 'npm', 'express', 'express', '4.19.2', true, 'production', 1, '', 'package-lock.json'),
        ($1, $2, 'npm', 'safe-buffer', 'safe-buffer', '5.2.1', false, 'production', 2, 'express', 'package-lock.json')
    `, [snapshotA.id, repoA.id]);

    await t.test('scanSnapshotSecurity executes scan, caches advisories, and stores findings', async () => {
      const scanSummary = await scanSnapshotSecurity(snapshotA.id, repoA.id, {}, pool);

      assert.equal(scanSummary.status, 'completed');
      assert.equal(scanSummary.total_dependencies, 3);
      assert.equal(scanSummary.vulnerable_packages, 1);
      assert.equal(scanSummary.total_vulnerabilities, 1);
      assert.equal(scanSummary.critical_count, 1);
      assert.equal(scanSummary.high_count, 0);
      assert.equal(scanSummary.security_score, 80); // 100 - 20 (1 critical)

      // Verify findings persisted in snapshot_vulnerabilities
      const { rows: findings } = await pool.query(
        'SELECT * FROM snapshot_vulnerabilities WHERE snapshot_id = $1',
        [snapshotA.id]
      );
      assert.equal(findings.length, 1);
      assert.equal(findings[0].package_name, 'lodash');
      assert.equal(findings[0].canonical_id, 'CVE-2020-8203');
      assert.equal(findings[0].severity, 'CRITICAL');
      assert.equal(findings[0].cvss_score, 9.8);
      assert.match(findings[0].remediation, /Upgrade lodash to version 4.17.21 or later/);

      // Verify package_query_cache populated
      const { rows: cachedPkgs } = await pool.query(
        'SELECT * FROM package_query_cache WHERE ecosystem = $1 AND normalized_name = $2 AND version = $3',
        ['npm', 'lodash', '4.17.15']
      );
      assert.equal(cachedPkgs.length, 1);
      assert.deepEqual(cachedPkgs[0].advisory_ids, ['GHSA-p6mc-m468-83gw']);
    });

    await t.test('REST APIs: Enforce Tenant Isolation (Unauthorized User Gets 404)', async () => {
      // User B trying to access User A's repository security data
      const resUnauth = await fetch(`${baseUrl}/api/repositories/${repoA.id}/security`, {
        headers: { 'Cookie': cookieB }
      });
      assert.equal(resUnauth.status, 404, 'Unauthorized tenant must receive 404, not 403');

      const resVulnsUnauth = await fetch(`${baseUrl}/api/repositories/${repoA.id}/security/vulnerabilities`, {
        headers: { 'Cookie': cookieB }
      });
      assert.equal(resVulnsUnauth.status, 404);
    });

    await t.test('REST APIs: GET /api/repositories/:id/security returns summary and posture', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoA.id}/security`, {
        headers: { 'Cookie': cookieA }
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.posture.score, 80);
      assert.equal(data.posture.totalVulnerabilities, 1);
      assert.equal(data.posture.severityBreakdown.critical, 1);
      assert.equal(data.scan.status, 'completed');
    });

    await t.test('REST APIs: GET /api/repositories/:id/security/vulnerabilities supports filtering and pagination', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoA.id}/security/vulnerabilities?severity=CRITICAL`, {
        headers: { 'Cookie': cookieA }
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.vulnerabilities.length, 1);
      assert.equal(data.vulnerabilities[0].canonicalId, 'CVE-2020-8203');
      assert.equal(data.vulnerabilities[0].packageName, 'lodash');

      // Filter with no matches
      const resLow = await fetch(`${baseUrl}/api/repositories/${repoA.id}/security/vulnerabilities?severity=LOW`, {
        headers: { 'Cookie': cookieA }
      });
      const dataLow = await resLow.json();
      assert.equal(dataLow.vulnerabilities.length, 0);
    });

    await t.test('REST APIs: GET /api/repositories/:id/security/dependencies returns annotated dependency inventory', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoA.id}/security/dependencies`, {
        headers: { 'Cookie': cookieA }
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.dependencies.length, 3);
      const lodashDep = data.dependencies.find(d => d.name === 'lodash');
      assert.equal(lodashDep?.vulnerabilitiesCount, 1);
      assert.equal(lodashDep?.maxSeverity, 'CRITICAL');

      const safeBufferDep = data.dependencies.find(d => d.name === 'safe-buffer');
      assert.equal(safeBufferDep?.vulnerabilitiesCount, 0);
      assert.equal(safeBufferDep?.maxSeverity, null);
    });

    await t.test('REST APIs: GET /api/repositories/:id/security/trajectory returns history points', async () => {
      const res = await fetch(`${baseUrl}/api/repositories/${repoA.id}/security/trajectory`, {
        headers: { 'Cookie': cookieA }
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(Array.isArray(data.trajectory), true);
      assert.equal(data.trajectory.length, 1);
      assert.equal(data.trajectory[0].securityScore, 80);
    });

  } finally {
    globalThis.fetch = originalFetch;
    await stopServer();
    await closePool();
  }
});
