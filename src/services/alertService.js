/**
 * Alerting, Triage & Team Collaboration Service Client
 * Checkpoint 13 Phase J, K, O
 */

export const alertService = {
  /**
   * Lists alerts with optional filters
   * @param {Object} [params]
   * @param {string} [params.repositoryId]
   * @param {string} [params.status]
   * @param {string} [params.severity]
   * @param {string} [params.category]
   * @param {string} [params.assignedUserId]
   * @param {number} [params.limit=50]
   * @param {number} [params.offset=0]
   * @returns {Promise<{alerts: Array, total: number}>}
   */
  async getAlerts(params = {}) {
    const query = new URLSearchParams();
    if (params.repositoryId) query.set('repositoryId', params.repositoryId);
    if (params.status) query.set('status', params.status);
    if (params.severity) query.set('severity', params.severity);
    if (params.category) query.set('category', params.category);
    if (params.assignedUserId) query.set('assignedUserId', params.assignedUserId);
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));

    const response = await fetch(`/api/alerts?${query.toString()}`, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Failed to fetch alerts (${response.status})`);
    }

    return await response.json();
  },

  /**
   * Fetches full alert details, comments, and activity audit trail
   * @param {string} alertId
   * @returns {Promise<{alert: Object, comments: Array, activities: Array}>}
   */
  async getAlert(alertId) {
    const response = await fetch(`/api/alerts/${alertId}`, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Failed to fetch alert details (${response.status})`);
    }

    return await response.json();
  },

  /**
   * Acknowledges an alert
   * @param {string} alertId
   * @param {string} [note]
   */
  async acknowledgeAlert(alertId, note = '') {
    const response = await fetch(`/api/alerts/${alertId}/acknowledge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ note })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Failed to acknowledge alert (${response.status})`);
    }

    return await response.json();
  },

  /**
   * Resolves an alert
   * @param {string} alertId
   * @param {string} [resolutionNote]
   */
  async resolveAlert(alertId, resolutionNote = '') {
    const response = await fetch(`/api/alerts/${alertId}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ resolutionNote })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Failed to resolve alert (${response.status})`);
    }

    return await response.json();
  },

  /**
   * Dismisses an alert
   * @param {string} alertId
   * @param {string} [dismissalReason]
   */
  async dismissAlert(alertId, dismissalReason = '') {
    const response = await fetch(`/api/alerts/${alertId}/dismiss`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ dismissalReason })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Failed to dismiss alert (${response.status})`);
    }

    return await response.json();
  },

  /**
   * Reopens a resolved or dismissed alert
   * @param {string} alertId
   * @param {string} [note]
   */
  async reopenAlert(alertId, note = '') {
    const response = await fetch(`/api/alerts/${alertId}/reopen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ note })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Failed to reopen alert (${response.status})`);
    }

    return await response.json();
  },

  /**
   * Assigns or reassigns an alert to a user
   * @param {string} alertId
   * @param {string|null} assignedUserId
   * @param {string} [note]
   */
  async assignAlert(alertId, assignedUserId, note = '') {
    const response = await fetch(`/api/alerts/${alertId}/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ assignedUserId, note })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Failed to assign alert (${response.status})`);
    }

    return await response.json();
  },

  /**
   * Adds a user comment to an alert
   * @param {string} alertId
   * @param {string} content
   */
  async addComment(alertId, content) {
    const response = await fetch(`/api/alerts/${alertId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ content })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Failed to add comment (${response.status})`);
    }

    return await response.json();
  },

  /**
   * Fetches list of assignable users
   * @returns {Promise<Array>}
   */
  async getAssignees() {
    try {
      const response = await fetch('/api/alerts/assignees', {
        headers: { Accept: 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (response.ok) {
        const data = await response.json();
        return data.assignees || [];
      }
    } catch (err) {
      console.warn('Failed to fetch assignees:', err);
    }
    return [];
  }
};
