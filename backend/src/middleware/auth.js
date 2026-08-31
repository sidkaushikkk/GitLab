import { pool } from '../db/pool.js';
import { hashSessionToken } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware requiring an authenticated user session
 */
export async function requireAuth(req, res, next) {
  const sessionId = req.cookies?.session_id;

  if (!sessionId) {
    return res.status(401).json({
      error: {
        message: 'Authentication required. No session cookie provided.',
        status: 401
      }
    });
  }

  try {
    const tokenHash = hashSessionToken(sessionId);

    const query = `
      SELECT 
        s.id AS session_id,
        s.expires_at,
        s.user_id,
        u.id,
        u.github_id,
        u.login,
        u.name,
        u.avatar_url,
        u.email
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()
    `;

    const { rows } = await pool.query(query, [tokenHash]);

    if (rows.length === 0) {
      // Clear invalid or expired cookie
      res.clearCookie('session_id', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/'
      });

      return res.status(401).json({
        error: {
          message: 'Invalid or expired session.',
          status: 401
        }
      });
    }

    const row = rows[0];

    // Attach sanitized user information (never attach access tokens or hashes)
    req.user = {
      id: row.id,
      githubId: row.github_id,
      login: row.login,
      name: row.name,
      avatarUrl: row.avatar_url,
      email: row.email
    };
    req.sessionId = row.session_id;

    // Update last_seen_at timestamp asynchronously
    pool.query('UPDATE sessions SET last_seen_at = NOW() WHERE id = $1', [row.session_id]).catch((err) => {
      logger.debug({ err: err.message }, 'Failed to update session last_seen_at');
    });

    next();
  } catch (err) {
    logger.error({ err: err.message }, 'Error in requireAuth middleware');
    return res.status(500).json({
      error: {
        message: 'Internal server error during authentication',
        status: 500
      }
    });
  }
}

/**
 * Optional authentication middleware: populates req.user if a valid session exists, otherwise proceeds with req.user = null
 */
export async function optionalAuth(req, res, next) {
  const sessionId = req.cookies?.session_id;

  if (!sessionId) {
    req.user = null;
    return next();
  }

  try {
    const tokenHash = hashSessionToken(sessionId);

    const query = `
      SELECT 
        s.id AS session_id,
        s.expires_at,
        s.user_id,
        u.id,
        u.github_id,
        u.login,
        u.name,
        u.avatar_url,
        u.email
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()
    `;

    const { rows } = await pool.query(query, [tokenHash]);

    if (rows.length > 0) {
      const row = rows[0];
      req.user = {
        id: row.id,
        githubId: row.github_id,
        login: row.login,
        name: row.name,
        avatarUrl: row.avatar_url,
        email: row.email
      };
      req.sessionId = row.session_id;
    } else {
      req.user = null;
    }

    next();
  } catch (err) {
    logger.error({ err: err.message }, 'Error in optionalAuth middleware');
    req.user = null;
    next();
  }
}
