/**
 * Prints fresh secrets for a local .env: Ed25519 JWT key pair, AES-256 field key, blind-index key.
 *   npm run keys:dev >> .env
 * Production keys come from the vault / KMS, never from this script's output in a repository.
 */
import { randomBytes } from 'node:crypto';
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
const oneLine = (pem: string) => pem.trim().replace(/\n/g, '\\n');

console.log(`JWT_KID=dev-${new Date().toISOString().slice(0, 10)}`);
console.log(`JWT_PRIVATE_KEY="${oneLine(await exportPKCS8(privateKey))}"`);
console.log(`JWT_PUBLIC_KEYS="${oneLine(await exportSPKI(publicKey))}"`);
console.log(`FIELD_KEY_V1=${randomBytes(32).toString('base64')}`);
console.log(`BLIND_INDEX_KEY=${randomBytes(32).toString('base64')}`);
