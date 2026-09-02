import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { decryptToken } from '../../utils/crypto.js';
import { logger } from '../../utils/logger.js';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Retrieves and decrypts the GitHub access token for a given user
 */
async function getUserDecryptedToken(userId) {
  const { rows } = await pool.query(
    'SELECT github_access_token_encrypted FROM users WHERE id = $1',
    [userId]
  );

  if (rows.length === 0 || !rows[0].github_access_token_encrypted) {
    const err = new Error('No GitHub access token found for user. Please sign in again.');
    err.status = 401;
    throw err;
  }

  try {
    return decryptToken(rows[0].github_access_token_encrypted, env.githubTokenEncryptionKey);
  } catch (decryptionErr) {
    logger.error({ userId, err: decryptionErr.message }, 'Failed to decrypt stored GitHub access token');
    const err = new Error('Failed to decrypt stored credentials. Please re-authenticate.');
    err.status = 401;
    throw err;
  }
}

/**
 * Resolves a branch or ref name to an exact 40-character commit SHA
 */
async function resolveBranchCommit(userId, owner, name, branch = 'main') {
  const token = await getUserDecryptedToken(userId);

  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${name}/commits/${encodeURIComponent(branch)}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'GitLab-Engineering-Platform'
    }
  });

  if (!response.ok) {
    if (response.status === 404 || response.status === 422) {
      const err = new Error(`Branch '${branch}' not found for repository ${owner}/${name}.`);
      err.status = 404;
      throw err;
    }
    if (response.status === 401) {
      const err = new Error('GitHub access token expired or revoked. Please sign in again.');
      err.status = 401;
      throw err;
    }
    const err = new Error(`GitHub API error ${response.status} resolving branch '${branch}'.`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  if (!data.sha || typeof data.sha !== 'string') {
    throw new Error(`Failed to resolve commit SHA for ${owner}/${name} on branch ${branch}.`);
  }

  return data.sha;
}

/**
 * Fetches the recursive Git tree for a specific commit SHA
 */
async function getRepositoryTree(userId, owner, name, commitSha) {
  const token = await getUserDecryptedToken(userId);

  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${name}/git/trees/${commitSha}?recursive=1`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'GitLab-Engineering-Platform'
    }
  });

  if (!response.ok) {
    if (response.status === 404) {
      const err = new Error(`Git tree not found for commit ${commitSha} in ${owner}/${name}.`);
      err.status = 404;
      throw err;
    }
    if (response.status === 401) {
      const err = new Error('GitHub access token expired or revoked. Please sign in again.');
      err.status = 401;
      throw err;
    }
    const err = new Error(`GitHub API error ${response.status} fetching Git tree for ${commitSha}.`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const tree = Array.isArray(data.tree) ? data.tree : [];
  const isTruncated = Boolean(data.truncated);

  if (isTruncated) {
    logger.warn({ owner, name, commitSha }, 'GitHub repository tree response was truncated (exceeds GitHub single-tree limits).');
  }

  return {
    commitSha,
    tree,
    isTruncated
  };
}

export const githubTree = {
  resolveBranchCommit,
  getRepositoryTree
};
