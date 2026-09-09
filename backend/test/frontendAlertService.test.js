import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { alertService } from '../../src/services/alertService.js';
import { notificationService } from '../../src/services/notificationService.js';

describe('Frontend Alert and Notification Services Client Integration', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('alertService.getAlerts formats query parameters properly', async () => {
    globalThis.fetch = async (url, opts) => {
      assert.ok(url.includes('/api/alerts'));
      assert.ok(url.includes('severity=CRITICAL'));
      assert.ok(url.includes('status=OPEN'));
      assert.strictEqual(opts.credentials, 'include');
      return {
        ok: true,
        json: async () => ({
          alerts: [{ id: 'alert-1', title: 'Critical Vulnerability' }],
          total: 1
        })
      };
    };

    const data = await alertService.getAlerts({ severity: 'CRITICAL', status: 'OPEN' });
    assert.strictEqual(data.total, 1);
    assert.strictEqual(data.alerts[0].id, 'alert-1');
  });

  it('alertService lifecycle actions POST to correct routes', async () => {
    const calledUrls = [];
    globalThis.fetch = async (url, opts) => {
      calledUrls.push({ url, method: opts?.method });
      return {
        ok: true,
        json: async () => ({ alert: { id: 'alert-1' } })
      };
    };

    await alertService.acknowledgeAlert('alert-1', 'test note');
    await alertService.resolveAlert('alert-1', 'resolved');
    await alertService.dismissAlert('alert-1', 'dismissed');
    await alertService.reopenAlert('alert-1', 'reopened');
    await alertService.assignAlert('alert-1', 'user-42');

    assert.strictEqual(calledUrls.length, 5);
    assert.ok(calledUrls[0].url.includes('/api/alerts/alert-1/acknowledge'));
    assert.strictEqual(calledUrls[0].method, 'POST');
    assert.ok(calledUrls[1].url.includes('/api/alerts/alert-1/resolve'));
    assert.ok(calledUrls[2].url.includes('/api/alerts/alert-1/dismiss'));
    assert.ok(calledUrls[3].url.includes('/api/alerts/alert-1/reopen'));
    assert.ok(calledUrls[4].url.includes('/api/alerts/alert-1/assign'));
  });

  it('notificationService calls /api/notifications and unread-count', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('/api/notifications/unread-count')) {
        return {
          ok: true,
          json: async () => ({ unreadCount: 3 })
        };
      }
      return {
        ok: true,
        json: async () => ({
          notifications: [{ id: 'notif-1', isRead: false }],
          unreadCount: 3
        })
      };
    };

    const count = await notificationService.getUnreadCount();
    assert.strictEqual(count, 3);

    const notifs = await notificationService.getNotifications();
    assert.strictEqual(notifs.notifications.length, 1);
  });

  it('notificationService preferences GET and PUT', async () => {
    let putPayload = null;
    globalThis.fetch = async (url, opts) => {
      if (opts?.method === 'PUT') {
        putPayload = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({ preferences: putPayload })
        };
      }
      return {
        ok: true,
        json: async () => ({ preferences: { in_app_enabled: true, min_severity: 'LOW' } })
      };
    };

    const current = await notificationService.getPreferences();
    assert.strictEqual(current.in_app_enabled, true);

    const updated = await notificationService.updatePreferences({ in_app_enabled: false, min_severity: 'HIGH' });
    assert.strictEqual(updated.in_app_enabled, false);
    assert.strictEqual(updated.min_severity, 'HIGH');
  });
});
