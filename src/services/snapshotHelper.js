const snapshotCache = new Map();
const CACHE_TTL_MS = 10000; // 10 seconds cache

/**
 * Resolves the latest completed snapshot for a given repository ID
 * @param {string} repoId - Repository UUID
 * @returns {Promise<Object|null>} Latest completed snapshot or null
 */
export async function getLatestSnapshotForRepo(repoId) {
  if (!repoId || typeof repoId !== 'string') return null;

  // Check if repoId is a mock ID (e.g., 'payment-service', 'customer-api')
  const isMockId = ['payment-service', 'customer-api', 'internal-dashboard', 'authentication-service'].includes(repoId);
  if (isMockId) return null;

  const cacheKey = `latest_snap_${repoId}`;
  const cached = snapshotCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  try {
    const response = await fetch(`/api/repositories/${repoId}/snapshots`, {
      headers: { 'Accept': 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data.snapshots) || data.snapshots.length === 0) {
      return null;
    }

    // Find latest completed snapshot
    const completed = data.snapshots
      .filter(s => s.status === 'completed')
      .sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));

    const latest = completed[0] || null;
    snapshotCache.set(cacheKey, { timestamp: Date.now(), data: latest });
    return latest;
  } catch (err) {
    return null;
  }
}

/**
 * Fetches the complete snapshot payload with files and source code
 * @param {string} repoId - Repository UUID
 * @param {string} snapshotId - Snapshot UUID
 * @returns {Promise<Object|null>} Snapshot payload or null
 */
export async function getSnapshotPayload(repoId, snapshotId) {
  if (!repoId || !snapshotId) return null;

  const cacheKey = `payload_${snapshotId}`;
  const cached = snapshotCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  try {
    const response = await fetch(`/api/repositories/${repoId}/snapshots/${snapshotId}?includePayload=true`, {
      headers: { 'Accept': 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) return null;

    const data = await response.json();
    const payload = data.snapshot?.payload || null;
    if (payload) {
      snapshotCache.set(cacheKey, { timestamp: Date.now(), data: payload });
    }
    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Invalidates the snapshot cache for a repo
 */
export function invalidateSnapshotCache(repoId) {
  if (repoId) {
    snapshotCache.delete(`latest_snap_${repoId}`);
  } else {
    snapshotCache.clear();
  }
}
