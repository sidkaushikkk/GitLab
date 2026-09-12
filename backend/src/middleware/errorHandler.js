import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * Middleware to handle unknown/unmatched routes (404)
 */
export function notFoundHandler(req, res, next) {
  res.status(404).json({
    error: {
      message: `Cannot ${req.method} ${req.originalUrl}`,
      status: 404,
      requestId: req.id
    }
  });
}

/**
 * Centralized application error handler
 */
export function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Specific check for malformed JSON body
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    status = 400;
    message = 'Malformed JSON payload in request body.';
  }

  // Specific check for payload size limit
  if (err.type === 'entity.too.large' || status === 413) {
    status = 413;
    message = 'Request payload exceeds maximum allowed size limit.';
  }

  // Log error with full details in server logs
  logger.error({
    err: {
      message: err.message,
      stack: err.stack,
      status
    },
    req: {
      method: req.method,
      url: req.originalUrl,
      requestId: req.id,
      ip: req.ip
    }
  }, `Error in ${req.method} ${req.originalUrl}: ${message}`);

  // Build safe client response
  const response = {
    error: {
      message: status >= 500 && env.isProduction ? 'Internal Server Error' : message,
      status,
      requestId: req.id
    }
  };

  // Attach stack trace only in non-production environments
  if (!env.isProduction && err.stack) {
    response.error.stack = err.stack;
  }

  res.status(status).json(response);
}
