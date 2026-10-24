import { ForbiddenError, NotFoundError } from '../domain/errors.js';
import type { DataScope, PermissionCode, RequestContext, ScopeGrant } from './RequestContext.js';

/** What a scope check is about. Only the fields relevant to the resource need to be set. */
export interface ScopeTarget {
  campusId?: string | null;
  studentId?: string;
  classSectionId?: string;
  teachingGroupId?: string;
  staffId?: string;
  userId?: string;
}

/**
 * Resolves a relational data scope (own_classes, own_subjects, own_children, section).
 * Implemented by the owning module (e.g. SIS provides own_children, ACA provides own_classes) and registered in DI.
 */
export interface ScopeResolver {
  readonly scope: DataScope;
  includes(ctx: RequestContext, target: ScopeTarget): Promise<boolean>;
}

/**
 * Second of the three authorization layers (route permission → ScopePolicy → PostgreSQL RLS).
 * docs/backend/cross-cutting.md §5.
 */
export class ScopePolicy {
  private readonly ctx: RequestContext;
  private readonly resolvers: Map<DataScope, ScopeResolver>;

  constructor(deps: { ctx: RequestContext; scopeResolvers: ScopeResolver[] }) {
    this.ctx = deps.ctx;
    this.resolvers = new Map(deps.scopeResolvers.map((r) => [r.scope, r]));
  }

  has(permission: PermissionCode): boolean {
    return (this.ctx.grants.byPermission[permission]?.length ?? 0) > 0;
  }

  grantsFor(permission: PermissionCode): ScopeGrant[] {
    const grants = this.ctx.grants.byPermission[permission];
    if (!grants?.length) throw new ForbiddenError('FORBIDDEN', `Missing permission ${permission}`);
    return grants;
  }

  /** Campus for a write: explicit value, else the X-Campus-Id of the request; must be inside the user's campus scope. */
  requireCampus(campusId?: string | null): string {
    // a user assigned to exactly one campus never has to pick it
    const only = this.ctx.campusIds !== '*' && this.ctx.campusIds.length === 1 ? this.ctx.campusIds[0] : undefined;
    const id = campusId ?? this.ctx.activeCampusId ?? only;
    if (!id) throw new ForbiddenError('CAMPUS_REQUIRED', 'Select a campus (X-Campus-Id header)');
    if (this.ctx.campusIds !== '*' && !this.ctx.campusIds.includes(id)) {
      throw new ForbiddenError('OUT_OF_SCOPE', 'Campus is outside your access');
    }
    return id;
  }

  /** True when at least one grant of the permission covers the target. */
  async allows(permission: PermissionCode, target: ScopeTarget): Promise<boolean> {
    const grants = this.ctx.grants.byPermission[permission] ?? [];
    for (const grant of grants) {
      if (await this.grantCovers(grant, target)) return true;
    }
    return false;
  }

  /**
   * Throws when the target is outside every grant. Guardians/students get 404 instead of 403 so the existence of
   * other families' records is not revealed (IDOR protection).
   */
  async assert(permission: PermissionCode, target: ScopeTarget): Promise<void> {
    if (await this.allows(permission, target)) return;
    if (this.ctx.userType === 'guardian' || this.ctx.userType === 'student') throw new NotFoundError();
    throw new ForbiddenError('OUT_OF_SCOPE', 'This record is outside your access scope');
  }

  private async grantCovers(grant: ScopeGrant, target: ScopeTarget): Promise<boolean> {
    if (grant.campusId && target.campusId && grant.campusId !== target.campusId) return false;
    switch (grant.scope) {
      case 'org':
        return true;
      case 'campus':
        return grant.campusId === null || target.campusId === undefined || target.campusId === grant.campusId;
      case 'self':
        return (
          (target.userId !== undefined && target.userId === this.ctx.userId) ||
          (target.staffId !== undefined && target.staffId === this.ctx.staffId) ||
          (target.studentId !== undefined && target.studentId === this.ctx.studentId)
        );
      default: {
        const resolver = this.resolvers.get(grant.scope);
        return resolver ? resolver.includes(this.ctx, target) : false; // unknown scope = deny
      }
    }
  }
}
