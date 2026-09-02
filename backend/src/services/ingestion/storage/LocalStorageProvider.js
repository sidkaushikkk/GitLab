import fs from 'node:fs/promises';
import path from 'node:path';
import { StorageProvider } from './StorageProvider.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

export class LocalStorageProvider extends StorageProvider {
  constructor(baseDir = null) {
    super();
    this.baseDir = baseDir || path.resolve(env.storagePath, 'snapshots');
  }

  async _ensureDir() {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  _getFilePath(snapshotId) {
    return path.join(this.baseDir, `${snapshotId}.json`);
  }

  async saveSnapshot(snapshotId, snapshotData) {
    await this._ensureDir();
    const filePath = this._getFilePath(snapshotId);
    const serialized = JSON.stringify(snapshotData, null, 2);
    await fs.writeFile(filePath, serialized, 'utf8');
    logger.debug({ snapshotId, filePath }, 'Saved snapshot to local storage');
    return `file://${filePath}`;
  }

  async getSnapshot(snapshotId) {
    const filePath = this._getFilePath(snapshotId);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') {
        const error = new Error(`Snapshot payload ${snapshotId} not found in storage.`);
        error.status = 404;
        throw error;
      }
      throw err;
    }
  }

  async deleteSnapshot(snapshotId) {
    const filePath = this._getFilePath(snapshotId);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }
}

export const defaultStorageProvider = new LocalStorageProvider();
