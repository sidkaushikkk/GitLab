import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { formatPullRequest, pullRequestService } from '../../src/services/pullRequestService.js';

describe('Frontend PR Intelligence: pullRequestService & Data Normalization', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('formatPullRequest', () => {
    it('returns null for falsy input', () => {
      assert.equal(formatPullRequest(null), null);
      assert.equal(formatPullRequest(undefined), null);
    });

    it('normalizes snake_case backend database rows into camelCase format', () => {
      const rawDbPr = {
        id: 'pr-uuid-1',
        repository_id: 'repo-uuid-1',
        pr_number: 42,
        title: 'Add authentication token rotation',
        description: 'Implements sliding refresh token window',
        author: 'dev-alice',
        source_branch: 'feature/auth-sliding',
        target_branch: 'main',
        source_commit_sha: '1111111111111111111111111111111111111111',
        target_commit_sha: '0000000000000000000000000000000000000000',
        status: 'OPEN',
        created_at: '2026-09-01T12:00:00Z',
        updated_at: '2026-09-02T15:30:00Z',
        latest_analysis_id: 'analysis-uuid-1',
        analysis_status: 'completed',
        risk_score: 55.5,
        risk_category: 'MEDIUM',
        quality_gate: 'WARNING',
        summary: 'PR touches 3 files. Risk: MEDIUM (56/100). Quality Gate: WARNING.'
      };

      const formatted = formatPullRequest(rawDbPr);

      assert.equal(formatted.id, 'pr-uuid-1');
      assert.equal(formatted.repositoryId, 'repo-uuid-1');
      assert.equal(formatted.prNumber, 42);
      assert.equal(formatted.title, 'Add authentication token rotation');
      assert.equal(formatted.author, 'dev-alice');
      assert.equal(formatted.sourceBranch, 'feature/auth-sliding');
      assert.equal(formatted.targetBranch, 'main');
      assert.equal(formatted.status, 'open');
      assert.equal(formatted.riskScore, 55.5);
      assert.equal(formatted.riskCategory, 'MEDIUM');
      assert.equal(formatted.qualityGate, 'WARNING');
      assert.equal(formatted.analysisSummary, 'PR touches 3 files. Risk: MEDIUM (56/100). Quality Gate: WARNING.');
    });

    it('preserves already camelCase properties returned from REST endpoints', () => {
      const apiPr = {
        id: 'pr-uuid-2',
        repositoryId: 'repo-uuid-2',
        prNumber: 99,
        title: 'Update dependencies',
        author: 'dependabot',
        sourceBranch: 'dependabot/npm_and_yarn',
        targetBranch: 'main',
        status: 'merged',
        riskScore: 12,
        riskCategory: 'LOW',
        qualityGate: 'APPROVED'
      };

      const formatted = formatPullRequest(apiPr);

      assert.equal(formatted.id, 'pr-uuid-2');
      assert.equal(formatted.prNumber, 99);
      assert.equal(formatted.status, 'merged');
      assert.equal(formatted.riskScore, 12);
      assert.equal(formatted.riskCategory, 'LOW');
      assert.equal(formatted.qualityGate, 'APPROVED');
    });
  });

  describe('pullRequestService.getPullRequests', () => {
    it('returns empty result when repositoryId is not provided', async () => {
      const result = await pullRequestService.getPullRequests(null);
      assert.deepEqual(result.pullRequests, []);
      assert.equal(result.pagination.totalCount, 0);
    });

    it('formats URL with query params and extracts response data', async () => {
      let requestedUrl;
      let requestedHeaders;

      globalThis.fetch = async (url, options) => {
        requestedUrl = url;
        requestedHeaders = options.headers;

        return {
          ok: true,
          status: 200,
          json: async () => ({
            pullRequests: [
              {
                id: 'pr-1',
                prNumber: 1,
                title: 'Initial setup',
                status: 'open',
                riskScore: 10,
                riskCategory: 'LOW',
                qualityGate: 'APPROVED'
              }
            ],
            pagination: {
              page: 1,
              perPage: 10,
              totalCount: 1,
              totalPages: 1
            }
          })
        };
      };

      const result = await pullRequestService.getPullRequests('repo-123', {
        page: 1,
        perPage: 10,
        status: 'open',
        risk: 'LOW',
        sortBy: 'risk_score',
        sortOrder: 'asc'
      });

      assert.ok(requestedUrl.includes('/api/repositories/repo-123/pulls'));
      assert.ok(requestedUrl.includes('page=1'));
      assert.ok(requestedUrl.includes('perPage=10'));
      assert.ok(requestedUrl.includes('status=open'));
      assert.ok(requestedUrl.includes('risk=LOW'));
      assert.ok(requestedUrl.includes('sortBy=risk_score'));
      assert.ok(requestedUrl.includes('sortOrder=asc'));

      assert.equal(result.pullRequests.length, 1);
      assert.equal(result.pullRequests[0].prNumber, 1);
      assert.equal(result.pullRequests[0].qualityGate, 'APPROVED');
    });

    it('applies client-side search query when provided', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          pullRequests: [
            { id: '1', prNumber: 10, title: 'Fix login issue', sourceBranch: 'fix/login', targetBranch: 'main', author: 'bob' },
            { id: '2', prNumber: 11, title: 'Add payment gateway', sourceBranch: 'feat/pay', targetBranch: 'main', author: 'alice' }
          ]
        })
      });

      const result = await pullRequestService.getPullRequests('repo-123', { search: 'payment' });
      assert.equal(result.pullRequests.length, 1);
      assert.equal(result.pullRequests[0].title, 'Add payment gateway');
    });

    it('throws descriptive error on API failure', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'Database connection failed' } })
      });

      await assert.rejects(
        () => pullRequestService.getPullRequests('repo-123'),
        /Database connection failed/
      );
    });
  });

  describe('pullRequestService.getPullRequestById', () => {
    it('throws error if repositoryId or prId is missing', async () => {
      await assert.rejects(() => pullRequestService.getPullRequestById(null, 'pr-1'), /required/);
      await assert.rejects(() => pullRequestService.getPullRequestById('repo-1', null), /required/);
    });

    it('fetches single PR with full analysis and diffs', async () => {
      let requestedUrl;
      globalThis.fetch = async (url) => {
        requestedUrl = url;
        return {
          ok: true,
          json: async () => ({
            pullRequest: {
              id: 'pr-99',
              prNumber: 99,
              title: 'Refactor AST parser'
            },
            analysis: {
              id: 'analysis-99',
              riskScore: 40,
              riskCategory: 'MEDIUM',
              qualityGate: 'WARNING',
              churnMetrics: { totalChurn: 75, additions: 50, deletions: 25 },
              blastRadius: { totalAffectedNodes: 3, affectedFiles: ['src/a.js'] },
              findings: [{ rule: 'NEW_CODE_SMELL', severity: 'WARNING', message: 'Long method' }]
            },
            diffs: [
              {
                id: 'diff-1',
                filePath: 'src/parser.js',
                changeType: 'MODIFIED',
                additions: 50,
                deletions: 25,
                patch: '@@ -1,5 +1,10 @@'
              }
            ]
          })
        };
      };

      const result = await pullRequestService.getPullRequestById('repo-xyz', 99);
      assert.equal(requestedUrl, '/api/repositories/repo-xyz/pulls/99');
      assert.equal(result.pullRequest.prNumber, 99);
      assert.equal(result.analysis.riskScore, 40);
      assert.equal(result.analysis.qualityGate, 'WARNING');
      assert.equal(result.diffs.length, 1);
      assert.equal(result.diffs[0].filePath, 'src/parser.js');
    });
  });

  describe('pullRequestService.analyzePullRequest', () => {
    it('throws error if repositoryId is missing', async () => {
      await assert.rejects(() => pullRequestService.analyzePullRequest(null, {}), /required/);
    });

    it('posts analysis payload and returns result', async () => {
      let requestedBody;
      let requestedMethod;

      globalThis.fetch = async (url, options) => {
        requestedMethod = options.method;
        requestedBody = JSON.parse(options.body);

        return {
          ok: true,
          json: async () => ({
            pullRequest: { id: 'pr-new', prNumber: 5, title: requestedBody.title },
            analysis: { id: 'an-new', riskScore: 25, qualityGate: 'APPROVED' }
          })
        };
      };

      const result = await pullRequestService.analyzePullRequest('repo-1', {
        title: 'New Feature Simulation',
        sourceBranch: 'feat/test',
        targetBranch: 'main',
        diffText: '--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@'
      });

      assert.equal(requestedMethod, 'POST');
      assert.equal(requestedBody.title, 'New Feature Simulation');
      assert.equal(result.pullRequest.title, 'New Feature Simulation');
      assert.equal(result.analysis.riskScore, 25);
    });
  });
});
