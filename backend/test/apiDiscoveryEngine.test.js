import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRoutePath,
  isPublicRoute,
  discoverEndpointsFromFiles,
  extractContractFromHandler,
  evaluateEndpointReliability,
  calculateApiReliabilityScore,
  analyzeAndPersistApiReliabilitySync
} from '../src/services/intelligence/apiDiscoveryEngine.js';

test('API Reliability & Endpoint Discovery Engine', async (t) => {
  await t.test('normalizeRoutePath combines prefixes and handles slashes deterministically', () => {
    assert.equal(normalizeRoutePath('', '/health'), '/health');
    assert.equal(normalizeRoutePath('/api/auth', '/login'), '/api/auth/login');
    assert.equal(normalizeRoutePath('/api/auth/', '/login/'), '/api/auth/login');
    assert.equal(normalizeRoutePath('/api/repositories', '/:id/pulls'), '/api/repositories/:id/pulls');
    assert.equal(normalizeRoutePath('api', 'users'), '/api/users');
    assert.equal(normalizeRoutePath('', '/'), '/');
    assert.equal(normalizeRoutePath('/', '/'), '/');
  });

  await t.test('isPublicRoute identifies health, webhooks, and auth entrypoints', () => {
    assert.equal(isPublicRoute('/health'), true);
    assert.equal(isPublicRoute('/api/health'), true);
    assert.equal(isPublicRoute('/api/auth/login'), true);
    assert.equal(isPublicRoute('/api/auth/google'), true);
    assert.equal(isPublicRoute('/api/webhooks'), true);
    assert.equal(isPublicRoute('/api/webhooks/github'), true);

    // Protected endpoints
    assert.equal(isPublicRoute('/api/repositories'), false);
    assert.equal(isPublicRoute('/api/repositories/123/pulls'), false);
    assert.equal(isPublicRoute('/api/dashboard'), false);
    assert.equal(isPublicRoute('/api/profile'), false);
  });

  await t.test('discovers Express routes with nested router prefix resolution', () => {
    const serverJs = `
      import express from 'express';
      import authRoutes from './routes/auth.js';
      import repoRoutes from './routes/repositories.js';

      const app = express();
      app.get('/health', (req, res) => res.status(200).send('OK'));
      app.use('/api/auth', authRoutes);
      app.use('/api/repositories', repoRoutes);
    `;

    const authRoutesJs = `
      import express from 'express';
      const router = express.Router();

      router.post('/google', (req, res) => {
        const { credential } = req.body;
        res.status(200).json({ token: 'xyz' });
      });

      router.get('/me', verifyToken, async (req, res) => {
        res.status(200).json({ id: req.user.id });
      });

      export default router;
    `;

    const repoRoutesJs = `
      import express from 'express';
      const router = express.Router();

      router.get('/', requireAuth, async (req, res) => {
        const page = req.query.page;
        res.status(200).json({ repositories: [] });
      });

      router.get('/:id', requireAuth, async (req, res) => {
        const { id } = req.params;
        res.status(200).json({ id });
      });

      export default router;
    `;

    const files = [
      { path: 'src/server.js', content: serverJs, language: 'javascript' },
      { path: 'src/routes/auth.js', content: authRoutesJs, language: 'javascript' },
      { path: 'src/routes/repositories.js', content: repoRoutesJs, language: 'javascript' }
    ];

    const endpoints = discoverEndpointsFromFiles(files);

    assert.equal(endpoints.length, 5, 'Must discover all 5 distinct endpoints');

    const health = endpoints.find(e => e.routePath === '/health');
    assert.ok(health);
    assert.equal(health.method, 'GET');
    assert.equal(health.isAuthenticated, false);

    const googleAuth = endpoints.find(e => e.routePath === '/api/auth/google');
    assert.ok(googleAuth, 'Must resolve nested /api/auth/google');
    assert.equal(googleAuth.method, 'POST');
    assert.equal(googleAuth.isAuthenticated, false);
    assert.ok(googleAuth.contract.requestBody.fields.includes('credential'));

    const getMe = endpoints.find(e => e.routePath === '/api/auth/me');
    assert.ok(getMe, 'Must resolve nested /api/auth/me');
    assert.equal(getMe.method, 'GET');
    assert.equal(getMe.isAuthenticated, true);
    assert.ok(getMe.middlewareChain.includes('verifyToken'));

    const getRepos = endpoints.find(e => e.routePath === '/api/repositories');
    assert.ok(getRepos, 'Must resolve /api/repositories');
    assert.equal(getRepos.method, 'GET');
    assert.equal(getRepos.isAuthenticated, true);
    assert.ok(getRepos.contract.parameters.some(p => p.name === 'page' && p.in === 'query'));

    const getRepoById = endpoints.find(e => e.routePath === '/api/repositories/:id');
    assert.ok(getRepoById, 'Must resolve /api/repositories/:id');
    assert.equal(getRepoById.method, 'GET');
    assert.equal(getRepoById.isAuthenticated, true);
    assert.ok(getRepoById.contract.parameters.some(p => p.name === 'id' && p.in === 'path'));
  });

  await t.test('detects router-level middleware and applies to all declared routes in file', () => {
    const resumeDraftsJs = `
      import express from 'express';
      import { verifyToken } from '../controllers/authController.js';

      const router = express.Router();
      router.use(verifyToken);

      router.get('/', (req, res) => res.status(200).json([]));
      router.post('/', (req, res) => res.status(201).json({ success: true }));
      router.delete('/:id', (req, res) => res.status(204).send());

      export default router;
    `;

    const serverJs = `
      import express from 'express';
      import draftsRouter from './routes/resumeDrafts.js';
      const app = express();
      app.use('/api/drafts', draftsRouter);
    `;

    const files = [
      { path: 'src/server.js', content: serverJs, language: 'javascript' },
      { path: 'src/routes/resumeDrafts.js', content: resumeDraftsJs, language: 'javascript' }
    ];

    const endpoints = discoverEndpointsFromFiles(files);
    assert.equal(endpoints.length, 3);

    for (const ep of endpoints) {
      assert.equal(ep.isAuthenticated, true, `${ep.method} ${ep.routePath} must inherit router-level verifyToken`);
      assert.ok(ep.authMiddleware.includes('verifyToken'));
    }
  });

  await t.test('evaluates static reliability rules and detects missing auth and unhandled async', () => {
    const vulnerableCode = `
      import express from 'express';
      const router = express.Router();

      // Missing auth on mutation + unhandled async + db call without try/catch
      router.post('/api/records/create', async (req, res) => {
        const item = await db.create(req.body);
        res.status(200).json(item);
      });

      export default router;
    `;

    const files = [{ path: 'routes.js', content: vulnerableCode, language: 'javascript' }];
    const { endpoints, findings } = analyzeAndPersistApiReliabilitySync('snap-test', 'repo-test', files);

    assert.equal(endpoints.length, 1);
    const ruleIds = findings.map(f => f.ruleId);

    assert.ok(ruleIds.includes('API_MISSING_AUTH'), 'Must flag API_MISSING_AUTH for unprotected mutation');
    assert.ok(ruleIds.includes('API_UNHANDLED_ASYNC'), 'Must flag API_UNHANDLED_ASYNC for async without try/catch');
    assert.ok(ruleIds.includes('API_DATABASE_NO_ERROR_HANDLING'), 'Must flag API_DATABASE_NO_ERROR_HANDLING');

    const highSeverity = findings.filter(f => f.severity === 'HIGH');
    assert.ok(highSeverity.length >= 2, 'Must have HIGH severity findings');
  });

  await t.test('calculateApiReliabilityScore produces transparent and explainable penalty breakdown', () => {
    // 0 endpoints -> 100
    const emptyScore = calculateApiReliabilityScore([], []);
    assert.equal(emptyScore.score, 100.0);
    assert.ok(emptyScore.breakdown.note.includes('Clean baseline'));

    // Endpoints with findings
    const mockEndpoints = [
      { method: 'POST', routePath: '/api/items', isAuthenticated: false, contract: { contractCompleteness: 'PARTIAL' } },
      { method: 'GET', routePath: '/api/items', isAuthenticated: true, contract: { contractCompleteness: 'COMPLETE' } }
    ];
    const mockFindings = [
      { ruleId: 'API_MISSING_AUTH', severity: 'HIGH' },
      { ruleId: 'API_UNHANDLED_ASYNC', severity: 'HIGH' }
    ];

    const result = calculateApiReliabilityScore(mockEndpoints, mockFindings);
    assert.ok(result.score < 100.0);
    assert.equal(result.breakdown.highSeverityDeduction, 24.0); // 2 * 12
    assert.ok(result.breakdown.unauthenticatedPenalty > 0);
  });
});
