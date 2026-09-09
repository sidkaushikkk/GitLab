import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { historyService } from '../../src/services/historyService.js';
import { repositoryService } from '../../src/services/repositoryService.js';

describe('Frontend History Service & Repository Snapshots Client Integration', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('repositoryService snapshot methods', () => {
    it('getSnapshots fetches and returns snapshots list', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.includes('/api/repositories/repo-123/snapshots'));
        return {
          ok: true,
          json: async () => ({
            snapshots: [
              { id: 'snap-1', commit_sha: 'sha-1', status: 'completed' },
              { id: 'snap-2', commit_sha: 'sha-2', status: 'completed' }
            ]
          })
        };
      };

      const snaps = await repositoryService.getSnapshots('repo-123');
      assert.equal(snaps.length, 2);
      assert.equal(snaps[0].id, 'snap-1');
    });

    it('getRepositorySnapshots alias exists and delegates to getSnapshots', async () => {
      assert.equal(typeof repositoryService.getRepositorySnapshots, 'function');
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          snapshots: [{ id: 'snap-1', status: 'completed' }]
        })
      });

      const snaps = await repositoryService.getRepositorySnapshots('repo-123');
      assert.equal(snaps.length, 1);
      assert.equal(snaps[0].id, 'snap-1');
    });
  });

  describe('historyService methods', () => {
    it('getRepositoryHistory returns baseline payload when single snapshot exists', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.includes('/api/repositories/repo-abc/history'));
        return {
          ok: true,
          json: async () => ({
            repositoryId: 'repo-abc',
            snapshotCount: 1,
            state: 'BASELINE',
            message: 'Historical comparison requires at least two analyzed snapshots.',
            timeline: [
              {
                snapshotId: 'snap-base',
                commitSha: 'commit111',
                isBaseline: true,
                metrics: {
                  maintainability: 85,
                  avgComplexity: 3.2,
                  duplicationRatio: 0.04
                },
                deltas: null
              }
            ]
          })
        };
      };

      const history = await historyService.getRepositoryHistory('repo-abc');
      assert.ok(history !== null);
      assert.equal(history.state, 'BASELINE');
      assert.equal(history.snapshotCount, 1);
      assert.equal(history.timeline.length, 1);
      assert.equal(history.timeline[0].isBaseline, true);
    });

    it('getRepositoryHistory returns trajectory when multiple snapshots exist', async () => {
      globalThis.fetch = async (url) => {
        return {
          ok: true,
          json: async () => ({
            repositoryId: 'repo-abc',
            snapshotCount: 2,
            state: 'TRAJECTORY_AVAILABLE',
            timeline: [
              { snapshotId: 'snap-1', commitSha: 'sha1', isBaseline: true },
              { snapshotId: 'snap-2', commitSha: 'sha2', isBaseline: false, deltas: { maintainabilityDelta: { percentageDelta: 5 } } }
            ]
          })
        };
      };

      const history = await historyService.getRepositoryHistory('repo-abc');
      assert.equal(history.state, 'TRAJECTORY_AVAILABLE');
      assert.equal(history.snapshotCount, 2);
    });

    it('compareSnapshots sends request to compare endpoint', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.includes('/api/repositories/repo-abc/history/compare/snap-1/snap-2'));
        return {
          ok: true,
          json: async () => ({
            baseSnapshot: { id: 'snap-1' },
            targetSnapshot: { id: 'snap-2' },
            deltas: {
              codeQuality: {
                maintainabilityDelta: { percentageDelta: -2.5 }
              }
            }
          })
        };
      };

      const comparison = await historyService.compareSnapshots('repo-abc', 'snap-1', 'snap-2');
      assert.ok(comparison !== null);
      assert.equal(comparison.baseSnapshot.id, 'snap-1');
      assert.equal(comparison.targetSnapshot.id, 'snap-2');
    });
  });
});
