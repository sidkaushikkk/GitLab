import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { apiReliabilityService } from '../../src/services/apiReliabilityService.js';

describe('Frontend API Reliability Service Client Integration', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('getOverview fetches and returns active API reliability payload', async () => {
    globalThis.fetch = async (url) => {
      assert.ok(url.includes('/api/repositories/repo-xyz/api-reliability'));
      return {
        ok: true,
        json: async () => ({
          repositoryId: 'repo-xyz',
          state: 'ACTIVE',
          summary: {
            total_endpoints: 12,
            reliability_score: 92.5
          },
          endpoints: [{ method: 'GET', route_path: '/api/users' }]
        })
      };
    };

    const data = await apiReliabilityService.getOverview('repo-xyz');
    assert.ok(data !== null);
    assert.equal(data.repositoryId, 'repo-xyz');
    assert.equal(data.summary.total_endpoints, 12);
    assert.equal(data.endpoints.length, 1);
  });

  it('getEndpoints fetches filtered endpoints', async () => {
    globalThis.fetch = async (url) => {
      assert.ok(url.includes('/api/repositories/repo-xyz/api-reliability/endpoints'));
      assert.ok(url.includes('method=GET'));
      return {
        ok: true,
        json: async () => ({
          repositoryId: 'repo-xyz',
          endpoints: [{ method: 'GET', route_path: '/api/items' }]
        })
      };
    };

    const endpoints = await apiReliabilityService.getEndpoints('repo-xyz', { method: 'GET' });
    assert.equal(endpoints.length, 1);
    assert.equal(endpoints[0].method, 'GET');
  });

  it('compareSnapshots calls compare endpoint with correct path', async () => {
    globalThis.fetch = async (url) => {
      assert.ok(url.includes('/api/repositories/repo-xyz/api-reliability/compare/snap-1/snap-2'));
      return {
        ok: true,
        json: async () => ({
          isBaseline: false,
          deltas: {
            endpoints: { delta: 2, addedCount: 2, removedCount: 0 }
          }
        })
      };
    };

    const diff = await apiReliabilityService.compareSnapshots('repo-xyz', 'snap-1', 'snap-2');
    assert.ok(diff !== null);
    assert.equal(diff.isBaseline, false);
    assert.equal(diff.deltas.endpoints.delta, 2);
  });
});
