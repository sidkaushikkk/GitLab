import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

// Initialize PostgreSQL connection pool
export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// Pool error handling (idle client unexpected errors)
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

/**
 * Execute a query against the PostgreSQL pool
 * @param {string} text - SQL query string
 * @param {Array} [params] - Query parameters
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug({ query: text, duration: `${duration}ms`, rows: res.rowCount }, 'Executed DB query');
    return res;
  } catch (err) {
    const duration = Date.now() - start;
    logger.error({ query: text, duration: `${duration}ms`, err: err.message }, 'DB query error');
    throw err;
  }
}

/**
 * Gracefully close the database pool
 */
export async function closePool() {
  try {
    await pool.end();
    logger.info('PostgreSQL connection pool closed');
  } catch (err) {
    logger.error({ err: err.message }, 'Error closing PostgreSQL pool');
  }
}
