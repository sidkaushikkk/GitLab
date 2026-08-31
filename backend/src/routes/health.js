import express from 'express';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

export const healthRouter = express.Router();

/**
 * GET /health
 * Service liveness and database readiness probe
 */
healthRouter.get('/health', async (req, res) => {
  try {
    // Check PostgreSQL connection with a quick query
    await pool.query('SELECT 1');

    return res.status(200).json({
      status: 'ok',
      db: 'connected'
    });
  } catch (err) {
    // Log the actual error internally for diagnostics
    logger.error({ err: err.message }, 'Database health check probe failed');

    // Return safe, unprivileged response without leaking credentials or database internals
    return res.status(503).json({
      status: 'error',
      db: 'disconnected'
    });
  }
});
