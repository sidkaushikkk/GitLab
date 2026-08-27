export const mockPullRequests = [
  {
    id: 'PR-142',
    number: 142,
    title: 'Refactor authentication service and session token revocation ring',
    author: {
      name: 'Alex Chen',
      handle: 'alex.chen',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces'
    },
    repositoryId: 'payment-service',
    sourceBranch: 'feature/auth-revocation-v2',
    targetBranch: 'main',
    status: 'Open',
    createdAt: '2026-08-21T10:15:00Z',
    updatedAt: '2026-08-21T13:05:00Z',
    riskLevel: 'HIGH',
    riskScore: 84,
    summary: 'Large authentication refactor affecting 6 dependent modules, introducing atomic Redis pipelining for token invalidation and OAuth PKCE verifications.',
    metrics: {
      filesChanged: 8,
      linesAdded: 384,
      linesRemoved: 142,
      dependenciesAffected: 4,
      apisAffected: 6
    },
    aiReview: {
      verdict: 'Changes Request - High Risk Identified',
      summary: 'Automated analysis identified 1 race condition risk, 1 memory leak hazard in Redis subscriber pool, and 2 missing permission validations on session cleanup endpoints.',
      findings: [
        {
          id: 'ai-f-1',
          type: 'RACE_CONDITION',
          severity: 'HIGH',
          file: 'src/auth/session.ts',
          line: 84,
          title: 'Possible race condition during concurrent session invalidation',
          explanation: 'When multiple parallel requests call revokeAllSessions(), Redis key deletion and DB session status update are executed in separate non-atomic calls. A concurrent incoming request between line 84 and line 89 can validate an already-revoked session token.',
          suggestedFix: 'Wrap both Redis pipeline revocation and PostgreSQL session state transition inside an atomic distributed lock or Redis Lua script.'
        },
        {
          id: 'ai-f-2',
          type: 'SECURITY_VALIDATION',
          severity: 'MEDIUM',
          file: 'src/controllers/AuthController.ts',
          line: 122,
          title: 'Missing CSRF verification on token refresh route',
          explanation: 'The new /auth/refresh endpoint relies solely on HttpOnly cookie without checking the X-CSRF-Token header, opening cross-origin iframe refresh vectors.',
          suggestedFix: 'Add the requireCsrfProtection middleware before the refresh handler execution chain.'
        }
      ]
    },
    impactAnalysis: {
      affectedModules: [
        { name: 'AuthService', path: 'src/auth/AuthService.ts', impact: 'Direct Modification' },
        { name: 'PaymentRouter', path: 'src/api/payment.ts', impact: 'Depends on Session Validator' },
        { name: 'LedgerSettlement', path: 'src/services/LedgerSettlement.ts', impact: 'Depends on Tenant Auth Context' },
        { name: 'WebhookController', path: 'src/controllers/WebhookController.ts', impact: 'Shared Cryptographic Helper' }
      ],
      affectedApis: [
        { method: 'POST', path: '/api/auth/login', status: 'Modified' },
        { method: 'POST', path: '/api/auth/logout', status: 'Modified' },
        { method: 'POST', path: '/api/auth/refresh', status: 'Added' },
        { method: 'POST', path: '/api/payments/charge', status: 'Downstream Auth Checked' }
      ],
      affectedDependencies: [
        { name: 'ioredis', current: '5.3.2', status: 'New pipeline usage' },
        { name: 'jsonwebtoken', current: '9.0.2', status: 'Algorithm restricted' }
      ]
    },
    changedFiles: [
      {
        path: 'src/auth/AuthService.ts',
        additions: 124,
        deletions: 48,
        status: 'modified',
        diff: `@@ -45,18 +45,32 @@ export class AuthService {
   private redis: Redis;
   private db: Knex;
 
-  public async revokeToken(token: string): Promise<boolean> {
-    await this.redis.set(\`blacklist:\${token}\`, '1', 'EX', 3600);
-    return true;
-  }
+  public async revokeToken(token: string, userId: string): Promise<boolean> {
+    const pipeline = this.redis.pipeline();
+    pipeline.set(\`blacklist:\${token}\`, '1', 'EX', 86400);
+    pipeline.sadd(\`user_revoked_tokens:\${userId}\`, token);
+    pipeline.expire(\`user_revoked_tokens:\${userId}\`, 86400);
+    await pipeline.exec();
+    
+    await this.db('user_sessions')
+      .where({ token_hash: sha256(token) })
+      .update({ revoked_at: this.db.fn.now() });
+    return true;
+  }`
      },
      {
        path: 'src/auth/session.ts',
        additions: 92,
        deletions: 28,
        status: 'modified',
        diff: `@@ -78,14 +78,22 @@ export async function revokeAllSessions(userId: string): Promise<void> {
   const activeSessions = await db('user_sessions')
     .where({ user_id: userId, revoked_at: null })
     .select('token_hash');
 
-  for (const session of activeSessions) {
-    await redis.del(\`session:\${session.token_hash}\`);
-  }
+  // WARNING: Non-atomic execution flagged by GitLab AI Review
+  const pipeline = redis.pipeline();
+  for (const session of activeSessions) {
+    pipeline.del(\`session:\${session.token_hash}\`);
+  }
+  await pipeline.exec(); // Line 84: Race condition between Redis del and DB update
+
+  await db('user_sessions')
+    .where({ user_id: userId })
+    .update({ revoked_at: new Date() });
 }`
      },
      {
        path: 'src/controllers/AuthController.ts',
        additions: 86,
        deletions: 34,
        status: 'modified',
        diff: `@@ -115,8 +115,16 @@ router.post('/login', async (req, res) => {
   res.json({ token, user });
 });
 
+router.post('/refresh', async (req, res) => {
+  const refreshToken = req.cookies.refreshToken;
+  if (!refreshToken) {
+    return res.status(401).json({ error: 'Missing refresh token' });
+  }
+  const newTokens = await authService.rotateRefreshToken(refreshToken);
+  res.json(newTokens);
+});`
      },
      {
        path: 'src/types/auth.ts',
        additions: 42,
        deletions: 12,
        status: 'modified',
        diff: `@@ -10,6 +10,12 @@ export interface UserSession {
   userId: string;
   createdAt: Date;
   expiresAt: Date;
+  revokedAt?: Date;
+  ipAddress: string;
+  userAgent: string;
+  deviceFingerprint: string;
 }`
      }
    ]
  },
  {
    id: 'PR-139',
    number: 139,
    title: 'Migrate Stripe checkout to PaymentIntents API v3',
    author: {
      name: 'Elena Rostova',
      handle: 'elena.rostova',
      avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=100&h=100&fit=crop&crop=faces'
    },
    repositoryId: 'payment-service',
    sourceBranch: 'feat/stripe-v3',
    targetBranch: 'main',
    status: 'Open',
    createdAt: '2026-08-20T14:20:00Z',
    updatedAt: '2026-08-21T09:40:00Z',
    riskLevel: 'MEDIUM',
    riskScore: 56,
    summary: 'Upgrades legacy Charges API to PaymentIntents with 3D Secure 2 authentication fallback and automated chargebacks listener.',
    metrics: {
      filesChanged: 5,
      linesAdded: 215,
      linesRemoved: 98,
      dependenciesAffected: 2,
      apisAffected: 3
    },
    aiReview: {
      verdict: 'Approved with minor suggestions',
      summary: 'Webhook idempotency handled cleanly. Recommended verifying test mock signatures for 3D Secure test cards.',
      findings: []
    },
    impactAnalysis: {
      affectedModules: [
        { name: 'StripeGateway', path: 'src/api/payment.ts', impact: 'Core Refactor' },
        { name: 'WebhookController', path: 'src/controllers/WebhookController.ts', impact: 'Webhook Signature Check' }
      ],
      affectedApis: [
        { method: 'POST', path: '/api/payments/intent', status: 'Added' },
        { method: 'POST', path: '/api/webhooks/stripe', status: 'Modified' }
      ],
      affectedDependencies: [
        { name: 'stripe', current: '14.12.0', status: 'Upgraded to 15.1.0' }
      ]
    },
    changedFiles: [
      {
        path: 'src/api/payment.ts',
        additions: 140,
        deletions: 60,
        status: 'modified',
        diff: `@@ -20,12 +20,24 @@ export async function createPayment(amount: number, currency: string) {
-  return await stripe.charges.create({ amount, currency, source: 'tok_visa' });
+  return await stripe.paymentIntents.create({
+    amount,
+    currency,
+    automatic_payment_methods: { enabled: true }
+  });
 }`
      }
    ]
  },
  {
    id: 'PR-135',
    number: 135,
    title: 'Optimize Redis connection pooling and idle socket cleanup',
    author: {
      name: 'Sam Miller',
      handle: 'sam.miller',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=faces'
    },
    repositoryId: 'payment-service',
    sourceBranch: 'perf/redis-pooling',
    targetBranch: 'main',
    status: 'Merged',
    createdAt: '2026-08-19T08:10:00Z',
    updatedAt: '2026-08-20T16:30:00Z',
    riskLevel: 'LOW',
    riskScore: 22,
    summary: 'Reduces memory leak in worker tasks by recycling idle Redis socket connections after 60s of inactivity.',
    metrics: {
      filesChanged: 2,
      linesAdded: 45,
      linesRemoved: 18,
      dependenciesAffected: 1,
      apisAffected: 0
    },
    aiReview: {
      verdict: 'Approved',
      summary: 'Safe performance enhancement with 100% test coverage and zero breaking signature changes.',
      findings: []
    },
    impactAnalysis: {
      affectedModules: [
        { name: 'RedisPool', path: 'src/database/redis.ts', impact: 'Socket Config' }
      ],
      affectedApis: [],
      affectedDependencies: []
    },
    changedFiles: []
  }
];
