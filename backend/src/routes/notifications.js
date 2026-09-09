import express from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

export const notificationsRouter = express.Router();

notificationsRouter.use(requireAuth);

/**
 * GET /api/notifications/unread-count
 * Returns real-time unread notification count
 */
notificationsRouter.get('/unread-count', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false',
      [userId]
    );
    res.json({ unreadCount: rows[0]?.count || 0 });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/notifications
 * Lists in-app notifications for the authenticated user
 */
notificationsRouter.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { unreadOnly, limit = 50, offset = 0 } = req.query;

    const conditions = ['n.user_id = $1'];
    const values = [userId];
    let paramIndex = 2;

    if (unreadOnly === 'true' || unreadOnly === true) {
      conditions.push('n.is_read = false');
    }

    const whereClause = conditions.join(' AND ');

    // Unread count
    const { rows: unreadCountRows } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false',
      [userId]
    );
    const unreadCount = unreadCountRows[0]?.count || 0;

    // Total count for current filter
    const { rows: totalRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications n WHERE ${whereClause}`,
      values
    );
    const total = totalRows[0]?.count || 0;

    // Notifications list
    const query = `
      SELECT 
        n.id, n.user_id, n.alert_id, n.repository_id, n.channel, n.title, n.message,
        n.severity, n.status, n.is_read, n.read_at, n.attempted_at, n.delivered_at,
        n.failure_reason, n.created_at,
        a.category AS alert_category, a.source_type, a.source_id,
        r.name AS repository_name, r.full_name AS repository_full_name
      FROM notifications n
      LEFT JOIN alerts a ON n.alert_id = a.id
      LEFT JOIN repositories r ON n.repository_id = r.id
      WHERE ${whereClause}
      ORDER BY n.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    values.push(Math.min(parseInt(limit, 10) || 50, 100));
    values.push(Math.max(parseInt(offset, 10) || 0, 0));

    const { rows } = await pool.query(query, values);

    res.json({
      notifications: rows.map(r => ({
        id: r.id,
        userId: r.user_id,
        alertId: r.alert_id,
        repositoryId: r.repository_id,
        repositoryName: r.repository_name,
        repositoryFullName: r.repository_full_name,
        channel: r.channel,
        title: r.title,
        message: r.message,
        severity: r.severity,
        status: r.status,
        isRead: r.is_read,
        readAt: r.read_at,
        attemptedAt: r.attempted_at,
        deliveredAt: r.delivered_at,
        failureReason: r.failure_reason,
        createdAt: r.created_at,
        category: r.alert_category,
        sourceType: r.source_type,
        sourceId: r.source_id
      })),
      unreadCount,
      total,
      limit: parseInt(limit, 10) || 50,
      offset: parseInt(offset, 10) || 0
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/:id/read
 * Marks a single notification as read
 */
notificationsRouter.post('/:id/read', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `UPDATE notifications
       SET is_read = true, read_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [req.params.id, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: {
          message: 'Notification not found or access denied.',
          status: 404
        }
      });
    }

    res.json({ notification: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/read-all
 * Marks all unread notifications as read for current user
 */
notificationsRouter.post('/read-all', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { rowCount } = await pool.query(
      `UPDATE notifications
       SET is_read = true, read_at = NOW()
       WHERE user_id = $1 AND is_read = false`,
      [userId]
    );

    res.json({
      success: true,
      updatedCount: rowCount
    });
  } catch (err) {
    next(err);
  }
});
