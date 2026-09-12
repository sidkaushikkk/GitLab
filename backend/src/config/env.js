import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from backend root or workspace root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Validates sensitive secrets in production mode
 */
export function validateProductionSecrets(nodeEnv, sessionSecret, encryptionKey) {
  if (nodeEnv === 'production') {
    if (!sessionSecret || sessionSecret.startsWith('default-') || sessionSecret.includes('development')) {
      throw new Error('Insecure SESSION_SECRET in production: Must be explicitly set and not use default dev secrets.');
    }
    if (!encryptionKey || encryptionKey.startsWith('default-') || Buffer.byteLength(encryptionKey, 'utf8') < 32) {
      throw new Error('Invalid GITHUB_TOKEN_ENCRYPTION_KEY in production: Must be at least 32 bytes.');
    }
  }
}

/**
 * Validate and export application configuration
 */
function validateConfig() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const port = parseInt(process.env.PORT || '4000', 10);
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    const errorMsg = [
      'CRITICAL CONFIGURATION ERROR: DATABASE_URL environment variable is required.',
      'Please ensure a valid PostgreSQL connection string is provided in backend/.env',
      'Example: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gitlab_intel'
    ].join('\n');
    
    console.error(errorMsg);
    throw new Error('Missing required environment variable: DATABASE_URL');
  }

  // GitHub OAuth Configuration
  const githubClientId = process.env.GITHUB_CLIENT_ID || '';
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET || '';
  const githubCallbackUrl = process.env.GITHUB_CALLBACK_URL || `http://localhost:${port}/api/auth/github/callback`;
  
  // Encryption key for storing GitHub access tokens at rest (AES-256-GCM requires 32 bytes)
  const githubTokenEncryptionKey = process.env.GITHUB_TOKEN_ENCRYPTION_KEY || 'default-dev-encryption-key-must-be-32-chars-long!';
  
  // Session configuration
  const sessionSecret = process.env.SESSION_SECRET || 'default-dev-session-secret-change-in-prod';
  const sessionTtlDays = parseInt(process.env.SESSION_TTL_DAYS || '7', 10);
  const sessionTtlMs = sessionTtlDays * 24 * 60 * 60 * 1000;

  // Frontend URL for CORS and OAuth redirects
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  // Ingestion & Snapshot Configuration
  const maxFileSizeBytes = parseInt(process.env.MAX_FILE_SIZE_BYTES || '1000000', 10);
  const githubFileFetchConcurrency = parseInt(process.env.GITHUB_FILE_FETCH_CONCURRENCY || '5', 10);
  const storagePath = process.env.STORAGE_PATH || path.resolve(__dirname, '../../storage');

  // Webhook Secrets
  const githubWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET || 'default-github-webhook-secret-key-32chars!';
  const gitlabWebhookToken = process.env.GITLAB_WEBHOOK_TOKEN || 'default-gitlab-webhook-token-secret!';

  // Rate Limiting
  const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
  const rateLimitMaxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '120', 10);

  // Database Pool
  const dbPoolMax = parseInt(process.env.DB_POOL_MAX || '20', 10);
  const dbStatementTimeoutMs = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10);

  // Production security fail-fast assertions
  validateProductionSecrets(nodeEnv, process.env.SESSION_SECRET, process.env.GITHUB_TOKEN_ENCRYPTION_KEY);


  return {
    port,
    nodeEnv,
    databaseUrl,
    githubClientId,
    githubClientSecret,
    githubCallbackUrl,
    githubTokenEncryptionKey,
    githubWebhookSecret,
    gitlabWebhookToken,
    sessionSecret,
    sessionTtlDays,
    sessionTtlMs,
    frontendUrl,
    maxFileSizeBytes,
    githubFileFetchConcurrency,
    storagePath,
    rateLimitWindowMs,
    rateLimitMaxRequests,
    dbPoolMax,
    dbStatementTimeoutMs,
    isProduction: nodeEnv === 'production',
    isDevelopment: nodeEnv === 'development',
    isTest: nodeEnv === 'test'
  };
}

export const env = validateConfig();
