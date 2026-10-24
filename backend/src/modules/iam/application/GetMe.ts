import type { TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import { Query } from '../../../shared/application/UseCase.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { IamRepository } from '../domain/repositories.js';

export interface MeDto {
  id: string;
  type: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  locale: 'en' | 'bn';
  mfaEnabled: boolean;
  campusIds: string[] | '*';
  permissions: Record<string, string[]>; // permission -> scopes
  staffId?: string | undefined;
  guardianId?: string | undefined;
  studentId?: string | undefined;
}

/** Current user profile + effective grants (used by the web app to build menus; the server stays authoritative). */
export class GetMe extends Query<void, MeDto> {
  private readonly d: { iamRepo: IamRepository; ctx: RequestContext };

  constructor(deps: GetMe['d'] & { uow: TransactionRunner }) {
    super(deps.uow);
    this.d = deps;
  }

  protected async handle(): Promise<MeDto> {
    const { ctx } = this.d;
    if (!ctx.userId) throw new NotFoundError();
    const user = await this.d.iamRepo.findById(ctx.userId);
    if (!user) throw new NotFoundError();
    return {
      id: user.id,
      type: user.userType,
      username: user.username,
      email: user.email,
      phone: user.phone,
      locale: user.preferredLocale,
      mfaEnabled: user.mfaType !== null,
      campusIds: ctx.grants.campusIds,
      permissions: Object.fromEntries(
        Object.entries(ctx.grants.byPermission).map(([p, gs]) => [p, [...new Set(gs.map((g) => g.scope))]]),
      ),
      staffId: ctx.staffId,
      guardianId: ctx.guardianId,
      studentId: ctx.studentId,
    };
  }
}
