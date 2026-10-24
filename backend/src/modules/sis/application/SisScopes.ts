import type { DataScope, PermissionCode, RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopeResolver, ScopeTarget } from '../../../shared/application/ScopePolicy.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { AcaModuleApi } from '../../aca/public-api/AcaModuleApi.js';
import type { SisRepository } from './ports.js';

export type Narrowing = { kind: 'all' } | { kind: 'students'; studentIds: string[] } | { kind: 'none' };

interface ScopeSets {
  studentIds: Set<string>;
  sectionIds: Set<string>;
  groupIds: Set<string>;
}

/**
 * Resolves relational data scopes (docs/backend/cross-cutting.md §5.3) into concrete student / section / group sets.
 * Request-scoped and memoised: a portal request asking several times computes each scope once.
 */
export class SisScopes {
  private readonly memo = new Map<DataScope, Promise<ScopeSets>>();

  constructor(
    private readonly d: { ctx: RequestContext; sisRepo: SisRepository; acaApi: AcaModuleApi; clock: Clock },
  ) {}

  /** For list endpoints: 'all' when any grant is org/campus-wide (RLS limits campuses), else the union of student sets. */
  async narrowingFor(permission: PermissionCode): Promise<Narrowing> {
    const grants = this.d.ctx.grants.byPermission[permission] ?? [];
    if (!grants.length) return { kind: 'none' };
    if (grants.some((g) => g.scope === 'org' || g.scope === 'campus')) return { kind: 'all' };
    const ids = new Set<string>();
    for (const g of grants) for (const id of (await this.sets(g.scope)).studentIds) ids.add(id);
    return ids.size ? { kind: 'students', studentIds: [...ids] } : { kind: 'none' };
  }

  async includes(scope: DataScope, target: ScopeTarget): Promise<boolean> {
    const s = await this.sets(scope);
    if (target.studentId !== undefined) return s.studentIds.has(target.studentId);
    if (target.classSectionId !== undefined) return s.sectionIds.has(target.classSectionId);
    if (target.teachingGroupId !== undefined) return s.groupIds.has(target.teachingGroupId);
    return false;
  }

  sets(scope: DataScope): Promise<ScopeSets> {
    let p = this.memo.get(scope);
    if (!p) {
      p = this.compute(scope);
      this.memo.set(scope, p);
    }
    return p;
  }

  private async compute(scope: DataScope): Promise<ScopeSets> {
    const { ctx, sisRepo, acaApi } = this.d;
    const today = LocalDate.today(this.d.clock).iso;
    const empty: ScopeSets = { studentIds: new Set(), sectionIds: new Set(), groupIds: new Set() };
    switch (scope) {
      case 'own_children':
        return ctx.guardianId
          ? { ...empty, studentIds: new Set(await sisRepo.childrenOfGuardian(ctx.guardianId)) }
          : empty;
      case 'self':
        return ctx.studentId ? { ...empty, studentIds: new Set([ctx.studentId]) } : empty;
      case 'section': {
        if (!ctx.staffId) return empty;
        const sections = await acaApi.sectionsOfHeadOfSection(ctx.staffId);
        return {
          studentIds: new Set(await sisRepo.studentsInSections(sections, today)),
          sectionIds: new Set(sections),
          groupIds: new Set(),
        };
      }
      case 'own_classes':
      case 'own_subjects': {
        if (!ctx.staffId) return empty;
        const groups = await acaApi.teachingGroupsOfTeacher(ctx.staffId, today);
        const sections = new Set(groups.filter((g) => g.classSectionId).map((g) => g.classSectionId!));
        if (scope === 'own_classes') for (const s of await acaApi.sectionsOfClassTeacher(ctx.staffId)) sections.add(s);
        const explicit = groups.filter((g) => g.membership === 'explicit').map((g) => g.id);
        const students = new Set([
          ...(await sisRepo.studentsInSections([...sections], today)),
          ...(await sisRepo.studentsInEnrolments(await acaApi.explicitMemberEnrolments(explicit))),
        ]);
        return { studentIds: students, sectionIds: sections, groupIds: new Set(groups.map((g) => g.id)) };
      }
      default:
        return empty;
    }
  }
}

function resolver(scope: DataScope) {
  return class implements ScopeResolver {
    readonly scope = scope;
    constructor(private readonly d: { sisScopes: SisScopes }) {}
    includes(_ctx: RequestContext, target: ScopeTarget): Promise<boolean> {
      return this.d.sisScopes.includes(scope, target);
    }
  };
}

export const OwnChildrenResolver = resolver('own_children');
export const OwnClassesResolver = resolver('own_classes');
export const OwnSubjectsResolver = resolver('own_subjects');
export const SectionResolver = resolver('section');
