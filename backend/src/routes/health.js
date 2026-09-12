import express from 'express';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

export const healthRouter = express.Router();

/**
 * GET /health
 * Service Liveness Probe: Verifies Node.js process is responsive
 */
healthRouter.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'gitlab-intelligence-backend',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /ready
 * Service Readiness Probe: Verifies database connectivity and operational state
 */
healthRouter.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    return res.status(200).json({
      status: 'ready',
      db: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Database readiness check failed');

    return res.status(503).json({
      status: 'not_ready',
      db: 'disconnected',
      error: 'Database connection unavailable'
    });
  }
});
