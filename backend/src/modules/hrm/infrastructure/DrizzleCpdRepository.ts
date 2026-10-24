import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import {
  cpdAttendance,
  cpdCourse,
  cpdRecord,
  cpdSession,
  staff,
} from '../../../shared/infrastructure/db/schema/hrm.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { CpdRecordRow, CpdRepository, CpdSessionRow } from '../application/CpdUseCases.js';

const sessionCols = {
  id: cpdSession.id,
  campusId: cpdSession.campusId,
  courseId: cpdSession.courseId,
  title: cpdCourse.title,
  hours: cpdCourse.hours,
  startsAt: cpdSession.startsAt,
  endsAt: cpdSession.endsAt,
  venue: cpdSession.venue,
  trainer: cpdSession.trainer,
  capacity: cpdSession.capacity,
  status: cpdSession.status,
  registered: sql<number>`(SELECT count(*) FROM hrm.cpd_attendance a WHERE a.session_id = ${sql.identifier('hrm')}.${sql.identifier('cpd_session')}.${sql.identifier('id')} AND a.status <> 'cancelled')::int`,
};

const recordCols = {
  id: cpdRecord.id,
  staffId: cpdRecord.staffId,
  staffName: staff.fullNameEn,
  title: cpdRecord.title,
  provider: cpdRecord.provider,
  completedOn: cpdRecord.completedOn,
  hours: cpdRecord.hours,
  source: cpdRecord.source,
  sessionId: cpdRecord.sessionId,
  certificateNo: cpdRecord.certificateNo,
  certificateFileId: cpdRecord.certificateFileId,
  verifiedAt: cpdRecord.verifiedAt,
};

const toSession = (r: Omit<CpdSessionRow, 'hours'> & { hours: string }): CpdSessionRow => ({
  ...r,
  hours: Number(r.hours),
});
const toRecord = (r: Omit<CpdRecordRow, 'hours'> & { hours: string }): CpdRecordRow => ({
  ...r,
  hours: Number(r.hours),
});

