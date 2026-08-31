import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { decryptToken } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Retrieves and decrypts the GitHub access token for a given user
 * @param {string} userId - UUID of the user
 * @returns {Promise<string>} Decrypted plaintext access token
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
 * GitHub API client service
 */
export const githubService = {
  /**
   * Fetches the authenticated user's repositories from GitHub with pagination
   * @param {string} userId - UUID of the user
   * @param {Object} options - Pagination options
   * @param {number} [options.page=1] - Page number
   * @param {number} [options.perPage=100] - Items per page
   * @returns {Promise<Array<Object>>} Formatted repository list
   */
  async getUserRepositories(userId, { page = 1, perPage = 100 } = {}) {
    const token = await getUserDecryptedToken(userId);

    const url = new URL(`${GITHUB_API_BASE}/user/repos`);
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('direction', 'desc');
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));
    url.searchParams.set('affiliation', 'owner,collaborator,organization_member');

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'GitLab-Engineering-Platform'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        const err = new Error('GitHub access token expired or revoked. Please sign in again.');
        err.status = 401;
        throw err;
      }

      logger.error({ status: response.status, statusText: response.statusText }, 'GitHub API error fetching repositories');
      const err = new Error('Failed to fetch repositories from GitHub API');
      err.status = response.status >= 500 ? 502 : response.status;
      throw err;
    }

    const repos = await response.json();

    return repos.map(repo => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner?.login || '',
      description: repo.description || '',
      private: repo.private,
      visibility: repo.private ? 'Private' : 'Public',
      defaultBranch: repo.default_branch || 'main',
      language: repo.language || 'Unknown',
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      updatedAt: repo.updated_at
    }));
  },

  /**
   * Verifies that the user has read access to a specific GitHub repository and returns its metadata
   * @param {string} userId - UUID of the user
   * @param {string} owner - Repository owner login
   * @param {string} name - Repository name
   * @returns {Promise<Object>} Verified repository metadata
   */
  async verifyAndGetRepository(userId, owner, name) {
    const token = await getUserDecryptedToken(userId);

    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${name}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'GitLab-Engineering-Platform'
      }
    });

    if (!response.ok) {
      if (response.status === 404 || response.status === 403) {
        const err = new Error(`Repository ${owner}/${name} not found or you do not have permission to access it on GitHub.`);
        err.status = 403;
        throw err;
      }
      if (response.status === 401) {
        const err = new Error('GitHub access token expired or revoked. Please sign in again.');
        err.status = 401;
        throw err;
      }

      const err = new Error(`GitHub API returned error ${response.status} verifying repository ${owner}/${name}`);
      err.status = response.status;
      throw err;
    }

    const repo = await response.json();

    return {
      providerRepoId: repo.id,
      owner: repo.owner?.login || owner,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description || '',
      defaultBranch: repo.default_branch || 'main',
      language: repo.language || 'Unknown',
      private: repo.private,
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0
    };
  }
};
