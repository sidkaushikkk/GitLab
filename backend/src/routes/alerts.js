import express from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import {
  acknowledgeAlert,
  resolveAlert,
  dismissAlert,
  reopenAlert,
  assignAlert,
  addAlertComment,
  getAlertActivityTrail
} from '../services/intelligence/alertEngine.js';

export const alertsRouter = express.Router();

alertsRouter.use(requireAuth);

/**
 * Validates alert existence and tenant ownership.
 * Returns 404 to preserve privacy and prevent tenant enumeration.
 */
async function verifyAlertOwnership(alertId, userId) {
  const query = `
    SELECT a.*, r.user_id AS repo_owner_id, r.name AS repository_name, r.full_name AS repository_full_name
    FROM alerts a
    JOIN repositories r ON a.repository_id = r.id
    WHERE a.id = $1
  `;
  const { rows } = await pool.query(query, [alertId]);

  if (rows.length === 0 || rows[0].repo_owner_id !== userId) {
    const err = new Error('Alert not found or access denied.');
    err.status = 404;
    throw err;
  }

  return rows[0];
}

/**
 * GET /api/alerts/assignees
 * Lists available platform users for alert assignment
 */
alertsRouter.get('/assignees', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, login, name, avatar_url, email FROM users ORDER BY login ASC LIMIT 100'
    );
    res.json({ assignees: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/alerts
 * Lists alerts for repositories belonging to the authenticated tenant
 */
alertsRouter.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      repositoryId,
      status,
      severity,
      category,
      assignedUserId,
      limit = 50,
      offset = 0
    } = req.query;

    // If repositoryId specified, verify tenant ownership
    if (repositoryId) {
      const { rows: repoRows } = await pool.query(
        'SELECT id FROM repositories WHERE id = $1 AND user_id = $2',
        [repositoryId, userId]
      );
      if (repoRows.length === 0) {
        return res.status(404).json({
          error: {
            message: 'Repository not found or access denied.',
            status: 404
          }
        });
      }
    }

    const conditions = ['r.user_id = $1'];
    const values = [userId];
    let paramIndex = 2;

    if (repositoryId) {
      conditions.push(`a.repository_id = $${paramIndex}`);
      values.push(repositoryId);
      paramIndex++;
    }

    if (status) {
      const statuses = status.split(',').map(s => s.trim().toUpperCase());
      conditions.push(`a.status = ANY($${paramIndex})`);
      values.push(statuses);
      paramIndex++;
    }

    if (severity) {
      const severities = severity.split(',').map(s => s.trim().toUpperCase());
      conditions.push(`a.severity = ANY($${paramIndex})`);
      values.push(severities);
      paramIndex++;
    }

    if (category) {
      const categories = category.split(',').map(c => c.trim().toUpperCase());
      conditions.push(`a.category = ANY($${paramIndex})`);
      values.push(categories);
      paramIndex++;
    }

    if (assignedUserId) {
      if (assignedUserId === 'unassigned') {
        conditions.push('a.assigned_user_id IS NULL');
      } else {
        conditions.push(`a.assigned_user_id = $${paramIndex}`);
        values.push(assignedUserId);
        paramIndex++;
      }
    }

    const whereClause = conditions.join(' AND ');

    // Total count
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM alerts a
      JOIN repositories r ON a.repository_id = r.id
      WHERE ${whereClause}
    `;
    const { rows: countRows } = await pool.query(countQuery, values);
    const total = countRows[0]?.total || 0;

    // Paginated list
    const listQuery = `
      SELECT 
        a.id, a.repository_id, a.rule_id, a.category, a.severity, a.status,
        a.title, a.description, a.evidence, a.source_type, a.source_id,
        a.snapshot_id, a.pull_request_id, a.assigned_user_id, a.deduplication_key,
        a.created_at, a.acknowledged_at, a.resolved_at, a.dismissed_at, a.updated_at,
        r.name AS repository_name, r.full_name AS repository_full_name,
        u.login AS assigned_user_login, u.name AS assigned_user_name, u.avatar_url AS assigned_user_avatar
      FROM alerts a
      JOIN repositories r ON a.repository_id = r.id
      LEFT JOIN users u ON a.assigned_user_id = u.id
      WHERE ${whereClause}
      ORDER BY 
        CASE a.severity
          WHEN 'CRITICAL' THEN 1
          WHEN 'HIGH' THEN 2
          WHEN 'MEDIUM' THEN 3
          WHEN 'LOW' THEN 4
          ELSE 5
        END ASC,
        a.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    values.push(Math.min(parseInt(limit, 10) || 50, 100));
    values.push(Math.max(parseInt(offset, 10) || 0, 0));

    const { rows: alertRows } = await pool.query(listQuery, values);

    res.json({
      alerts: alertRows.map(row => ({
        id: row.id,
        repositoryId: row.repository_id,
        repositoryName: row.repository_name,
        repositoryFullName: row.repository_full_name,
        ruleId: row.rule_id,
        category: row.category,
        severity: row.severity,
        status: row.status,
        title: row.title,
        description: row.description,
        evidence: row.evidence,
        sourceType: row.source_type,
        sourceId: row.source_id,
        snapshotId: row.snapshot_id,
        pullRequestId: row.pull_request_id,
        assignedUser: row.assigned_user_id ? {
          id: row.assigned_user_id,
          login: row.assigned_user_login,
          name: row.assigned_user_name,
          avatarUrl: row.assigned_user_avatar
        } : null,
        deduplicationKey: row.deduplication_key,
        createdAt: row.created_at,
        acknowledgedAt: row.acknowledged_at,
        resolvedAt: row.resolved_at,
        dismissedAt: row.dismissed_at,
        updatedAt: row.updated_at
      })),
      total,
      limit: parseInt(limit, 10) || 50,
      offset: parseInt(offset, 10) || 0
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/alerts/:id
 * Fetches alert details, comments, and activity audit trail
 */
alertsRouter.get('/:id', async (req, res, next) => {
  try {
    const alert = await verifyAlertOwnership(req.params.id, req.user.id);

    // Fetch comments
    const { rows: comments } = await pool.query(
      `SELECT c.id, c.alert_id, c.user_id, c.content, c.created_at,
              u.login, u.name, u.avatar_url
       FROM alert_comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.alert_id = $1
       ORDER BY c.created_at ASC`,
      [alert.id]
    );

    // Fetch activity trail
    const activities = await getAlertActivityTrail(alert.id, pool);

    res.json({
      alert: {
        id: alert.id,
        repositoryId: alert.repository_id,
        repositoryName: alert.repository_name,
        repositoryFullName: alert.repository_full_name,
        ruleId: alert.rule_id,
        category: alert.category,
        severity: alert.severity,
        status: alert.status,
        title: alert.title,
        description: alert.description,
        evidence: alert.evidence,
        sourceType: alert.source_type,
        sourceId: alert.source_id,
        snapshotId: alert.snapshot_id,
        pullRequestId: alert.pull_request_id,
        assignedUserId: alert.assigned_user_id,
        deduplicationKey: alert.deduplication_key,
        createdAt: alert.created_at,
        acknowledgedAt: alert.acknowledged_at,
        resolvedAt: alert.resolved_at,
        dismissedAt: alert.dismissed_at,
        updatedAt: alert.updated_at
      },
      comments: comments.map(c => ({
        id: c.id,
        alertId: c.alert_id,
        userId: c.user_id,
        content: c.content,
        createdAt: c.created_at,
        user: {
          id: c.user_id,
          login: c.login,
          name: c.name,
          avatarUrl: c.avatar_url
        }
      })),
      activities: activities.map(a => ({
        id: a.id,
        alertId: a.alert_id,
        userId: a.user_id,
        action: a.action,
        note: a.note,
        metadata: a.metadata,
        createdAt: a.created_at,
        user: a.user_id ? {
          id: a.user_id,
          login: a.login,
          name: a.name,
          avatarUrl: a.avatar_url
        } : null
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/alerts/:id/acknowledge
 * Transitions alert status to ACKNOWLEDGED
 */
alertsRouter.post('/:id/acknowledge', async (req, res, next) => {
  try {
    const alert = await verifyAlertOwnership(req.params.id, req.user.id);
    const updated = await acknowledgeAlert(alert.id, req.user.id, req.body?.note || '', pool);
    res.json({ alert: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/alerts/:id/resolve
 * Transitions alert status to RESOLVED
 */
alertsRouter.post('/:id/resolve', async (req, res, next) => {
  try {
    const alert = await verifyAlertOwnership(req.params.id, req.user.id);
    const note = req.body?.resolutionNote || req.body?.note || '';
    const updated = await resolveAlert(alert.id, req.user.id, note, pool);
    res.json({ alert: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/alerts/:id/dismiss
 * Transitions alert status to DISMISSED
 */
alertsRouter.post('/:id/dismiss', async (req, res, next) => {
  try {
    const alert = await verifyAlertOwnership(req.params.id, req.user.id);
    const note = req.body?.dismissalReason || req.body?.note || '';
    const updated = await dismissAlert(alert.id, req.user.id, note, pool);
    res.json({ alert: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/alerts/:id/reopen
 * Transitions alert status back to OPEN
 */
alertsRouter.post('/:id/reopen', async (req, res, next) => {
  try {
    const alert = await verifyAlertOwnership(req.params.id, req.user.id);
    const note = req.body?.note || 'Alert reopened';
    const updated = await reopenAlert(alert.id, req.user.id, note, pool);
    res.json({ alert: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/alerts/:id/assign
 * Assigns or reassigns alert to a user
 */
alertsRouter.post('/:id/assign', async (req, res, next) => {
  try {
    const alert = await verifyAlertOwnership(req.params.id, req.user.id);
    const { assignedUserId, note = '' } = req.body || {};
    const updated = await assignAlert(alert.id, req.user.id, assignedUserId, note, pool);
    res.json({ alert: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/alerts/:id/comments
 * Adds a comment to an alert
 */
alertsRouter.post('/:id/comments', async (req, res, next) => {
  try {
    const alert = await verifyAlertOwnership(req.params.id, req.user.id);
    const { content } = req.body || {};
    const comment = await addAlertComment(alert.id, req.user.id, content, pool);
    res.status(201).json({ comment });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/alerts/:id/activity
 * Fetches immutable activity audit trail
 */
alertsRouter.get('/:id/activity', async (req, res, next) => {
  try {
    const alert = await verifyAlertOwnership(req.params.id, req.user.id);
    const activities = await getAlertActivityTrail(alert.id, pool);
    res.json({ activities });
  } catch (err) {
    next(err);
  }
});
