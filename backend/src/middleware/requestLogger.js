import { logger } from '../utils/logger.js';

/**
 * Express middleware for logging incoming HTTP requests and response times
 */
export function requestLogger(req, res, next) {
  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);
    const statusCode = res.statusCode;

    const logData = {
      method: req.method,
      url: req.originalUrl || req.url,
      status: statusCode,
      duration: `${durationMs}ms`,
      ip: req.ip || req.socket.remoteAddress
    };

    if (statusCode >= 500) {
      logger.error(logData, `HTTP ${req.method} ${req.originalUrl} failed`);
    } else if (statusCode >= 400) {
      logger.warn(logData, `HTTP ${req.method} ${req.originalUrl} client warning`);
    } else {
      logger.info(logData, `HTTP ${req.method} ${req.originalUrl}`);
    }
  });

  next();
}
