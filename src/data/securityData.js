export const mockSecurityFindings = [
  {
    id: 'SEC-1082',
    severity: 'CRITICAL',
    title: 'Hardcoded secret token in database connection configuration',
    category: 'CWE-798 Hard-coded Credentials',
    file: 'src/database/connection.ts',
    line: 42,
    status: 'Open',
    detectedAt: '2026-08-21T12:40:00Z',
    author: 'devops-bot',
    whyItMatters: 'Hardcoded credentials in connection files expose database credentials to anyone with repository read access and can be committed to public logs.',
    potentialImpact: 'Full read and write compromise of the production ledger database cluster, allowing unauthorized balance tampering.',
    affectedCode: `// Line 40
export const getPoolConfig = () => ({
  host: process.env.DB_HOST || 'db.internal.hitachi.net',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: 'admin_service_rw',
  password: 'prod_hitachi_ledger_sec#9821_live', // CRITICAL: Hardcoded fallback secret
  database: 'settlement_production',
  max: 20
});`,
    suggestedRemediation: `// Fix: Fetch credential strictly through AWS Secrets Manager or Vault
export const getPoolConfig = async () => {
  const secret = await vaultClient.getSecret('database/credentials/ledger');
  return {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: secret.username,
    password: secret.password,
    database: process.env.DB_NAME,
    max: 20,
    ssl: { rejectUnauthorized: true }
  };
};`
  },
  {
    id: 'SEC-1044',
    severity: 'HIGH',
    title: 'SQL injection risk via unescaped string interpolation',
    category: 'CWE-89 SQL Injection',
    file: 'src/api/payment.ts',
    line: 108,
    status: 'Open',
    detectedAt: '2026-08-21T11:15:00Z',
    author: 'alex.chen',
    whyItMatters: 'Direct interpolation of query parameters into raw SQL query statements circumvents parameterized query validation and ORM escaping.',
    potentialImpact: 'Attacker can extract credit card token vaults, bypass authorization filters, or drop settlement transaction records.',
    affectedCode: `// Line 106
export async function findTransactionsByUser(userId: string, filter: string) {
  const query = \`SELECT * FROM transactions WHERE user_id = '\${userId}' AND status = '\${filter}'\`;
  return await db.raw(query);
}`,
    suggestedRemediation: `// Fix: Use parameterized query binding with Knex / pg pool
export async function findTransactionsByUser(userId: string, filter: string) {
  return await db('transactions')
    .where({ user_id: userId, status: filter })
    .select('*');
}`
  },
  {
    id: 'SEC-1031',
    severity: 'HIGH',
    title: 'Missing cryptographic nonce in OAuth2 session validation',
    category: 'CWE-384 Session Fixation',
    file: 'src/auth/AuthService.ts',
    line: 84,
    status: 'Open',
    detectedAt: '2026-08-21T09:20:00Z',
    author: 'elena.rostova',
    whyItMatters: 'OAuth state parameter is verified without an ephemeral Redis nonce, leaving callback endpoints open to replay attacks.',
    potentialImpact: 'Attackers can bind their OAuth session to another authenticated user and intercept financial webhooks.',
    affectedCode: `// Line 82
public async verifyOAuthCallback(state: string, code: string) {
  // Missing nonce verification in Redis cache
  const token = await this.oauthProvider.exchangeCode(code);
  return this.createSession(token.userId);
}`,
    suggestedRemediation: `// Fix: Enforce atomic Redis state & nonce deletion
public async verifyOAuthCallback(state: string, code: string) {
  const savedState = await redis.getdel(\`oauth_state:\${state}\`);
  if (!savedState) {
    throw new SecurityException('Invalid or expired OAuth state token');
  }
  const token = await this.oauthProvider.exchangeCode(code);
  return this.createSession(token.userId);
}`
  },
  {
    id: 'SEC-0988',
    severity: 'HIGH',
    title: 'Insecure direct object reference (IDOR) on refund processing endpoint',
    category: 'CWE-639 Authorization Bypass',
    file: 'src/controllers/RefundController.ts',
    line: 62,
    status: 'In Review',
    detectedAt: '2026-08-20T16:05:00Z',
    author: 'alex.chen',
    whyItMatters: 'The refund request handler accepts refundId from request path without validating organization ownership.',
    potentialImpact: 'Tenant isolation breach allowing malicious users to issue refunds on arbitrary customer orders.',
    affectedCode: `// Line 60
export async function processRefund(req: Request, res: Response) {
  const { refundId } = req.params;
  const refund = await RefundService.getById(refundId);
  return res.json(await RefundService.execute(refund));
}`,
    suggestedRemediation: `// Fix: Enforce organization scope check on every lookup
export async function processRefund(req: AuthenticatedRequest, res: Response) {
  const { refundId } = req.params;
  const refund = await RefundService.getByIdAndOrg(refundId, req.user.orgId);
  if (!refund) {
    return res.status(404).json({ error: 'Refund order not found' });
  }
  return res.json(await RefundService.execute(refund));
}`
  },
  {
    id: 'SEC-0955',
    severity: 'MEDIUM',
    title: 'Weak JWT signature algorithm fallback (none allowed in legacy parser)',
    category: 'CWE-327 Broken Crypto Algorithm',
    file: 'src/utils/crypto.ts',
    line: 55,
    status: 'Open',
    detectedAt: '2026-08-20T14:10:00Z',
    author: 'sam.miller',
    whyItMatters: 'JWT verification options do not strictly enforce algorithms: [RS256], leaving older HMAC fallback tokens vulnerable.',
    potentialImpact: 'Token forgery if attacker sends header algorithm set to none or HS256 with public key as secret.',
    affectedCode: `// Line 54
export function parseToken(rawToken: string) {
  return jwt.verify(rawToken, PUBLIC_KEY); // Defaults to permissive algorithm list
}`,
    suggestedRemediation: `// Fix: Explicitly restrict allowed algorithms
export function parseToken(rawToken: string) {
  return jwt.verify(rawToken, PUBLIC_KEY, {
    algorithms: ['RS256'],
    issuer: 'auth.hitachi.net',
    maxAge: '1h'
  });
}`
  },
  {
    id: 'SEC-0912',
    severity: 'LOW',
    title: 'Information disclosure in uncaught error handler stack trace',
    category: 'CWE-209 Info Exposure',
    file: 'src/middleware/errorHandler.ts',
    line: 28,
    status: 'Resolved',
    detectedAt: '2026-08-19T10:00:00Z',
    author: 'sam.miller',
    whyItMatters: 'Production 500 error responses return the full err.stack object in JSON payload.',
    potentialImpact: 'Exposes internal library paths, server directory structure, and environment variables.',
    affectedCode: `// Line 26
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  res.status(500).json({ message: err.message, stack: err.stack });
});`,
    suggestedRemediation: `// Fix: Strip stack traces in production environment
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error(err);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({
    message: isProd ? 'Internal server error' : err.message,
    ...(isProd ? {} : { stack: err.stack })
  });
});`
  }
];

export const mockSecurityScoreHistory = [
  { date: 'Jun 01', score: 84, critical: 3, high: 6, medium: 12 },
  { date: 'Jun 15', score: 86, critical: 2, high: 5, medium: 10 },
  { date: 'Jul 01', score: 89, critical: 2, high: 4, medium: 9 },
  { date: 'Jul 15', score: 90, critical: 1, high: 4, medium: 8 },
  { date: 'Aug 01', score: 91, critical: 1, high: 3, medium: 8 },
  { date: 'Aug 21', score: 91, critical: 1, high: 3, medium: 8 }
];
