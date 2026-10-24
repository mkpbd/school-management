/** Data scope attached to a role permission (iam.role_permission.data_scope). */
export type DataScope = 'org' | 'campus' | 'section' | 'own_classes' | 'own_subjects' | 'own_children' | 'self';

/** `module.resource.action`, e.g. `fee.payment.create` (db/seeds/0001_permissions.sql). */
export type PermissionCode = `${string}.${string}.${string}`;

export interface ScopeGrant {
  scope: DataScope;
  /** Campus of the role assignment; null = organisation-wide assignment. */
  campusId: string | null;
}

/** Effective grants of a user, cached in Redis as JSON (docs/backend/cross-cutting.md §5.1). */
export interface Grants {
  campusIds: string[] | '*';
  byPermission: Record<string, ScopeGrant[]>;
}

export type UserType = 'staff' | 'guardian' | 'student' | 'system' | 'anonymous';

/**
 * Who is acting, for which organisation and campuses. Created per request (authenticate middleware)
 * or per job (system context). The UnitOfWork copies it into PostgreSQL session settings for RLS and audit.
 */
export interface RequestContext {
  readonly requestId: string;
  readonly orgId: string;
  readonly userId: string | null;
  readonly userType: UserType;
  readonly locale: 'en' | 'bn';
  readonly campusIds: string[] | '*';
  readonly activeCampusId?: string | undefined;
  readonly grants: Grants;
  readonly staffId?: string | undefined;
  readonly guardianId?: string | undefined;
  readonly studentId?: string | undefined;
  readonly ip?: string | undefined;
  readonly userAgent?: string | undefined;
}

export const EMPTY_GRANTS: Grants = { campusIds: [], byPermission: {} };

export const SYSTEM_USER_ID = '00000000-0000-7000-8000-000000000001';

/** Context for public endpoints (login, OTP, website): organisation-level rows only, no campus rows. */
export function anonymousContext(orgId: string, requestId: string, ip?: string): RequestContext {
  return {
    requestId,
    orgId,
    userId: null,
    userType: 'anonymous',
    locale: 'en',
    campusIds: [],
    grants: EMPTY_GRANTS,
    ip,
  };
}

/** Context for workers, schedulers and event subscribers: all campuses of one organisation. */
export function systemContext(orgId: string, requestId: string): RequestContext {
  return {
    requestId,
    orgId,
    userId: SYSTEM_USER_ID,
    userType: 'system',
    locale: 'en',
    campusIds: '*',
    grants: { campusIds: '*', byPermission: {} },
  };
}
