import express from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getUserPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeSeverity
} from '../services/intelligence/alertEngine.js';

export const notificationPreferencesRouter = express.Router();

notificationPreferencesRouter.use(requireAuth);

/**
 * GET /api/notification-preferences
 * Returns user notification preferences
 */
notificationPreferencesRouter.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const prefs = await getUserPreferences(userId, pool);
    res.json({ preferences: prefs });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/notification-preferences
 * Updates user notification preferences
 */
notificationPreferencesRouter.put('/', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const body = req.body || {};

    const email_enabled = body.email_enabled !== undefined
      ? Boolean(body.email_enabled)
      : DEFAULT_NOTIFICATION_PREFERENCES.email_enabled;
    const in_app_enabled = body.in_app_enabled !== undefined
      ? Boolean(body.in_app_enabled)
      : DEFAULT_NOTIFICATION_PREFERENCES.in_app_enabled;
    const security_alerts = body.security_alerts !== undefined
      ? Boolean(body.security_alerts)
      : DEFAULT_NOTIFICATION_PREFERENCES.security_alerts;
    const pr_risk_alerts = body.pr_risk_alerts !== undefined
      ? Boolean(body.pr_risk_alerts)
      : DEFAULT_NOTIFICATION_PREFERENCES.pr_risk_alerts;
    const code_health_alerts = body.code_health_alerts !== undefined
      ? Boolean(body.code_health_alerts)
      : DEFAULT_NOTIFICATION_PREFERENCES.code_health_alerts;
    const api_reliability_alerts = body.api_reliability_alerts !== undefined
      ? Boolean(body.api_reliability_alerts)
      : DEFAULT_NOTIFICATION_PREFERENCES.api_reliability_alerts;
    const dependency_alerts = body.dependency_alerts !== undefined
      ? Boolean(body.dependency_alerts)
      : DEFAULT_NOTIFICATION_PREFERENCES.dependency_alerts;
    const min_severity = normalizeSeverity(body.min_severity || DEFAULT_NOTIFICATION_PREFERENCES.min_severity);

    const query = `
      INSERT INTO user_notification_preferences (
        user_id, email_enabled, in_app_enabled, security_alerts, pr_risk_alerts,
        code_health_alerts, api_reliability_alerts, dependency_alerts, min_severity, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        email_enabled = EXCLUDED.email_enabled,
        in_app_enabled = EXCLUDED.in_app_enabled,
        security_alerts = EXCLUDED.security_alerts,
        pr_risk_alerts = EXCLUDED.pr_risk_alerts,
        code_health_alerts = EXCLUDED.code_health_alerts,
        api_reliability_alerts = EXCLUDED.api_reliability_alerts,
        dependency_alerts = EXCLUDED.dependency_alerts,
        min_severity = EXCLUDED.min_severity,
        updated_at = NOW()
      RETURNING *
    `;

    const { rows } = await pool.query(query, [
      userId,
      email_enabled,
      in_app_enabled,
      security_alerts,
      pr_risk_alerts,
      code_health_alerts,
      api_reliability_alerts,
      dependency_alerts,
      min_severity
    ]);

    res.json({ preferences: rows[0] });
  } catch (err) {
    next(err);
  }
});
