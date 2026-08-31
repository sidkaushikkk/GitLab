import express from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import {
  generateOAuthState,
  generateSessionToken,
  hashSessionToken,
  encryptToken
} from '../utils/crypto.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

export const authRouter = express.Router();

/**
 * GET /api/auth/github
 * Initiates GitHub OAuth flow with CSRF state protection
 */
authRouter.get('/github', (req, res) => {
  if (!env.githubClientId || !env.githubClientSecret) {
    logger.warn('GitHub OAuth attempted but GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is missing');
    return res.status(500).json({
      error: {
        message: 'GitHub OAuth is not configured on this server. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.',
        status: 500
      }
    });
  }

  // Generate cryptographically random state parameter
  const state = generateOAuthState();

  // Store state in a short-lived HTTP-only cookie (10 minutes)
  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60 * 1000
  });

  const scope = 'read:user user:email repo';
  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  githubAuthUrl.searchParams.set('client_id', env.githubClientId);
  githubAuthUrl.searchParams.set('redirect_uri', env.githubCallbackUrl);
  githubAuthUrl.searchParams.set('scope', scope);
  githubAuthUrl.searchParams.set('state', state);

  logger.info({ redirectUri: env.githubCallbackUrl }, 'Redirecting user to GitHub OAuth');
  return res.redirect(githubAuthUrl.toString());
});

/**
 * GET /api/auth/github/callback
 * Handles GitHub OAuth redirect callback, verifies state, exchanges token, and creates user session
 */
authRouter.get('/github/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const savedState = req.cookies?.oauth_state;

  // Always clear the OAuth state cookie
  res.clearCookie('oauth_state', {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/'
  });

  // Handle GitHub returned error
  if (error) {
    logger.warn({ error, error_description }, 'GitHub OAuth error received from GitHub');
    return res.status(400).json({
      error: {
        message: `GitHub authorization error: ${error_description || error}`,
        status: 400
      }
    });
  }

  // Verify CSRF state parameter
  if (!state || !savedState || state !== savedState) {
    logger.warn({ receivedState: !!state, hadSavedState: !!savedState }, 'OAuth state verification failed');
    return res.status(400).json({
      error: {
        message: 'Invalid or missing OAuth state parameter. Potential CSRF detected.',
        status: 400
      }
    });
  }

  // Verify authorization code is present
  if (!code) {
    logger.warn('OAuth callback invoked without authorization code');
    return res.status(400).json({
      error: {
        message: 'Authorization code is missing from callback.',
        status: 400
      }
    });
  }

  try {
    // 1. Exchange code for GitHub access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: env.githubClientId,
        client_secret: env.githubClientSecret,
        code,
        redirect_uri: env.githubCallbackUrl
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error || !tokenData.access_token) {
      logger.error({ error: tokenData.error, desc: tokenData.error_description }, 'Failed to exchange GitHub authorization code');
      return res.status(400).json({
        error: {
          message: `Failed to exchange authorization code: ${tokenData.error_description || tokenData.error}`,
          status: 400
        }
      });
    }

    const accessToken = tokenData.access_token;

    // 2. Fetch authenticated GitHub user profile
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'GitLab-Engineering-Platform',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!userResponse.ok) {
      logger.error({ status: userResponse.status }, 'Failed to fetch user profile from GitHub API');
      return res.status(502).json({
        error: {
          message: 'Failed to retrieve user profile from GitHub API.',
          status: 502
        }
      });
    }

    const githubUser = await userResponse.json();

    // 3. Retrieve primary email if not public in profile
    let primaryEmail = githubUser.email;
    if (!primaryEmail) {
      try {
        const emailsResponse = await fetch('https://api.github.com/user/emails', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': 'GitLab-Engineering-Platform',
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        if (emailsResponse.ok) {
          const emails = await emailsResponse.json();
          const primary = emails.find(e => e.primary) || emails[0];
          if (primary) primaryEmail = primary.email;
        }
      } catch (emailErr) {
        logger.debug({ err: emailErr.message }, 'Could not retrieve private GitHub emails');
      }
    }

    // 4. Encrypt GitHub access token at rest using AES-256-GCM
    const encryptedToken = encryptToken(accessToken, env.githubTokenEncryptionKey);

    // 5. Upsert user record into PostgreSQL
    const upsertUserQuery = `
      INSERT INTO users (
        github_id,
        login,
        name,
        avatar_url,
        email,
        github_access_token_encrypted,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (github_id) DO UPDATE SET
        login = EXCLUDED.login,
        name = EXCLUDED.name,
        avatar_url = EXCLUDED.avatar_url,
        email = EXCLUDED.email,
        github_access_token_encrypted = EXCLUDED.github_access_token_encrypted,
        updated_at = NOW()
      RETURNING id, github_id, login, name, avatar_url, email;
    `;

    const { rows: userRows } = await pool.query(upsertUserQuery, [
      githubUser.id,
      githubUser.login,
      githubUser.name || githubUser.login,
      githubUser.avatar_url,
      primaryEmail,
      encryptedToken
    ]);

    const user = userRows[0];

    // 6. Create cryptographically secure server-side session
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + env.sessionTtlMs);

    await pool.query(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, user.id, expiresAt]
    );

    // 7. Set HTTP-only session cookie
    res.cookie('session_id', sessionToken, {
      httpOnly: true,
      secure: env.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: env.sessionTtlMs
    });

    logger.info({ userId: user.id, login: user.login }, 'User authenticated successfully via GitHub OAuth');

    // 8. Redirect back to frontend
    return res.redirect(`${env.frontendUrl}/`);
  } catch (err) {
    logger.error({ err: err.message }, 'Unexpected error in GitHub OAuth callback');
    return res.status(500).json({
      error: {
        message: 'Internal server error during authentication processing.',
        status: 500
      }
    });
  }
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's profile
 */
authRouter.get('/me', requireAuth, (req, res) => {
  return res.status(200).json({
    user: req.user
  });
});

/**
 * POST /api/auth/logout
 * Destroys the server-side session and clears the session cookie
 */
authRouter.post('/logout', async (req, res) => {
  const sessionId = req.cookies?.session_id;

  if (sessionId) {
    try {
      const tokenHash = hashSessionToken(sessionId);
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
      logger.info('Session successfully revoked from database on logout');
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to delete session from database on logout');
    }
  }

  // Always clear the cookie
  res.clearCookie('session_id', {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/'
  });

  return res.status(200).json({
    status: 'ok',
    message: 'Logged out successfully'
  });
});
