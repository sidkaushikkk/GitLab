import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../src/db/pool.js';
import {
  normalizeSeverity,
  shouldNotifyUser,
  evaluateSnapshotAlerts,
  evaluatePullRequestAlerts,
  acknowledgeAlert,
  resolveAlert,
  dismissAlert,
  reopenAlert,
  assignAlert,
  addAlertComment,
  getAlertActivityTrail
} from '../src/services/intelligence/alertEngine.js';

test('Alert Engine — Deterministic Rules, Deduplication & Lifecycle', async (t) => {
  let userId;
  let repoId;
  let snapshot1Id;
  let snapshot2Id;
  let pullRequestId;
  let prAnalysisId;

  await t.test('1. Severity normalization and user notification preferences', () => {
    assert.strictEqual(normalizeSeverity('CRITICAL'), 'CRITICAL');
    assert.strictEqual(normalizeSeverity('critical'), 'CRITICAL');
    assert.strictEqual(normalizeSeverity('MODERATE'), 'MEDIUM');
    assert.strictEqual(normalizeSeverity('UNKNOWN'), 'MEDIUM');

    const alertHighSec = { severity: 'HIGH', category: 'SECURITY' };
    const alertLowHealth = { severity: 'LOW', category: 'CODE_HEALTH' };

    // Default preferences allow HIGH security
    assert.strictEqual(shouldNotifyUser(alertHighSec, { min_severity: 'LOW', security_alerts: true }), true);
    // Suppressed when category disabled
    assert.strictEqual(shouldNotifyUser(alertHighSec, { min_severity: 'LOW', security_alerts: false }), false);
    // Suppressed when below min_severity
    assert.strictEqual(shouldNotifyUser(alertLowHealth, { min_severity: 'HIGH', code_health_alerts: true }), false);
    // Suppressed when in_app and email disabled
    assert.strictEqual(shouldNotifyUser(alertHighSec, { in_app_enabled: false, email_enabled: false }), false);
  });

  await t.test('2. Setup test entities in database', async () => {
    // Insert test user
    const userRes = await pool.query(`
      INSERT INTO users (github_id, login, name, email)
      VALUES (991301, 'alert-test-user', 'Alert Tester', 'alert_tester@example.com')
      ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login
      RETURNING id
    `);
    userId = userRes.rows[0].id;

    // Insert test repo
    const repoRes = await pool.query(`
      INSERT INTO repositories (name, full_name, owner, provider, user_id, default_branch)
      VALUES ('alert-test-repo', 'alert-test/repo', 'alert-test', 'github', $1, 'main')
      ON CONFLICT (user_id, provider, owner, name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [userId]);
    repoId = repoRes.rows[0].id;

    // Snapshot 1 with vulnerabilities and API findings
    const snap1Res = await pool.query(`
      INSERT INTO repository_snapshots (repository_id, commit_sha, branch, status)
      VALUES ($1, 'sha-alert-001', 'main', 'completed')
      RETURNING id
    `, [repoId]);
    snapshot1Id = snap1Res.rows[0].id;

    // Snapshot 2 (fixed snapshot)
    const snap2Res = await pool.query(`
      INSERT INTO repository_snapshots (repository_id, commit_sha, branch, status)
      VALUES ($1, 'sha-alert-002', 'main', 'completed')
      RETURNING id
    `, [repoId]);
    snapshot2Id = snap2Res.rows[0].id;

    // Add security vulnerability to snapshot 1
    await pool.query(`
      INSERT INTO snapshot_vulnerabilities (
        snapshot_id, repository_id, canonical_id, package_name, installed_version,
        severity, cvss_score, title, description, is_direct, source_file
      ) VALUES ($1, $2, 'CVE-2026-99999', 'lodash', '4.17.20', 'CRITICAL', 9.8, 'Prototype Pollution', 'Critical CVE', true, 'package.json')
      ON CONFLICT (snapshot_id, package_name, canonical_id) DO NOTHING
    `, [snapshot1Id, repoId]);

    // Add API unauthenticated endpoint to snapshot 1
    await pool.query(`
      INSERT INTO snapshot_api_findings (
        snapshot_id, repository_id, rule_id, severity, category, method, route_path,
        source_file, source_line, evidence, explanation, remediation
      ) VALUES ($1, $2, 'AUTH_MISSING', 'HIGH', 'SECURITY', 'POST', '/api/users/delete', 'src/routes.js', 12, 'Missing middleware', 'Endpoint lacks auth', 'Add requireAuth')
      ON CONFLICT (snapshot_id, rule_id, method, route_path) DO NOTHING
    `, [snapshot1Id, repoId]);

    // Add Duplication spike to snapshot 1
    await pool.query(`
      INSERT INTO snapshot_duplication_summaries (
        snapshot_id, repository_id, total_source_lines, duplicated_lines, duplication_ratio, clone_count, clone_group_count
      ) VALUES ($1, $2, 1000, 450, 0.4500, 10, 4)
      ON CONFLICT (snapshot_id) DO NOTHING
    `, [snapshot1Id, repoId]);
  });

  await t.test('3. evaluateSnapshotAlerts creates deterministic alerts and notifications', async () => {
    const alerts = await evaluateSnapshotAlerts(snapshot1Id, repoId, pool);
    assert.ok(alerts.length >= 3, `Expected at least 3 candidate alerts, got ${alerts.length}`);

    // Verify critical vuln alert
    const vulnAlert = alerts.find(a => a.rule_id === 'SEC_CRITICAL_VULNERABILITY');
    assert.ok(vulnAlert, 'Critical vulnerability alert was generated');
    assert.strictEqual(vulnAlert.severity, 'CRITICAL');
    assert.strictEqual(vulnAlert.status, 'OPEN');
    assert.strictEqual(vulnAlert.category, 'SECURITY');
    assert.strictEqual(vulnAlert.deduplication_key, 'SEC:CVE-2026-99999:lodash');

    // Verify API auth alert
    const apiAlert = alerts.find(a => a.rule_id === 'API_MISSING_AUTH');
    assert.ok(apiAlert, 'API missing auth alert was generated');
    assert.strictEqual(apiAlert.severity, 'HIGH');
    assert.strictEqual(apiAlert.category, 'API_RELIABILITY');

    // Verify Duplication alert
    const dupAlert = alerts.find(a => a.rule_id === 'CODE_DUPLICATION_SPIKE');
    assert.ok(dupAlert, 'Duplication spike alert was generated');
    assert.strictEqual(dupAlert.category, 'CODE_HEALTH');

    // Verify in-app notifications were created for user
    const { rows: notifs } = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1',
      [userId]
    );
    assert.ok(notifs.length >= 3, `Expected at least 3 notifications, got ${notifs.length}`);
    assert.strictEqual(notifs[0].is_read, false);
    assert.strictEqual(notifs[0].status, 'DELIVERED');
  });

  await t.test('4. Alert generation is idempotent (repeated evaluation creates 0 duplicates)', async () => {
    const { rows: beforeAlerts } = await pool.query(
      'SELECT id FROM alerts WHERE repository_id = $1',
      [repoId]
    );
    const beforeCount = beforeAlerts.length;

    // Re-run evaluation on the same snapshot
    const secondPass = await evaluateSnapshotAlerts(snapshot1Id, repoId, pool);
    assert.strictEqual(secondPass.length, beforeCount);

    const { rows: afterAlerts } = await pool.query(
      'SELECT id FROM alerts WHERE repository_id = $1',
      [repoId]
    );
    assert.strictEqual(afterAlerts.length, beforeCount, 'Alert count must NOT increase on repeated scan');
  });

  await t.test('5. Alert lifecycle transitions: ACKNOWLEDGE -> RESOLVE -> REOPEN -> DISMISS', async () => {
    const { rows } = await pool.query(
      'SELECT id FROM alerts WHERE repository_id = $1 AND rule_id = \'SEC_CRITICAL_VULNERABILITY\' LIMIT 1',
      [repoId]
    );
    const alertId = rows[0].id;

    // 1. Acknowledge
    const acked = await acknowledgeAlert(alertId, userId, 'Investigating patch', pool);
    assert.strictEqual(acked.status, 'ACKNOWLEDGED');
    assert.ok(acked.acknowledged_at);

    // 2. Resolve
    const resolved = await resolveAlert(alertId, userId, 'Updated to 4.17.21 in PR #42', pool);
    assert.strictEqual(resolved.status, 'RESOLVED');
    assert.ok(resolved.resolved_at);

    // 3. Reopen
    const reopened = await reopenAlert(alertId, userId, 'Reopened: transitive dependency still pinned', pool);
    assert.strictEqual(reopened.status, 'OPEN');
    assert.strictEqual(reopened.resolved_at, null);

    // 4. Dismiss
    const dismissed = await dismissAlert(alertId, userId, 'Dismissed: internal tool not accessible', pool);
    assert.strictEqual(dismissed.status, 'DISMISSED');
    assert.ok(dismissed.dismissed_at);

    // Reopen back to OPEN
    await reopenAlert(alertId, userId, 'Reopened for testing', pool);
  });

  await t.test('6. User Assignment, Comments & Immutable Audit Trail', async () => {
    const { rows } = await pool.query(
      'SELECT id FROM alerts WHERE repository_id = $1 AND rule_id = \'SEC_CRITICAL_VULNERABILITY\' LIMIT 1',
      [repoId]
    );
    const alertId = rows[0].id;

    // Assign to userId
    const assigned = await assignAlert(alertId, userId, userId, 'Self-assigned', pool);
    assert.strictEqual(assigned.assigned_user_id, userId);

    // Add comment
    const comment = await addAlertComment(alertId, userId, 'Confirmed this CVE is exploitable in our setup', pool);
    assert.strictEqual(comment.alert_id, alertId);
    assert.strictEqual(comment.content, 'Confirmed this CVE is exploitable in our setup');

    // Fetch audit activity trail
    const activities = await getAlertActivityTrail(alertId, pool);
    assert.ok(activities.length >= 6, `Expected at least 6 activity entries, got ${activities.length}`);

    const actions = activities.map(a => a.action);
    assert.ok(actions.includes('CREATED'), 'Audit includes CREATED');
    assert.ok(actions.includes('ACKNOWLEDGED'), 'Audit includes ACKNOWLEDGED');
    assert.ok(actions.includes('RESOLVED'), 'Audit includes RESOLVED');
    assert.ok(actions.includes('REOPENED'), 'Audit includes REOPENED');
    assert.ok(actions.includes('DISMISSED'), 'Audit includes DISMISSED');
    assert.ok(actions.includes('ASSIGNED'), 'Audit includes ASSIGNED');
    assert.ok(actions.includes('COMMENTED'), 'Audit includes COMMENTED');
  });

  await t.test('7. Auto-resolution when vulnerability disappears in subsequent snapshot', async () => {
    // Snapshot 2 has no vulnerabilities (fixed)
    await evaluateSnapshotAlerts(snapshot2Id, repoId, pool);

    const { rows } = await pool.query(
      'SELECT status, resolved_at FROM alerts WHERE repository_id = $1 AND deduplication_key = $2',
      [repoId, 'SEC:CVE-2026-99999:lodash']
    );
    assert.strictEqual(rows[0].status, 'RESOLVED', 'Alert should be automatically RESOLVED when finding is absent');
    assert.ok(rows[0].resolved_at);
  });

  await t.test('8. Pull Request Risk Alert Evaluation (CP8 Integration)', async () => {
    // Create PR
    const prRes = await pool.query(`
      INSERT INTO pull_requests (
        repository_id, pr_number, title, source_branch, target_branch, source_commit_sha, target_commit_sha, status
      ) VALUES ($1, 42, 'Refactor Payment Gateway', 'feature/payments', 'main', 'sha-pr-head', 'sha-pr-base', 'open')
      ON CONFLICT (repository_id, pr_number) DO UPDATE SET title = EXCLUDED.title
      RETURNING id
    `, [repoId]);
    pullRequestId = prRes.rows[0].id;

    // Create high-risk blocked PR analysis
    const praRes = await pool.query(`
      INSERT INTO pull_request_analyses (
        pull_request_id, commit_sha, status, risk_score, risk_category, quality_gate, summary
      ) VALUES ($1, 'sha-pr-head', 'completed', 94.5, 'CRITICAL', 'BLOCKED', 'High blast radius impacting core billing service')
      RETURNING id
    `, [pullRequestId]);
    prAnalysisId = praRes.rows[0].id;

    // Evaluate PR alerts
    const prAlerts = await evaluatePullRequestAlerts(pullRequestId, prAnalysisId, pool);
    assert.ok(prAlerts.length >= 1, 'PR alert created');

    const blockedAlert = prAlerts.find(a => a.rule_id === 'PR_BLOCKED');
    assert.ok(blockedAlert);
    assert.strictEqual(blockedAlert.severity, 'CRITICAL');
    assert.strictEqual(blockedAlert.category, 'PR_RISK');
    assert.strictEqual(blockedAlert.status, 'OPEN');

    // Verify idempotency on repeated PR analysis
    const prAlertsSecond = await evaluatePullRequestAlerts(pullRequestId, prAnalysisId, pool);
    assert.strictEqual(prAlertsSecond.length, 1);
  });

  await t.test('Cleanup test records', async () => {
    await pool.query('DELETE FROM repositories WHERE id = $1', [repoId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  });
});
