import test from 'node:test';
import assert from 'node:assert/strict';
import {
  queryVulnerabilitiesForPackages,
  getVulnerabilityById
} from '../src/services/intelligence/osvClient.js';
import { pool, closePool } from '../src/db/pool.js';

test('OSV Client and Global Intelligence Cache', async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  let requestedQueries = [];

  globalThis.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes('api.osv.dev')) {
      fetchCallCount++;
      if (urlStr.includes('querybatch')) {
        const body = JSON.parse(options.body);
        requestedQueries.push(...body.queries);
        const results = body.queries.map(q => {
          if (q.package?.name === 'debug' && q.version === '2.6.0') {
            return {
              vulns: [
                {
                  id: 'GHSA-964v-gm82-752f',
                  summary: 'ReDoS in debug',
                  aliases: ['CVE-2017-16137'],
                  published: '2018-02-15T19:00:00Z',
                  modified: '2020-08-31T18:00:00Z',
                  severity: [
                    { type: 'CVSS_V3', score: 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L' }
                  ],
                  affected: [
                    {
                      package: { name: 'debug', ecosystem: 'npm' },
                      ranges: [
                        {
                          type: 'SEMVER',
                          events: [{ introduced: '0' }, { fixed: '2.6.9' }]
                        }
                      ]
                    }
                  ]
                }
              ]
            };
          }
          return { vulns: [] }; // Clean package
        });
        return new Response(JSON.stringify({ results }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (urlStr.includes('/vulns/GHSA-964v-gm82-752f')) {
        return new Response(JSON.stringify({
          id: 'GHSA-964v-gm82-752f',
          summary: 'ReDoS in debug',
          aliases: ['CVE-2017-16137'],
          affected: [{ package: { name: 'debug', ecosystem: 'npm' } }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return originalFetch(url, options);
  };

  try {
    await t.test('deduplicates identical package versions before querying OSV', async () => {
      fetchCallCount = 0;
      requestedQueries = [];

      const packages = [
        { ecosystem: 'npm', name: 'debug', version: '2.6.0' },
        { ecosystem: 'npm', name: 'DEBUG', version: '2.6.0' }, // Case insensitivity
        { ecosystem: 'npm', name: 'debug', version: '2.6.0' }, // Duplicate
        { ecosystem: 'npm', name: 'clean-pkg-a', version: '1.0.0' }
      ];

      // Bypass cache to force querying mock OSV
      const map = await queryVulnerabilitiesForPackages(packages, { bypassCache: true }, pool);

      // Only 2 unique package-versions should be requested
      assert.equal(requestedQueries.length, 2);
      assert.equal(map.size, 2);

      const debugVulns = map.get('npm:::debug:::2.6.0');
      assert.equal(debugVulns.length, 1);
      assert.equal(debugVulns[0].canonical_id, 'CVE-2017-16137');

      const cleanVulns = map.get('npm:::clean-pkg-a:::1.0.0');
      assert.equal(cleanVulns.length, 0);
    });

    await t.test('second query hits PostgreSQL cache and makes zero network calls', async () => {
      fetchCallCount = 0;
      requestedQueries = [];

      const packages = [
        { ecosystem: 'npm', name: 'debug', version: '2.6.0' },
        { ecosystem: 'npm', name: 'clean-pkg-a', version: '1.0.0' }
      ];

      // Normal query with caching enabled
      const map = await queryVulnerabilitiesForPackages(packages, { bypassCache: false }, pool);

      // Should be 0 network calls because both are cached
      assert.equal(fetchCallCount, 0, 'Cached packages must not trigger HTTP requests to OSV');
      assert.equal(map.get('npm:::debug:::2.6.0').length, 1);
      assert.equal(map.get('npm:::clean-pkg-a:::1.0.0').length, 0);
    });

    await t.test('getVulnerabilityById retrieves advisory from database', async () => {
      const adv = await getVulnerabilityById('CVE-2017-16137', pool);
      assert.ok(adv);
      assert.equal(adv.canonical_id, 'CVE-2017-16137');
      assert.equal(adv.package_name, 'debug');
    });

  } finally {
    globalThis.fetch = originalFetch;
    await closePool();
  }
});
