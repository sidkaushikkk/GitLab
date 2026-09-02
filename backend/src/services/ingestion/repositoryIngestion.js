import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { githubTree } from './githubTree.js';
import { shouldIncludeFile } from './fileFilter.js';
import { fileFetcher } from './fileFetcher.js';
import { defaultStorageProvider } from './storage/LocalStorageProvider.js';

/**
 * Maps a database snapshot row into a clean JSON API object
 */
export function mapSnapshotRow(row, extra = {}) {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    commitSha: row.commit_sha,
    branch: row.branch,
    status: row.status,
    totalFiles: row.total_files,
    includedFiles: row.included_files,
    skippedFiles: row.skipped_files,
    totalBytes: parseInt(row.total_bytes, 10) || 0,
    storageKey: row.storage_key,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    ...extra
  };
}

/**
 * Service orchestrating repository ingestion and normalized snapshot generation
 */
export const ingestionService = {
  /**
   * Ingest a connected repository and produce a normalized repository snapshot
   * @param {Object} params
   * @param {string} params.repositoryId - UUID of the connected repository
   * @param {string} params.userId - UUID of the authenticated user
   * @param {string} [params.branch] - Target branch (defaults to repository's default_branch)
   * @param {number} [params.maxFileSizeBytes] - Max allowed file size in bytes
   * @param {number} [params.concurrency] - Concurrency limit for file fetching
   * @param {Object} [params.storageProvider] - Storage provider instance
   * @returns {Promise<Object>} Snapshot metadata record
   */
  async ingestRepository({
    repositoryId,
    userId,
    branch = null,
    maxFileSizeBytes = env.maxFileSizeBytes,
    concurrency = env.githubFileFetchConcurrency,
    storageProvider = defaultStorageProvider
  }) {
    // 1. Verify that repository exists and belongs to the authenticated user
    const { rows: repoRows } = await pool.query(
      'SELECT * FROM repositories WHERE id = $1 AND user_id = $2',
      [repositoryId, userId]
    );

    if (repoRows.length === 0) {
      const err = new Error('Repository not found or you do not have permission to access it.');
      err.status = 404;
      throw err;
    }

    const repo = repoRows[0];
    const targetBranch = branch || repo.default_branch || 'main';

    logger.info(
      { repositoryId: repo.id, fullName: repo.full_name, branch: targetBranch },
      'Starting repository ingestion...'
    );

    // 2. Resolve target branch to exact commit SHA
    const commitSha = await githubTree.resolveBranchCommit(userId, repo.owner, repo.name, targetBranch);
    logger.info({ repositoryId: repo.id, branch: targetBranch, commitSha }, 'Resolved commit SHA');

    // 3. Idempotency Check: Return existing completed snapshot if already generated for this commit
    const { rows: existingSnapshots } = await pool.query(
      'SELECT * FROM repository_snapshots WHERE repository_id = $1 AND commit_sha = $2 AND status = \'completed\' ORDER BY completed_at DESC LIMIT 1',
      [repo.id, commitSha]
    );

    if (existingSnapshots.length > 0) {
      logger.info(
        { repositoryId: repo.id, commitSha, snapshotId: existingSnapshots[0].id },
        'Reusing existing completed snapshot for commit (idempotent)'
      );
      return mapSnapshotRow(existingSnapshots[0], { reused: true });
    }

    // 4. Create new snapshot record in database with 'running' status
    const { rows: newSnapshotRows } = await pool.query(
      `INSERT INTO repository_snapshots (
        repository_id, commit_sha, branch, status, created_at
      ) VALUES ($1, $2, $3, 'running', NOW())
      RETURNING *`,
      [repo.id, commitSha, targetBranch]
    );

    const snapshotRecord = newSnapshotRows[0];
    const snapshotId = snapshotRecord.id;

    try {
      // 5. Fetch full recursive Git tree from GitHub
      const { tree, isTruncated } = await githubTree.getRepositoryTree(userId, repo.owner, repo.name, commitSha);

      // 6. Filter files into inclusion and exclusion lists
      const filesToFetch = [];
      const skippedFiles = [];

      for (const entry of tree) {
        if (entry.type !== 'blob') {
          // Directories (trees) are implicitly part of paths
          continue;
        }

        const filterDecision = shouldIncludeFile(entry.path, entry.size, maxFileSizeBytes);

        if (filterDecision.include) {
          filesToFetch.push({
            path: entry.path,
            sha: entry.sha,
            size: entry.size || 0,
            language: filterDecision.language,
            type: filterDecision.type
          });
        } else {
          skippedFiles.push({
            path: entry.path,
            sha: entry.sha,
            size: entry.size || 0,
            reason: filterDecision.reason
          });
        }
      }

      logger.info(
        {
          snapshotId,
          discoveredBlobs: filesToFetch.length + skippedFiles.length,
          selectedFiles: filesToFetch.length,
          skippedFiles: skippedFiles.length
        },
        'File selection filtering complete'
      );

      // 7. Fetch file contents in batches with controlled concurrency
      const { files, failedFiles, totalBytes } = await fileFetcher.fetchFilesInBatches(
        userId,
        repo.owner,
        repo.name,
        filesToFetch,
        concurrency
      );

      const allSkipped = skippedFiles.concat(failedFiles);

      // 8. Assemble normalized snapshot payload
      const snapshotPayload = {
        snapshotId,
        repository: {
          id: repo.id,
          provider: repo.provider,
          owner: repo.owner,
          name: repo.name,
          fullName: repo.full_name
        },
        source: {
          provider: repo.provider,
          branch: targetBranch,
          commitSha
        },
        metadata: {
          isTruncated,
          maxFileSizeBytes
        },
        statistics: {
          totalFilesDiscovered: files.length + allSkipped.length,
          filesIncluded: files.length,
          filesSkipped: allSkipped.length,
          totalBytes
        },
        manifest: {
          included: files.map(f => ({
            path: f.path,
            sha: f.sha,
            size: f.size,
            language: f.language,
            type: f.type,
            lineCount: f.lineCount
          })),
          skipped: allSkipped
        },
        files,
        createdAt: new Date().toISOString()
      };

      // 9. Persist snapshot payload in storage provider
      const storageKey = await storageProvider.saveSnapshot(snapshotId, snapshotPayload);

      // 10. Update database snapshot record as 'completed'
      const { rows: completedRows } = await pool.query(
        `UPDATE repository_snapshots
        SET status = 'completed',
            total_files = $1,
            included_files = $2,
            skipped_files = $3,
            total_bytes = $4,
            storage_key = $5,
            completed_at = NOW()
        WHERE id = $6
        RETURNING *`,
        [
          files.length + allSkipped.length,
          files.length,
          allSkipped.length,
          totalBytes,
          storageKey,
          snapshotId
        ]
      );

      // Update repository last_analyzed_at
      await pool.query(
        'UPDATE repositories SET last_analyzed_at = NOW(), updated_at = NOW() WHERE id = $1',
        [repo.id]
      );

      logger.info(
        {
          snapshotId,
          commitSha,
          includedFiles: files.length,
          skippedFiles: allSkipped.length,
          totalBytes
        },
        'Repository ingestion completed successfully'
      );

      return mapSnapshotRow(completedRows[0], { reused: false });
    } catch (ingestionErr) {
      logger.error(
        { snapshotId, repositoryId: repo.id, err: ingestionErr.message },
        'Repository ingestion failed'
      );

      await pool.query(
        `UPDATE repository_snapshots
        SET status = 'failed',
            error_message = $1,
            completed_at = NOW()
        WHERE id = $2`,
        [ingestionErr.message, snapshotId]
      );

      throw ingestionErr;
    }
  },

  /**
   * Retrieves snapshots for a given repository owned by the user
   */
  async getRepositorySnapshots(repositoryId, userId) {
    const { rows: repoRows } = await pool.query(
      'SELECT id FROM repositories WHERE id = $1 AND user_id = $2',
      [repositoryId, userId]
    );

    if (repoRows.length === 0) {
      const err = new Error('Repository not found or access denied.');
      err.status = 404;
      throw err;
    }

    const { rows } = await pool.query(
      'SELECT * FROM repository_snapshots WHERE repository_id = $1 ORDER BY created_at DESC',
      [repositoryId]
    );

    return rows.map(r => mapSnapshotRow(r));
  },

  /**
   * Retrieves a single snapshot metadata and optional payload
   */
  async getSnapshotById(snapshotId, userId, { includePayload = false, storageProvider = defaultStorageProvider } = {}) {
    const query = `
      SELECT s.* 
      FROM repository_snapshots s
      JOIN repositories r ON s.repository_id = r.id
      WHERE s.id = $1 AND r.user_id = $2
    `;

    const { rows } = await pool.query(query, [snapshotId, userId]);

    if (rows.length === 0) {
      const err = new Error('Snapshot not found or access denied.');
      err.status = 404;
      throw err;
    }

    const meta = mapSnapshotRow(rows[0]);

    if (includePayload && meta.status === 'completed') {
      const payload = await storageProvider.getSnapshot(snapshotId);
      return { ...meta, payload };
    }

    return meta;
  }
};
