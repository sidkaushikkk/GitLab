/**
 * In-App Notifications & User Preferences Service Client
 * Checkpoint 13 Phase F, G, H
 */

export const notificationService = {
  /**
   * Fetches notifications for the authenticated user
   * @param {Object} [params]
   * @param {boolean} [params.unreadOnly=false]
   * @param {number} [params.limit=50]
   * @param {number} [params.offset=0]
   * @returns {Promise<{notifications: Array, unreadCount: number, total: number}>}
   */
  async getNotifications(params = {}) {
    const query = new URLSearchParams();
    if (params.unreadOnly) query.set('unreadOnly', 'true');
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));

    const response = await fetch(`/api/notifications?${query.toString()}`, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Failed to fetch notifications (${response.status})`);
    }

    return await response.json();
  },

  /**
   * Retrieves real-time count of unread notifications
   * @returns {Promise<number>}
   */
  async getUnreadCount() {
    try {
      const response = await fetch('/api/notifications/unread-count', {
        headers: { Accept: 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        const data = await response.json();
        return data.unreadCount ?? 0;
      }
    } catch (err) {
      console.warn('Failed to fetch unread notification count:', err);
    }
    return 0;
  },

  /**
   * Marks a single notification as read
   * @param {string} notificationId
   */
  async markAsRead(notificationId) {
    const response = await fetch(`/api/notifications/${notificationId}/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      credentials: 'include'
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Failed to mark notification as read (${response.status})`);
    }

    return await response.json();
  },

  /**
   * Marks all unread notifications as read
   */
  async markAllAsRead() {
    const response = await fetch('/api/notifications/read-all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      credentials: 'include'
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Failed to mark all notifications as read (${response.status})`);
    }

    return await response.json();
  },

  /**
   * Fetches user notification preferences
   * @returns {Promise<Object>}
   */
  async getPreferences() {
    const response = await fetch('/api/notification-preferences', {
      headers: { Accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Failed to fetch notification preferences (${response.status})`);
    }

    const data = await response.json();
    return data.preferences;
  },

  /**
   * Updates user notification preferences
   * @param {Object} preferences
   */
  async updatePreferences(preferences) {
    const response = await fetch('/api/notification-preferences', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify(preferences)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Failed to update notification preferences (${response.status})`);
    }

    const data = await response.json();
    return data.preferences;
  }
};
