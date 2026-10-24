import { and, asc, eq, gt, ilike, inArray, isNull, type SQL } from 'drizzle-orm';
import { decodeCursor, toPage, type Page } from '../../../shared/application/pagination.js';
import { staff } from '../../../shared/infrastructure/db/schema/hrm.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { StaffDto, StaffRepository } from '../application/StaffUseCases.js';
import type { HrmModuleApi, StaffSummary } from '../public-api/HrmModuleApi.js';

const dtoCols = {
  id: staff.id,
  campusId: staff.campusId,
  userId: staff.userId,
  staffNo: staff.staffNo,
  fullNameEn: staff.fullNameEn,
  fullNameBn: staff.fullNameBn,
  gender: staff.gender,
  dateOfBirth: staff.dateOfBirth,
  phone: staff.phone,
  email: staff.email,
  staffType: staff.staffType,
  departmentId: staff.departmentId,
  designationId: staff.designationId,
  reportingToId: staff.reportingToId,
  joinedOn: staff.joinedOn,
  leftOn: staff.leftOn,
  status: staff.status,
  nidBidx: staff.nidBidx,
  rowVersion: staff.rowVersion,
};

type Row = { [K in keyof typeof dtoCols]: unknown } & { nidBidx: Buffer | null };

function toDto(r: Row): StaffDto {
  const { nidBidx, ...rest } = r;
  return { ...(rest as unknown as Omit<StaffDto, 'hasNid'>), hasNid: nidBidx !== null };
}

export class DrizzleStaffRepository implements StaffRepository, HrmModuleApi {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async insert(values: Record<string, unknown>): Promise<StaffDto> {
    const [row] = await this.tx
      .insert(staff)
      .values(values as typeof staff.$inferInsert)
      .returning(dtoCols);
    return toDto(row as Row);
  }

  async update(
    id: string,
    values: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<StaffDto | 'stale' | null> {
    const where = [eq(staff.id, id), isNull(staff.deletedAt)];
    if (expectedVersion !== undefined) where.push(eq(staff.rowVersion, expectedVersion));
    const [row] = await this.tx
      .update(staff)
      .set(values)
      .where(and(...where))
      .returning(dtoCols);
    if (row) return toDto(row as Row);
    return (await this.findById(id)) ? 'stale' : null;
  }

  async findById(id: string): Promise<StaffDto | null> {
    const [row] = await this.tx
      .select(dtoCols)
      .from(staff)
      .where(and(eq(staff.id, id), isNull(staff.deletedAt)));
    return row ? toDto(row as Row) : null;
  }

  async search(f: Parameters<StaffRepository['search']>[0]): Promise<Page<StaffDto>> {
    const where: SQL[] = [isNull(staff.deletedAt)];
    if (f.campusId) where.push(eq(staff.campusId, f.campusId));
    if (f.staffType) where.push(eq(staff.staffType, f.staffType as StaffDto['staffType'] & 'teaching'));
    if (f.status) where.push(eq(staff.status, f.status as 'active'));
    if (f.nidBidx) where.push(eq(staff.nidBidx, f.nidBidx));
    if (f.q) where.push(ilike(staff.searchText, `%${f.q.toLowerCase()}%`));
    const cursor = decodeCursor(f.cursor);
    if (cursor) where.push(gt(staff.id, cursor.id));
    const rows = await this.tx
      .select(dtoCols)
      .from(staff)
      .where(and(...where))
      .orderBy(asc(staff.id))
      .limit(f.limit + 1);
    return toPage(
      rows.map((r) => toDto(r as Row)),
      f.limit,
      (r) => ({ k: [], id: r.id }),
    );
  }

  async linkUser(staffId: string, userId: string): Promise<void> {
    await this.tx.update(staff).set({ userId }).where(eq(staff.id, staffId));
  }

  // ---- HrmModuleApi ----
  async staffSummary(staffId: string): Promise<StaffSummary | null> {
    return (await this.staffSummaries([staffId])).get(staffId) ?? null;
  }

  staffSummaries(staffIds: string[]): Promise<Map<string, StaffSummary>> {
    return this.d.uow.run(async () => {
      if (!staffIds.length) return new Map();
      const rows = await this.tx
        .select({
          id: staff.id,
          staffNo: staff.staffNo,
          fullNameEn: staff.fullNameEn,
          campusId: staff.campusId,
          staffType: staff.staffType,
          status: staff.status,
          userId: staff.userId,
          phone: staff.phone,
          gender: staff.gender,
          joinedOn: staff.joinedOn,
          leftOn: staff.leftOn,
        })
        .from(staff)
        .where(inArray(staff.id, staffIds));
      return new Map(rows.map((r) => [r.id, r]));
    });
  }

  staffUserIds(campusId: string | null): Promise<string[]> {
    return this.d.uow.run(async () => {
      const rows = await this.tx
        .select({ userId: staff.userId })
        .from(staff)
        .where(
          and(
            campusId ? eq(staff.campusId, campusId) : undefined,
            isNull(staff.deletedAt),
            inArray(staff.status, ['onboarding', 'probation', 'active', 'on_leave']),
          ),
        );
      return rows.map((r) => r.userId).filter((x): x is string => !!x);
    });
  }

  staffOfCampus(campusId: string): Promise<StaffSummary[]> {
    return this.d.uow.run(async () =>
      this.tx
        .select({
          id: staff.id,
          staffNo: staff.staffNo,
          fullNameEn: staff.fullNameEn,
          campusId: staff.campusId,
          staffType: staff.staffType,
          status: staff.status,
          userId: staff.userId,
          phone: staff.phone,
          gender: staff.gender,
          joinedOn: staff.joinedOn,
          leftOn: staff.leftOn,
        })
        .from(staff)
        .where(
          and(
            eq(staff.campusId, campusId),
            isNull(staff.deletedAt),
            inArray(staff.status, ['onboarding', 'probation', 'active', 'on_leave']),
          ),
        )
        .orderBy(asc(staff.staffNo)),
    );
  }
}
