/**
 * Abstract Storage Provider interface for repository snapshots
 */
export class StorageProvider {
  /**
   * Save a snapshot payload
   * @param {string} snapshotId - Snapshot UUID
   * @param {Object} snapshotData - Snapshot payload object
   * @returns {Promise<string>} Storage key / reference URI
   */
  async saveSnapshot(snapshotId, snapshotData) {
    throw new Error('saveSnapshot must be implemented by concrete StorageProvider');
  }

  /**
   * Retrieve a snapshot payload
   * @param {string} snapshotId - Snapshot UUID
   * @returns {Promise<Object>} Snapshot payload object
   */
  async getSnapshot(snapshotId) {
    throw new Error('getSnapshot must be implemented by concrete StorageProvider');
  }

  /**
   * Delete a snapshot payload
   * @param {string} snapshotId - Snapshot UUID
   * @returns {Promise<boolean>} Success indicator
   */
  async deleteSnapshot(snapshotId) {
    throw new Error('deleteSnapshot must be implemented by concrete StorageProvider');
  }
}
