import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import type { BlindIndexer, FieldCipher } from '../../application/ports.js';

/**
 * AES-256-GCM column encryption for `*_enc bytea` columns (NID, birth certificate, health, bank, TOTP secrets).
 * Format: "<version>:" + iv(12) + tag(16) + ciphertext. The version prefix lets keys rotate: new writes use the
 * current key, old rows stay readable until a re-encryption job rewrites them.
 * In production the key comes from a KMS-wrapped data key; here it is injected via FIELD_KEY_<VERSION>.
 */
export class AesGcmFieldCipher implements FieldCipher {
  constructor(
    private readonly keys: Record<string, Buffer>,
    private readonly currentVersion: string,
  ) {
    for (const [v, k] of Object.entries(keys)) {
      if (k.length !== 32) throw new Error(`Field key ${v} must be 32 bytes`);
      if (v.includes(':')) throw new Error('Key version must not contain ":"');
    }
    if (!keys[currentVersion]) throw new Error(`Missing field key ${currentVersion}`);
  }

  encrypt(plain: string): Buffer {
    const key = this.keys[this.currentVersion]!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from(`${this.currentVersion}:`, 'utf8'), iv, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(payload: Buffer): string {
    const sep = payload.indexOf(0x3a); // ':'
    if (sep <= 0) throw new Error('Malformed ciphertext');
    const version = payload.subarray(0, sep).toString('utf8');
    const key = this.keys[version];
    if (!key) throw new Error(`Unknown field key version ${version}`);
    const iv = payload.subarray(sep + 1, sep + 13);
    const tag = payload.subarray(sep + 13, sep + 29);
    const data = payload.subarray(sep + 29);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  versionOf(payload: Buffer): string {
    return payload.subarray(0, payload.indexOf(0x3a)).toString('utf8');
  }
}

/** HMAC-SHA256 blind index for exact-match search on encrypted values (`*_bidx`). */
export class HmacBlindIndexer implements BlindIndexer {
  constructor(private readonly key: Buffer) {
    if (key.length < 32) throw new Error('Blind index key must be at least 32 bytes');
  }

  of(value: string): Buffer {
    return createHmac('sha256', this.key).update(normaliseIdentifier(value)).digest();
  }
}

/** Identifiers (NID, birth certificate, passport) are compared without spaces, dashes or case. */
export function normaliseIdentifier(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s\-_/.]/g, '')
    .toUpperCase();
}
