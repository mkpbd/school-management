import type { Grants, UserType } from './RequestContext.js';

/** Claims of an access token (identity only, no permissions). */
export interface AccessClaims {
  sub: string;
  org: string;
  typ: Exclude<UserType, 'system' | 'anonymous'>;
  av: number;
  sid: string;
}

/** Everything the request needs to know about the signed-in user. */
export interface AuthenticatedIdentity {
  userId: string;
  orgId: string;
  userType: Exclude<UserType, 'system' | 'anonymous'>;
  locale: 'en' | 'bn';
  grants: Grants;
  staffId?: string | undefined;
  guardianId?: string | undefined;
  studentId?: string | undefined;
}

/**
 * Resolves verified token claims into an identity with grants (cached by authz_version).
 * Implemented by the IAM module; used by the authenticate middleware.
 */
export interface IdentityProvider {
  resolve(claims: AccessClaims): Promise<AuthenticatedIdentity>;
}
