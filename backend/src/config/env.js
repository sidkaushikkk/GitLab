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

  return {
    port,
    nodeEnv,
    databaseUrl,
    isProduction: nodeEnv === 'production',
    isDevelopment: nodeEnv === 'development',
    isTest: nodeEnv === 'test'
  };
}

export const env = validateConfig();
