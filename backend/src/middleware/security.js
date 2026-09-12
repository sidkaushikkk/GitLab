import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Enterprise HTTP Security Headers Middleware
 */
export function securityHeaders(req, res, next) {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking / framing
  res.setHeader('X-Frame-Options', 'DENY');

  // Modern browsers: disable legacy XSS filter in favor of CSP
  res.setHeader('X-XSS-Protection', '0');

  // Strict Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Hide server fingerprint
  res.removeHeader('X-Powered-By');

  // HSTS in production
  if (env.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

/**
 * Correlation Request ID Middleware
 */
export function requestId(req, res, next) {
  const incomingId = req.headers['x-request-id'];
  const id = (typeof incomingId === 'string' && incomingId.trim()) 
    ? incomingId.trim() 
    : crypto.randomUUID();

  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

/**
 * In-Memory Sliding Window Rate Limiter
 */
class RateLimiter {
  constructor(windowMs = 60000, maxRequests = 120) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.clients = new Map();

    // Periodic sweep of expired client buckets every minute
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [ip, data] of this.clients.entries()) {
        if (now - data.windowStart > this.windowMs) {
          this.clients.delete(ip);
        }
      }
    }, 60000).unref();
  }

  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.clients.clear();
  }

  middleware() {
    return (req, res, next) => {
      // Do not rate limit health or readiness probes
      if (req.path === '/health' || req.path === '/ready') {
        return next();
      }

      // Identify client by IP
      const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
      const now = Date.now();

      let client = this.clients.get(ip);
      if (!client || now - client.windowStart > this.windowMs) {
        client = {
          windowStart: now,
          count: 1
        };
        this.clients.set(ip, client);
      } else {
        client.count++;
      }

      const remaining = Math.max(0, this.maxRequests - client.count);
      const resetTime = Math.ceil((client.windowStart + this.windowMs - now) / 1000);

      res.setHeader('RateLimit-Limit', String(this.maxRequests));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(resetTime));

      if (client.count > this.maxRequests) {
        logger.warn({ ip, path: req.originalUrl, count: client.count }, 'Rate limit exceeded');
        res.setHeader('Retry-After', String(resetTime));
        return res.status(429).json({
          error: 'TooManyRequests',
          message: 'Too many requests, please try again later.',
          status: 429,
          retryAfter: resetTime
        });
      }

      next();
    };
  }
}

export { RateLimiter };

export function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || env.rateLimitWindowMs;
  const max = options.max || env.rateLimitMaxRequests;
  return new RateLimiter(windowMs, max).middleware();
}

export const rateLimiter = new RateLimiter(env.rateLimitWindowMs, env.rateLimitMaxRequests);

