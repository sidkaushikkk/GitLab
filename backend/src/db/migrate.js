import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, closePool } from './pool.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Ensures the migration tracking table exists
 */
async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Fetches all already applied migration names
 */
async function getAppliedMigrations(client) {
  const { rows } = await client.query('SELECT name FROM schema_migrations ORDER BY id ASC');
  return new Set(rows.map(r => r.name));
}

/**
 * Run database migrations
 */
export async function runMigrations() {
  logger.info('Starting database migration process...');

  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const appliedMigrations = await getAppliedMigrations(client);

    // Read all .sql files in migrations directory
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(file => file.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      logger.info('No migration files found.');
      return;
    }

    let newlyAppliedCount = 0;

    for (const file of files) {
      if (appliedMigrations.has(file)) {
        logger.debug({ migration: file }, 'Migration already applied, skipping');
        continue;
      }

      logger.info({ migration: file }, `Applying migration: ${file}`);
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      // Execute inside a database transaction
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info({ migration: file }, `Successfully applied migration: ${file}`);
        newlyAppliedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ migration: file, err: err.message }, `Failed to apply migration: ${file}`);
        throw err;
      }
    }

    if (newlyAppliedCount === 0) {
      logger.info('Database schema is already up to date (0 pending migrations).');
    } else {
      logger.info(`Successfully applied ${newlyAppliedCount} migration(s).`);
    }
  } finally {
    client.release();
  }
}

// Execute directly if run as a standalone script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.fatal({ err: err.message }, 'Database migration failed');
      await closePool();
      process.exit(1);
    });
}
