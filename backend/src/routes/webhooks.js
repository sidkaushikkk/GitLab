/**
 * Webhook Receivers for GitHub and GitLab
 * Mounted at /api/webhooks
 * Provides secure signature verification, payload normalization, idempotency, and analysis triggers.
 */

import express from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { prAnalysisPipeline } from '../services/intelligence/prAnalysisPipeline.js';

export const webhooksRouter = express.Router();

// In-memory LRU-like set for tracking processed delivery IDs
const processedDeliveries = new Set();
const MAX_DELIVERY_CACHE_SIZE = 10000;

function trackDeliveryId(deliveryId) {
  if (!deliveryId) return false;
  if (processedDeliveries.has(deliveryId)) {
    return true; // Already processed
  }
  if (processedDeliveries.size >= MAX_DELIVERY_CACHE_SIZE) {
    const first = processedDeliveries.values().next().value;
    processedDeliveries.delete(first);
  }
  processedDeliveries.add(deliveryId);
  return false;
}

/**
 * Constant-time comparison helper for buffers
 */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bufB = Buffer.isBuffer(b) ? b : Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * POST /api/webhooks/github
 * Receives GitHub pull request events with HMAC-SHA256 verification.
 */
webhooksRouter.post('/github', async (req, res, next) => {
  try {
    const signature = req.headers['x-hub-signature-256'];
    const deliveryId = req.headers['x-github-delivery'];
    const eventType = req.headers['x-github-event'];

    // 1. Signature Verification
    if (!signature) {
      return res.status(401).json({
        error: {
          message: 'Missing X-Hub-Signature-256 header',
          status: 401
        }
      });
    }

    const rawBodyBuffer = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const hmac = crypto.createHmac('sha256', env.githubWebhookSecret);
    hmac.update(rawBodyBuffer);
    const expectedSignature = `sha256=${hmac.digest('hex')}`;

    if (!safeCompare(signature, expectedSignature)) {
      return res.status(401).json({
        error: {
          message: 'Invalid webhook signature',
          status: 401
        }
      });
    }

    // 2. Idempotency Guard on Delivery ID
    if (deliveryId && trackDeliveryId(deliveryId)) {
      logger.info({ deliveryId }, 'Duplicate GitHub webhook delivery ignored');
      return res.status(200).json({ message: 'Duplicate delivery ignored', deliveryId });
    }

    // 3. Filter for pull_request events
    if (eventType !== 'pull_request') {
      return res.status(200).json({ message: `Ignored event: ${eventType}` });
    }

    const payload = req.body;
    const action = payload.action;
    const supportedActions = ['opened', 'synchronize', 'reopened', 'closed'];

    if (!supportedActions.includes(action)) {
      return res.status(200).json({ message: `Ignored pull_request action: ${action}` });
    }

    // 4. Identify repository
    const repoFullName = payload.repository?.full_name;
    const providerRepoId = payload.repository?.id ? String(payload.repository.id) : null;

    if (!repoFullName) {
      return res.status(400).json({ error: { message: 'Missing repository in payload', status: 400 } });
    }

    const { rows: repoRows } = await pool.query(
      `SELECT * FROM repositories 
       WHERE lower(full_name) = lower($1) OR provider_repo_id = $2
       LIMIT 1`,
      [repoFullName, providerRepoId]
    );

    if (repoRows.length === 0) {
      logger.info({ repoFullName }, 'Received webhook for unconnected repository');
      return res.status(200).json({ message: 'Repository not connected in system' });
    }

    const repo = repoRows[0];

    // 5. Extract Normalized PR metadata
    const prNumber = payload.pull_request.number;
    const title = payload.pull_request.title || 'Untitled PR';
    const description = payload.pull_request.body || '';
    const author = payload.pull_request.user?.login || 'unknown';
    const sourceBranch = payload.pull_request.head.ref;
    const targetBranch = payload.pull_request.base.ref;
    const sourceCommitSha = payload.pull_request.head.sha;
    const targetCommitSha = payload.pull_request.base.sha;
    const isClosed = action === 'closed' || payload.pull_request.state === 'closed';
    const isMerged = payload.pull_request.merged === true;
    const prStatus = isClosed ? (isMerged ? 'merged' : 'closed') : 'open';

    // 6. Upsert PR record
    const { rows: prRows } = await pool.query(
      `INSERT INTO pull_requests (
         repository_id, pr_number, title, description, author,
         source_branch, target_branch, source_commit_sha, target_commit_sha, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (repository_id, pr_number) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         source_branch = EXCLUDED.source_branch,
         target_branch = EXCLUDED.target_branch,
         source_commit_sha = EXCLUDED.source_commit_sha,
         target_commit_sha = EXCLUDED.target_commit_sha,
         status = EXCLUDED.status,
         updated_at = NOW()
       RETURNING *`,
      [
        repo.id,
        prNumber,
        title,
        description,
        author,
        sourceBranch,
        targetBranch,
        sourceCommitSha,
        targetCommitSha,
        prStatus
      ]
    );

    const pullRequest = prRows[0];

    // If closed, do not trigger risk analysis
    if (isClosed) {
      return res.status(200).json({
        message: 'Pull request updated to closed status',
        pullRequestId: pullRequest.id,
        prNumber
      });
    }

    // 7. Trigger PR Analysis Pipeline
    const analysisResult = await prAnalysisPipeline.runAnalysis({
      pullRequestId: pullRequest.id,
      commitSha: sourceCommitSha,
      diffText: payload.diffText || '',
      baseFiles: payload.baseFiles || [],
      headFiles: payload.headFiles || []
    });

    return res.status(200).json({
      message: 'GitHub webhook processed successfully',
      pullRequestId: pullRequest.id,
      analysisId: analysisResult.id,
      status: analysisResult.status,
      riskScore: analysisResult.riskScore,
      qualityGate: analysisResult.qualityGate
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/webhooks/gitlab
 * Receives GitLab merge request events with token verification and payload normalization.
 */
webhooksRouter.post('/gitlab', async (req, res, next) => {
  try {
    const token = req.headers['x-gitlab-token'];
    const eventType = req.headers['x-gitlab-event'];

    // 1. Token Verification
    if (!token) {
      return res.status(401).json({
        error: {
          message: 'Missing X-Gitlab-Token header',
          status: 401
        }
      });
    }

    if (!safeCompare(token, env.gitlabWebhookToken)) {
      return res.status(401).json({
        error: {
          message: 'Invalid webhook token',
          status: 401
        }
      });
    }

    const payload = req.body;

    // 2. Validate Merge Request Event
    if (payload.object_kind !== 'merge_request') {
      return res.status(200).json({ message: `Ignored object_kind: ${payload.object_kind}` });
    }

    const attr = payload.object_attributes;
    if (!attr) {
      return res.status(400).json({ error: { message: 'Malformed GitLab payload', status: 400 } });
    }

    // 3. Identify Repository
    const repoPath = payload.project?.path_with_namespace || payload.project?.name;
    const { rows: repoRows } = await pool.query(
      `SELECT * FROM repositories
       WHERE lower(full_name) = lower($1) OR lower(name) = lower($1)
       LIMIT 1`,
      [repoPath]
    );

    if (repoRows.length === 0) {
      return res.status(200).json({ message: 'GitLab repository not connected in system' });
    }

    const repo = repoRows[0];

    // 4. Normalize GitLab Payload into Unified PR Event
    const prNumber = attr.iid || attr.id;
    const title = attr.title || 'Untitled MR';
    const description = attr.description || '';
    const author = payload.user?.username || 'unknown';
    const sourceBranch = attr.source_branch;
    const targetBranch = attr.target_branch;
    const sourceCommitSha = attr.last_commit?.id || attr.diff_head_sha || '0000000000000000000000000000000000000000';
    const targetCommitSha = attr.target?.id || attr.diff_base_sha || '0000000000000000000000000000000000000000';
    const action = attr.action; // 'open', 'update', 'reopen', 'close', 'merge'
    const isClosed = action === 'close' || action === 'merge' || attr.state === 'closed' || attr.state === 'merged';
    const isMerged = action === 'merge' || attr.state === 'merged';
    const prStatus = isClosed ? (isMerged ? 'merged' : 'closed') : 'open';

    // 5. Upsert PR
    const { rows: prRows } = await pool.query(
      `INSERT INTO pull_requests (
         repository_id, pr_number, title, description, author,
         source_branch, target_branch, source_commit_sha, target_commit_sha, status, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (repository_id, pr_number) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         source_branch = EXCLUDED.source_branch,
         target_branch = EXCLUDED.target_branch,
         source_commit_sha = EXCLUDED.source_commit_sha,
         target_commit_sha = EXCLUDED.target_commit_sha,
         status = EXCLUDED.status,
         updated_at = NOW()
       RETURNING *`,
      [
        repo.id,
        prNumber,
        title,
        description,
        author,
        sourceBranch,
        targetBranch,
        sourceCommitSha,
        targetCommitSha,
        prStatus
      ]
    );

    const pullRequest = prRows[0];

    if (isClosed) {
      return res.status(200).json({
        message: 'GitLab merge request updated to closed status',
        pullRequestId: pullRequest.id,
        prNumber
      });
    }

    // 6. Trigger Analysis
    const analysisResult = await prAnalysisPipeline.runAnalysis({
      pullRequestId: pullRequest.id,
      commitSha: sourceCommitSha,
      diffText: payload.diffText || '',
      baseFiles: payload.baseFiles || [],
      headFiles: payload.headFiles || []
    });

    return res.status(200).json({
      message: 'GitLab webhook processed successfully',
      pullRequestId: pullRequest.id,
      analysisId: analysisResult.id,
      status: analysisResult.status,
      riskScore: analysisResult.riskScore,
      qualityGate: analysisResult.qualityGate
    });
  } catch (err) {
    next(err);
  }
});
