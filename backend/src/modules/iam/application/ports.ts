import type { AccessClaims } from '../../../shared/application/auth.js';

/** Token signing port (implemented by shared TokenService). */
export interface TokenSigner {
  readonly accessTokenTtlSec: number;
  signAccess(claims: AccessClaims): Promise<string>;
  signShortLived(claims: { sub: string; org: string; purpose: 'mfa' }, ttlSec?: number): Promise<string>;
  verifyShortLived(token: string, purpose: 'mfa'): Promise<{ sub: string; org: string; purpose: 'mfa' }>;
}

export interface PasswordVerifier {
  verify(hash: string, password: string): Promise<boolean>;
  verifyDummy(password: string): Promise<false>;
}

export interface TotpVerifier {
  verify(secret: string, code: string): Promise<boolean>;
}
