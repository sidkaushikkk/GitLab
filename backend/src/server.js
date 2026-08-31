import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { closePool } from './db/pool.js';

const server = app.listen(env.port, () => {
  logger.info({
    port: env.port,
    environment: env.nodeEnv,
    nodeVersion: process.version
  }, `GitLab Backend API server listening on http://localhost:${env.port}`);
});

/**
 * Handle graceful shutdown
 */
async function handleShutdown(signal) {
  logger.info({ signal }, `Received ${signal}, initiating graceful shutdown...`);

  server.close(async () => {
    logger.info('HTTP server closed, draining active requests');
    await closePool();
    logger.info('Graceful shutdown completed successfully');
    process.exit(0);
  });

  // Force shutdown after timeout if pending connections hang
  setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing immediate exit');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

// Catch unhandled rejections and exceptions
process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason }, 'Unhandled Promise Rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'Uncaught Exception');
  process.exit(1);
});
