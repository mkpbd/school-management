import {
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  decodeProtectedHeader,
  type CryptoKey,
  type JWTPayload,
} from 'jose';
import type { AccessClaims } from '../../application/auth.js';
import { AuthError } from '../../domain/errors.js';

export type { AccessClaims };

export interface ShortLivedClaims {
  sub: string;
  org: string;
  purpose: 'mfa';
}

const ALG = 'EdDSA';

/**
 * EdDSA (Ed25519) JWTs (docs/backend/cross-cutting.md §4.2).
 * Access tokens carry identity only; permissions are loaded server-side (instant revocation).
 * Several public keys may be configured (kid) to rotate keys without logging everyone out.
 */
export class TokenService {
  private constructor(
    private readonly privateKey: CryptoKey,
    private readonly kid: string,
    private readonly publicKeys: Map<string, CryptoKey>,
    private readonly issuer: string,
    private readonly accessTtlSec: number,
  ) {}

  static async create(o: {
    privateKeyPem?: string | undefined;
    publicKeysPem?: string | undefined;
    kid: string;
    issuer: string;
    accessTtlSec: number;
  }): Promise<{ service: TokenService; ephemeral: boolean }> {
    let privatePem = o.privateKeyPem;
    let publicPem = o.publicKeysPem;
    const ephemeral = !privatePem;
    if (!privatePem) {
      // development/test only (production config requires keys)
      const pair = await generateKeyPair(ALG, { crv: 'Ed25519', extractable: true });
      privatePem = await exportPKCS8(pair.privateKey);
      publicPem = await exportSPKI(pair.publicKey);
    }
    const privateKey = await importPKCS8(privatePem, ALG);
    const publicKeys = new Map<string, CryptoKey>();
    // JWT_PUBLIC_KEYS: one or more PEM blocks; the first belongs to the current kid, extras as "kid=<id>" + PEM
    const blocks = (publicPem ?? '')
      .split(/(?=-----BEGIN PUBLIC KEY-----)/)
      .filter((b) => b.includes('BEGIN PUBLIC KEY'));
    for (const [i, block] of blocks.entries()) {
      const kidMatch = /kid=([\w.-]+)/.exec(block);
      const pem = block.slice(block.indexOf('-----BEGIN'));
      publicKeys.set(kidMatch?.[1] ?? (i === 0 ? o.kid : `key-${i}`), await importSPKI(pem.trim(), ALG));
    }
    if (!publicKeys.has(o.kid)) throw new Error(`No public key for current kid ${o.kid}`);
    return { service: new TokenService(privateKey, o.kid, publicKeys, o.issuer, o.accessTtlSec), ephemeral };
  }

  get accessTokenTtlSec(): number {
    return this.accessTtlSec;
  }

  signAccess(claims: AccessClaims): Promise<string> {
    return this.sign({ ...claims }, this.accessTtlSec, 'access');
  }

  signShortLived(claims: ShortLivedClaims, ttlSec = 300): Promise<string> {
    return this.sign({ ...claims }, ttlSec, claims.purpose);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    const payload = await this.verify(token, 'access');
    return payload as unknown as AccessClaims;
  }

  async verifyShortLived(token: string, purpose: ShortLivedClaims['purpose']): Promise<ShortLivedClaims> {
    return (await this.verify(token, purpose)) as unknown as ShortLivedClaims;
  }

  private sign(payload: JWTPayload, ttlSec: number, audience: string): Promise<string> {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: ALG, kid: this.kid, typ: 'JWT' })
      .setIssuer(this.issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(`${ttlSec}s`)
      .sign(this.privateKey);
  }

  private async verify(token: string, audience: string): Promise<JWTPayload> {
    try {
      const { kid } = decodeProtectedHeader(token);
      const key = kid ? this.publicKeys.get(kid) : undefined;
      if (!key) throw new AuthError('TOKEN_INVALID', 'Unknown signing key');
      const { payload } = await jwtVerify(token, key, { issuer: this.issuer, audience, algorithms: [ALG] });
      return payload;
    } catch (err) {
      if (err instanceof AuthError) throw err;
      const expired = (err as { code?: string }).code === 'ERR_JWT_EXPIRED';
      throw new AuthError(expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID', expired ? 'Token expired' : 'Invalid token');
    }
  }
}
