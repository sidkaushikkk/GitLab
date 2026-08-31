import crypto from 'node:crypto';

/**
 * Normalizes an encryption key into a 32-byte Buffer for AES-256-GCM
 * @param {string|Buffer} rawKey
 * @returns {Buffer}
 */
function normalizeKey(rawKey) {
  if (!rawKey) {
    throw new Error('Encryption key is required');
  }

  if (Buffer.isBuffer(rawKey) && rawKey.length === 32) {
    return rawKey;
  }

  // If 64 hex characters (32 bytes)
  if (typeof rawKey === 'string' && /^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }

  // Otherwise hash to 32 bytes using SHA-256
  return crypto.createHash('sha256').update(String(rawKey)).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM with a random 12-byte IV and 16-byte auth tag
 * @param {string} plainText
 * @param {string|Buffer} secretKey
 * @returns {string} iv:authTag:cipherText (all in hex)
 */
export function encryptToken(plainText, secretKey) {
  if (!plainText) return null;
  const key = normalizeKey(secretKey);
  const iv = crypto.randomBytes(12); // Recommended 12 bytes for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM payload with authentication tag validation
 * @param {string} encryptedPayload - Format: "iv:authTag:cipherText"
 * @param {string|Buffer} secretKey
 * @returns {string} Decrypted plaintext string
 */
export function decryptToken(encryptedPayload, secretKey) {
  if (!encryptedPayload) return null;
  const key = normalizeKey(secretKey);

  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format. Expected iv:authTag:cipherText');
  }

  const [ivHex, authTagHex, cipherTextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherTextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generates a 32-byte cryptographically secure random session token
 * @returns {string}
 */
export function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generates a SHA-256 hash of a session token for secure database storage
 * @param {string} token
 * @returns {string} 64-character hex hash
 */
export function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generates a 32-byte cryptographically secure OAuth state parameter
 * @returns {string}
 */
export function generateOAuthState() {
  return crypto.randomBytes(32).toString('hex');
}
