import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from backend root or workspace root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

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

  return {
    port,
    nodeEnv,
    databaseUrl,
    githubClientId,
    githubClientSecret,
    githubCallbackUrl,
    githubTokenEncryptionKey,
    sessionSecret,
    sessionTtlDays,
    sessionTtlMs,
    frontendUrl,
    isProduction: nodeEnv === 'production',
    isDevelopment: nodeEnv === 'development',
    isTest: nodeEnv === 'test'
  };
}

export const env = validateConfig();
