import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * Middleware to handle unknown/unmatched routes (404)
 */
export function notFoundHandler(req, res, next) {
  res.status(404).json({
    error: {
      message: `Cannot ${req.method} ${req.originalUrl}`,
      status: 404
    }
  });
}

/**
 * Centralized application error handler
 */
export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Log error with full details in server logs
  logger.error({
    err: {
      message: err.message,
      stack: err.stack,
      status
    },
    req: {
      method: req.method,
      url: req.originalUrl
    }
  }, `Unhandled error in ${req.method} ${req.originalUrl}`);

  // Build safe client response
  const response = {
    error: {
      message: status >= 500 && env.isProduction ? 'Internal Server Error' : message,
      status
    }
  };

  // Attach stack trace only in non-production environments
  if (!env.isProduction && err.stack) {
    response.error.stack = err.stack;
  }

  res.status(status).json(response);
}
