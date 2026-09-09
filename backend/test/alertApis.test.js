import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { generateSessionToken, hashSessionToken } from '../src/utils/crypto.js';

let server;
let baseUrl;

async function startServer() {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
}

async function stopServer() {
  return new Promise((resolve) => {
    server.close(resolve);
  });
}

test('Alerting, Notifications & Tenant Isolation REST APIs', async (t) => {
  await startServer();

  let userAId, userBId;
  let userACookie, userBCookie;
  let repoAId, repoBId;
  let alertAId, notifAId;

  try {
    // 1. Setup Tenant A
    const userARes = await pool.query(`
      INSERT INTO users (github_id, login, name, email)
      VALUES (881101, 'alert-tenant-a', 'Tenant A', 'tenant_a_alert@example.com')
      ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login
      RETURNING id
    `);
    userAId = userARes.rows[0].id;

    const rawTokenA = generateSessionToken();
    const hashA = hashSessionToken(rawTokenA);
    await pool.query(`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '1 day')
    `, [userAId, hashA]);
    userACookie = `session_id=${rawTokenA}`;

    // 2. Setup Tenant B
    const userBRes = await pool.query(`
      INSERT INTO users (github_id, login, name, email)
      VALUES (881102, 'alert-tenant-b', 'Tenant B', 'tenant_b_alert@example.com')
      ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login
      RETURNING id
    `);
    userBId = userBRes.rows[0].id;

    const rawTokenB = generateSessionToken();
    const hashB = hashSessionToken(rawTokenB);
    await pool.query(`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '1 day')
    `, [userBId, hashB]);
    userBCookie = `session_id=${rawTokenB}`;

    // 3. Setup Repo A (Tenant A)
    const repoARes = await pool.query(`
      INSERT INTO repositories (name, full_name, owner, provider, user_id, default_branch)
      VALUES ('alert-repo-a', 'tenant-a/alert-repo-a', 'tenant-a', 'github', $1, 'main')
      ON CONFLICT (user_id, provider, owner, name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [userAId]);
    repoAId = repoARes.rows[0].id;

    // 4. Setup Repo B (Tenant B)
    const repoBRes = await pool.query(`
      INSERT INTO repositories (name, full_name, owner, provider, user_id, default_branch)
      VALUES ('alert-repo-b', 'tenant-b/alert-repo-b', 'tenant-b', 'github', $1, 'main')
      ON CONFLICT (user_id, provider, owner, name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [userBId]);
    repoBId = repoBRes.rows[0].id;

    // 5. Create an alert for Repo A
    const alertRes = await pool.query(`
      INSERT INTO alerts (
        repository_id, rule_id, category, severity, status, title, description,
        evidence, source_type, source_id, deduplication_key
      ) VALUES (
        $1, 'SEC_CRITICAL_VULNERABILITY', 'SECURITY', 'CRITICAL', 'OPEN',
        'Critical Prototype Pollution in lodash', 'Vulnerability detected in package.json',
        '{"cve": "CVE-2026-9999"}'::jsonb, 'snapshot_vulnerability', 'CVE-2026-9999',
        'SEC:CVE-2026-9999:lodash'
      )
      RETURNING id
    `, [repoAId]);
    alertAId = alertRes.rows[0].id;

    // 6. Create a notification for Tenant A
    const notifRes = await pool.query(`
      INSERT INTO notifications (
        user_id, alert_id, repository_id, channel, title, message, severity, status, is_read
      ) VALUES ($1, $2, $3, 'in_app', 'Security Alert', 'Critical vulnerability found', 'CRITICAL', 'DELIVERED', false)
      RETURNING id
    `, [userAId, alertAId, repoAId]);
    notifAId = notifRes.rows[0].id;

    await t.test('GET /api/alerts returns Tenant A alerts with filters', async () => {
      const res = await fetch(`${baseUrl}/api/alerts?severity=CRITICAL&status=OPEN`, {
        headers: { Cookie: userACookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.alerts));
      assert.strictEqual(data.total >= 1, true);
      assert.strictEqual(data.alerts[0].id, alertAId);
      assert.strictEqual(data.alerts[0].severity, 'CRITICAL');
      assert.strictEqual(data.alerts[0].status, 'OPEN');
      assert.strictEqual(data.alerts[0].repositoryName, 'alert-repo-a');
    });

    await t.test('GET /api/alerts/assignees returns platform users', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/assignees`, {
        headers: { Cookie: userACookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.assignees));
      assert.ok(data.assignees.some(u => u.login === 'alert-tenant-a'));
    });

    await t.test('GET /api/alerts/:id returns full alert detail, empty comments, empty activities', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/${alertAId}`, {
        headers: { Cookie: userACookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.alert.id, alertAId);
      assert.strictEqual(data.alert.ruleId, 'SEC_CRITICAL_VULNERABILITY');
      assert.ok(Array.isArray(data.comments));
      assert.ok(Array.isArray(data.activities));
    });

    await t.test('POST /api/alerts/:id/acknowledge transitions to ACKNOWLEDGED', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/${alertAId}/acknowledge`, {
        method: 'POST',
        headers: { Cookie: userACookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'Triaged by Tenant A lead' })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.alert.status, 'ACKNOWLEDGED');
      assert.ok(data.alert.acknowledged_at);
    });

    await t.test('POST /api/alerts/:id/assign assigns user and audits', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/${alertAId}/assign`, {
        method: 'POST',
        headers: { Cookie: userACookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedUserId: userAId, note: 'Self assigned' })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.alert.assigned_user_id, userAId);
    });

    await t.test('POST /api/alerts/:id/comments adds comments', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/${alertAId}/comments`, {
        method: 'POST',
        headers: { Cookie: userACookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Patch is being reviewed in security branch' })
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.comment.content, 'Patch is being reviewed in security branch');
    });

    await t.test('GET /api/alerts/:id/activity returns immutable audit activities', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/${alertAId}/activity`, {
        headers: { Cookie: userACookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.activities.length >= 3);
      const actions = data.activities.map(a => a.action);
      assert.ok(actions.includes('ACKNOWLEDGED'));
      assert.ok(actions.includes('ASSIGNED'));
      assert.ok(actions.includes('COMMENTED'));
    });

    await t.test('POST /api/alerts/:id/resolve transitions to RESOLVED', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/${alertAId}/resolve`, {
        method: 'POST',
        headers: { Cookie: userACookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolutionNote: 'Upgraded lodash to 4.17.21' })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.alert.status, 'RESOLVED');
      assert.ok(data.alert.resolved_at);
    });

    await t.test('POST /api/alerts/:id/reopen transitions back to OPEN', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/${alertAId}/reopen`, {
        method: 'POST',
        headers: { Cookie: userACookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'Reopening issue for audit' })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.alert.status, 'OPEN');
      assert.strictEqual(data.alert.resolved_at, null);
    });

    await t.test('POST /api/alerts/:id/dismiss transitions to DISMISSED', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/${alertAId}/dismiss`, {
        method: 'POST',
        headers: { Cookie: userACookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissalReason: 'False positive' })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.alert.status, 'DISMISSED');
      assert.ok(data.alert.dismissed_at);
    });

    // =========================================================================
    // NOTIFICATIONS API TESTS
    // =========================================================================
    await t.test('Notifications APIs: list, unread count, read single, read all', async () => {
      // 1. Unread count
      const countRes = await fetch(`${baseUrl}/api/notifications/unread-count`, {
        headers: { Cookie: userACookie }
      });
      assert.strictEqual(countRes.status, 200);
      const countData = await countRes.json();
      assert.strictEqual(countData.unreadCount >= 1, true);

      // 2. List notifications
      const listRes = await fetch(`${baseUrl}/api/notifications`, {
        headers: { Cookie: userACookie }
      });
      assert.strictEqual(listRes.status, 200);
      const listData = await listRes.json();
      assert.strictEqual(listData.notifications.length >= 1, true);
      assert.strictEqual(listData.notifications[0].id, notifAId);

      // 3. Mark single as read
      const readRes = await fetch(`${baseUrl}/api/notifications/${notifAId}/read`, {
        method: 'POST',
        headers: { Cookie: userACookie }
      });
      assert.strictEqual(readRes.status, 200);
      const readData = await readRes.json();
      assert.strictEqual(readData.notification.is_read, true);

      // 4. Mark all as read
      const readAllRes = await fetch(`${baseUrl}/api/notifications/read-all`, {
        method: 'POST',
        headers: { Cookie: userACookie }
      });
      assert.strictEqual(readAllRes.status, 200);
      const readAllData = await readAllRes.json();
      assert.strictEqual(readAllData.success, true);
    });

    // =========================================================================
    // NOTIFICATION PREFERENCES API TESTS
    // =========================================================================
    await t.test('Notification Preferences: GET defaults & PUT update', async () => {
      // GET
      const getRes = await fetch(`${baseUrl}/api/notification-preferences`, {
        headers: { Cookie: userACookie }
      });
      assert.strictEqual(getRes.status, 200);
      const getData = await getRes.json();
      assert.strictEqual(getData.preferences.in_app_enabled, true);

      // PUT
      const putRes = await fetch(`${baseUrl}/api/notification-preferences`, {
        method: 'PUT',
        headers: { Cookie: userACookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          in_app_enabled: true,
          email_enabled: true,
          min_severity: 'HIGH',
          security_alerts: true,
          pr_risk_alerts: false
        })
      });
      assert.strictEqual(putRes.status, 200);
      const putData = await putRes.json();
      assert.strictEqual(putData.preferences.email_enabled, true);
      assert.strictEqual(putData.preferences.min_severity, 'HIGH');
      assert.strictEqual(putData.preferences.pr_risk_alerts, false);
    });

    // =========================================================================
    // STRICT TENANT ISOLATION TESTS
    // =========================================================================
    await t.test('Strict Tenant Isolation: Tenant B cannot access Tenant A alerts or notifications', async () => {
      // 1. Tenant B querying /api/alerts does NOT see Alert A
      const bListRes = await fetch(`${baseUrl}/api/alerts`, {
        headers: { Cookie: userBCookie }
      });
      assert.strictEqual(bListRes.status, 200);
      const bListData = await bListRes.json();
      assert.strictEqual(bListData.alerts.some(a => a.id === alertAId), false, 'Tenant B must not see Tenant A alert');

      // 2. Tenant B accessing /api/alerts/:alertAId returns 404
      const bGetRes = await fetch(`${baseUrl}/api/alerts/${alertAId}`, {
        headers: { Cookie: userBCookie }
      });
      assert.strictEqual(bGetRes.status, 404, 'Direct access to other tenant alert must return 404');

      // 3. Tenant B acknowledging alertAId returns 404
      const bAckRes = await fetch(`${baseUrl}/api/alerts/${alertAId}/acknowledge`, {
        method: 'POST',
        headers: { Cookie: userBCookie, 'Content-Type': 'application/json' }
      });
      assert.strictEqual(bAckRes.status, 404, 'Acknowledging other tenant alert must return 404');

      // 4. Tenant B resolving alertAId returns 404
      const bResRes = await fetch(`${baseUrl}/api/alerts/${alertAId}/resolve`, {
        method: 'POST',
        headers: { Cookie: userBCookie, 'Content-Type': 'application/json' }
      });
      assert.strictEqual(bResRes.status, 404, 'Resolving other tenant alert must return 404');

      // 5. Tenant B dismissing alertAId returns 404
      const bDismRes = await fetch(`${baseUrl}/api/alerts/${alertAId}/dismiss`, {
        method: 'POST',
        headers: { Cookie: userBCookie, 'Content-Type': 'application/json' }
      });
      assert.strictEqual(bDismRes.status, 404, 'Dismissing other tenant alert must return 404');

      // 6. Tenant B assigning alertAId returns 404
      const bAssignRes = await fetch(`${baseUrl}/api/alerts/${alertAId}/assign`, {
        method: 'POST',
        headers: { Cookie: userBCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedUserId: userBId })
      });
      assert.strictEqual(bAssignRes.status, 404, 'Assigning other tenant alert must return 404');

      // 7. Tenant B commenting on alertAId returns 404
      const bCommentRes = await fetch(`${baseUrl}/api/alerts/${alertAId}/comments`, {
        method: 'POST',
        headers: { Cookie: userBCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Unauthorized comment' })
      });
      assert.strictEqual(bCommentRes.status, 404, 'Commenting on other tenant alert must return 404');

      // 8. Tenant B querying other tenant repo alerts returns 404
      const bRepoFilterRes = await fetch(`${baseUrl}/api/alerts?repositoryId=${repoAId}`, {
        headers: { Cookie: userBCookie }
      });
      assert.strictEqual(bRepoFilterRes.status, 404, 'Filtering by other tenant repo must return 404');

      // 9. Tenant B reading Tenant A notification returns 404
      const bNotifReadRes = await fetch(`${baseUrl}/api/notifications/${notifAId}/read`, {
        method: 'POST',
        headers: { Cookie: userBCookie }
      });
      assert.strictEqual(bNotifReadRes.status, 404, 'Marking other tenant notification as read must return 404');
    });

  } finally {
    // Cleanup
    if (repoAId) await pool.query('DELETE FROM repositories WHERE id = $1', [repoAId]);
    if (repoBId) await pool.query('DELETE FROM repositories WHERE id = $1', [repoBId]);
    if (userAId) await pool.query('DELETE FROM users WHERE id = $1', [userAId]);
    if (userBId) await pool.query('DELETE FROM users WHERE id = $1', [userBId]);

    await stopServer();
  }
});
