import { createHash, randomBytes } from 'node:crypto';

/** Opaque token (256 bits) and its SHA-256; only the hash is persisted (refresh tokens, pay links, API keys). */
export function newOpaqueToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