export class DrizzleCpdRepository implements CpdRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async course(id: string) {
    const [r] = await this.tx
      .select({ id: cpdCourse.id, title: cpdCourse.title, hours: cpdCourse.hours, isActive: cpdCourse.isActive })
      .from(cpdCourse)
      .where(eq(cpdCourse.id, id));
    return r ? { ...r, hours: Number(r.hours) } : null;
  }

  async insertSession(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(cpdSession)
      .values(values as typeof cpdSession.$inferInsert)
      .returning({ id: cpdSession.id });
    return r!.id;
  }

  async session(id: string, forUpdate: boolean): Promise<CpdSessionRow | null> {
    if (forUpdate)
      await this.tx.select({ id: cpdSession.id }).from(cpdSession).where(eq(cpdSession.id, id)).for('update');
    const [r] = await this.tx
      .select(sessionCols)
      .from(cpdSession)
      .innerJoin(cpdCourse, eq(cpdCourse.id, cpdSession.courseId))
      .where(eq(cpdSession.id, id));
    return r ? toSession(r) : null;
  }

  async sessions(f: { campusId?: string; from?: Date; to?: Date; status?: string }): Promise<CpdSessionRow[]> {
    const where: SQL[] = [];
    if (f.campusId) where.push(eq(cpdSession.campusId, f.campusId));
    if (f.from) where.push(gte(cpdSession.startsAt, f.from));
    if (f.to) where.push(lte(cpdSession.startsAt, f.to));
    if (f.status) where.push(eq(cpdSession.status, f.status as CpdSessionRow['status']));
    const rows = await this.tx
      .select(sessionCols)
      .from(cpdSession)
      .innerJoin(cpdCourse, eq(cpdCourse.id, cpdSession.courseId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(cpdSession.startsAt));
    return rows.map(toSession);
  }

  async setSessionStatus(id: string, status: CpdSessionRow['status']): Promise<void> {
    await this.tx.update(cpdSession).set({ status }).where(eq(cpdSession.id, id));
  }

  registrations(sessionId: string) {
    return this.tx
      .select({
        staffId: cpdAttendance.staffId,
        staffNo: staff.staffNo,
        name: staff.fullNameEn,
        status: cpdAttendance.status,
        registeredAt: cpdAttendance.registeredAt,
      })
      .from(cpdAttendance)
      .innerJoin(staff, eq(staff.id, cpdAttendance.staffId))
      .where(eq(cpdAttendance.sessionId, sessionId))
      .orderBy(asc(staff.fullNameEn));
  }

  async cancelRegistrations(sessionId: string): Promise<string[]> {
    const rows = await this.tx
      .update(cpdAttendance)
      .set({ status: 'cancelled' })
      .where(and(eq(cpdAttendance.sessionId, sessionId), ne(cpdAttendance.status, 'cancelled')))
      .returning({ staffId: cpdAttendance.staffId });
    return rows.map((r) => r.staffId);
  }

  async attendance(sessionId: string) {
    return this.tx
      .select({ staffId: cpdAttendance.staffId, status: cpdAttendance.status })
      .from(cpdAttendance)
      .where(eq(cpdAttendance.sessionId, sessionId));
  }

  async register(v: { sessionId: string; staffId: string; orgId: string; campusId: string }): Promise<boolean> {
    const rows = await this.tx
      .insert(cpdAttendance)
      .values(v)
      .onConflictDoNothing()
      .returning({ s: cpdAttendance.staffId });
    return rows.length > 0;
  }

  async markAttendance(sessionId: string, staffId: string, status: 'attended' | 'absent', at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(cpdAttendance)
      .set({ status, markedAt: at })
      .where(and(eq(cpdAttendance.sessionId, sessionId), eq(cpdAttendance.staffId, staffId)))
      .returning({ s: cpdAttendance.staffId });
    return rows.length > 0;
  }

  async insertRecord(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(cpdRecord)
      .values(values as typeof cpdRecord.$inferInsert)
      .returning({ id: cpdRecord.id });
    return r!.id;
  }

  async record(id: string): Promise<CpdRecordRow | null> {
    const [r] = await this.tx
      .select(recordCols)
      .from(cpdRecord)
      .innerJoin(staff, eq(staff.id, cpdRecord.staffId))
      .where(eq(cpdRecord.id, id));
    return r ? toRecord(r) : null;
  }

  async records(f: { staffId?: string; from: string; to: string; pendingOnly?: boolean }): Promise<CpdRecordRow[]> {
    const rows = await this.tx
      .select(recordCols)
      .from(cpdRecord)
      .innerJoin(staff, eq(staff.id, cpdRecord.staffId))
      .where(
        and(
          f.staffId ? eq(cpdRecord.staffId, f.staffId) : undefined,
          gte(cpdRecord.completedOn, f.from),
          lte(cpdRecord.completedOn, f.to),
          f.pendingOnly ? isNull(cpdRecord.verifiedAt) : undefined,
        ),
      )
      .orderBy(desc(cpdRecord.completedOn));
    return rows.map(toRecord);
  }

  async verifyRecord(id: string, by: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(cpdRecord)
      .set({ verifiedBy: by, verifiedAt: at })
      .where(and(eq(cpdRecord.id, id), isNull(cpdRecord.verifiedAt)))
      .returning({ id: cpdRecord.id });
    return rows.length > 0;
  }

  async staffCampus(staffId: string): Promise<string | null> {
    const [r] = await this.tx.select({ campusId: staff.campusId }).from(staff).where(eq(staff.id, staffId));
    return r?.campusId ?? null;
  }

  async hoursByStaff(f: { campusId?: string; from: string; to: string }) {
    const inYear = and(gte(cpdRecord.completedOn, f.from), lte(cpdRecord.completedOn, f.to));
    const rows = await this.tx
      .select({
        staffId: staff.id,
        staffNo: staff.staffNo,
        name: staff.fullNameEn,
        verifiedHours: sql<string>`coalesce(sum(${cpdRecord.hours}) FILTER (WHERE ${cpdRecord.verifiedAt} IS NOT NULL), 0)`,
        pendingHours: sql<string>`coalesce(sum(${cpdRecord.hours}) FILTER (WHERE ${cpdRecord.verifiedAt} IS NULL), 0)`,
      })
      .from(staff)
      .leftJoin(cpdRecord, and(eq(cpdRecord.staffId, staff.id), inYear))
      .where(
        and(
          f.campusId ? eq(staff.campusId, f.campusId) : undefined,
          isNull(staff.deletedAt),
          inArray(staff.status, ['probation', 'active', 'on_leave']),
          eq(staff.staffType, 'teaching'),
        ),
      )
      .groupBy(staff.id, staff.staffNo, staff.fullNameEn)
      .orderBy(asc(staff.staffNo));
    return rows.map((r) => ({ ...r, verifiedHours: Number(r.verifiedHours), pendingHours: Number(r.pendingHours) }));
  }
}
