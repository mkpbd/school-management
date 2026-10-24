import type { BlindIndexer, FieldCipher, TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import type { Page } from '../../../shared/application/pagination.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { IamModuleApi } from '../../iam/public-api/IamModuleApi.js';

export interface StaffInput {
  campusId?: string;
  staffNo: string;
  fullNameEn: string;
  fullNameBn?: string;
  gender: 'male' | 'female';
  dateOfBirth?: string;
  nid?: string;
  phone: string;
  email?: string;
  staffType: 'teaching' | 'non_teaching' | 'admin' | 'support';
  departmentId?: string;
  designationId?: string;
  reportingToId?: string;
  joinedOn: string;
  status?: 'onboarding' | 'probation' | 'active';
}

export type StaffPatch = Partial<Omit<StaffInput, 'status'>> & { leftOn?: string | null; status?: string };

export interface StaffDto {
  id: string;
  campusId: string;
  userId: string | null;
  staffNo: string;
  fullNameEn: string;
  fullNameBn: string | null;
  gender: string;
  dateOfBirth: string | null;
  phone: string;
  email: string | null;
  staffType: string;
  departmentId: string | null;
  designationId: string | null;
  reportingToId: string | null;
  joinedOn: string;
  leftOn: string | null;
  status: string;
  hasNid: boolean;
  rowVersion: number;
}

export interface StaffRepository {
  insert(values: Record<string, unknown>): Promise<StaffDto>;
  update(id: string, values: Record<string, unknown>, expectedVersion?: number): Promise<StaffDto | 'stale' | null>;
  findById(id: string): Promise<StaffDto | null>;
  search(f: {
    campusId?: string;
    q?: string;
    staffType?: string;
    status?: string;
    nidBidx?: Buffer;
    limit: number;
    cursor?: string;
  }): Promise<Page<StaffDto>>;
  linkUser(staffId: string, userId: string): Promise<void>;
}

/** HRM-01 staff master: personal data with encrypted NID (+ blind index for exact lookup). */
export class CreateStaff extends UseCase<StaffInput, StaffDto> {
  constructor(
    private readonly d: {
      uow: TransactionRunner;
      staffRepo: StaffRepository;
      scopePolicy: ScopePolicy;
      fieldCipher: FieldCipher;
      blindIndexer: BlindIndexer;
      ctx: RequestContext;
    },
  ) {
    super(d.uow);
  }

  protected async handle(input: StaffInput): Promise<StaffDto> {
    const campusId = this.d.scopePolicy.requireCampus(input.campusId);
    const { nid, ...rest } = input;
    return this.d.staffRepo.insert({
      ...rest,
      orgId: this.d.ctx.orgId,
      campusId,
      status: input.status ?? 'active',
      nidEnc: nid ? this.d.fieldCipher.encrypt(nid) : null,
      nidBidx: nid ? this.d.blindIndexer.of(nid) : null,
    });
  }
}

export class UpdateStaff extends UseCase<{ id: string; patch: StaffPatch; expectedVersion?: number }, StaffDto> {
  constructor(
    private readonly d: {
      uow: TransactionRunner;
      staffRepo: StaffRepository;
      fieldCipher: FieldCipher;
      blindIndexer: BlindIndexer;
    },
  ) {
    super(d.uow);
  }

  protected async handle(i: { id: string; patch: StaffPatch; expectedVersion?: number }): Promise<StaffDto> {
    const { nid, campusId: _ignored, ...rest } = i.patch;
    const values: Record<string, unknown> = { ...rest };
    if (nid !== undefined) {
      values.nidEnc = nid ? this.d.fieldCipher.encrypt(nid) : null;
      values.nidBidx = nid ? this.d.blindIndexer.of(nid) : null;
    }
    const result = await this.d.staffRepo.update(i.id, values, i.expectedVersion);
    if (result === 'stale') throw new ConflictError('PRECONDITION_FAILED', 'Staff record changed; reload and retry');
    if (!result) throw new NotFoundError();
    return result;
  }
}

export class GetStaff extends Query<{ id: string }, StaffDto> {
  constructor(private readonly d: { uow: TransactionRunner; staffRepo: StaffRepository }) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }): Promise<StaffDto> {
    const s = await this.d.staffRepo.findById(id);
    if (!s) throw new NotFoundError();
    return s;
  }
}

export class SearchStaff extends Query<
  { campusId?: string; q?: string; staffType?: string; status?: string; nid?: string; limit: number; cursor?: string },
  Page<StaffDto>
> {
  constructor(private readonly d: { uow: TransactionRunner; staffRepo: StaffRepository; blindIndexer: BlindIndexer }) {
    super(d.uow);
  }
  protected handle(i: {
    campusId?: string;
    q?: string;
    staffType?: string;
    status?: string;
    nid?: string;
    limit: number;
    cursor?: string;
  }) {
    const { nid, ...filters } = i;
    return this.d.staffRepo.search({ ...filters, nidBidx: nid ? this.d.blindIndexer.of(nid) : undefined });
  }
}

/** Creates the staff member's login (IAM) and links it (hrm.staff.user_id). */
export class CreateStaffAccount extends UseCase<
  { staffId: string; username: string; password: string; roleCode: string; campusId?: string | null },
  { userId: string }
> {
  constructor(
    private readonly d: {
      uow: TransactionRunner;
      staffRepo: StaffRepository;
      iamApi: IamModuleApi;
      scopePolicy: ScopePolicy;
    },
  ) {
    super(d.uow);
  }

  protected async handle(i: {
    staffId: string;
    username: string;
    password: string;
    roleCode: string;
    campusId?: string | null;
  }) {
    const staff = await this.d.staffRepo.findById(i.staffId);
    if (!staff) throw new NotFoundError();
    if (staff.userId) throw new ConflictError('ACCOUNT_EXISTS', 'Staff member already has a login');
    const campusId = i.campusId === null ? null : this.d.scopePolicy.requireCampus(i.campusId ?? staff.campusId);
    const { userId } = await this.d.iamApi.createStaffAccount({
      username: i.username,
      email: staff.email,
      password: i.password,
      roleCode: i.roleCode,
      campusId,
    });
    await this.d.staffRepo.linkUser(staff.id, userId);
    return { userId };
  }
}
