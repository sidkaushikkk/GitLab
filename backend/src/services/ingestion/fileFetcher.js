import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { decryptToken } from '../../utils/crypto.js';
import { logger } from '../../utils/logger.js';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Retrieves and decrypts user GitHub access token
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

  return decryptToken(rows[0].github_access_token_encrypted, env.githubTokenEncryptionKey);
}

/**
 * Fetches and normalizes a single blob's content from GitHub Git Data API
 */
async function fetchBlobContent(token, owner, name, blobSha) {
  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${name}/git/blobs/${blobSha}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'GitLab-Engineering-Platform'
    }
  });

  if (!response.ok) {
    const err = new Error(`Failed to fetch blob ${blobSha}: GitHub API returned ${response.status}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const rawBase64 = (data.content || '').replace(/\n/g, '');
  const decodedBuffer = Buffer.from(rawBase64, 'base64');
  let rawText = decodedBuffer.toString('utf8');

  // Normalize line endings: CRLF (\r\n) -> LF (\n)
  rawText = rawText.replace(/\r\n/g, '\n');

  // Calculate normalized line count
  const lineCount = rawText.length === 0 ? 0 : rawText.split('\n').length;
  const byteSize = Buffer.byteLength(rawText, 'utf8');

  return {
    content: rawText,
    lineCount,
    size: byteSize
  };
}

/**
 * Fetches multiple files in batches with controlled concurrency
 */
async function fetchFilesInBatches(userId, owner, name, filesToFetch, concurrency = 5) {
  const token = await getUserDecryptedToken(userId);
  const normalizedFiles = [];
  const failedFiles = [];
  let totalBytes = 0;

  let currentIndex = 0;

  async function worker() {
    while (currentIndex < filesToFetch.length) {
      const fileIndex = currentIndex++;
      const item = filesToFetch[fileIndex];

      try {
        const { content, lineCount, size } = await fileFetcher.fetchBlobContent(token, owner, name, item.sha);
        totalBytes += size;

        normalizedFiles.push({
          path: item.path,
          sha: item.sha,
          size,
          language: item.language || 'unknown',
          type: item.type || 'source',
          lineCount,
          content
        });
      } catch (err) {
        logger.warn({ path: item.path, sha: item.sha, err: err.message }, 'Failed to fetch file blob content');
        failedFiles.push({
          path: item.path,
          sha: item.sha,
          reason: 'fetch_failed',
          error: err.message
        });
      }
    }
  }

  const workerCount = Math.min(concurrency, Math.max(1, filesToFetch.length));
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  // Sort files deterministically by path
  normalizedFiles.sort((a, b) => a.path.localeCompare(b.path));

  return {
    files: normalizedFiles,
    failedFiles,
    totalBytes
  };
}

export const fileFetcher = {
  fetchBlobContent,
  fetchFilesInBatches
};
