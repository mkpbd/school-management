import { and, between, count, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import {
  studentDailyAttendance as sda,
  studentLeaveRequest as leave,
} from '../../../shared/infrastructure/db/schema/att.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { AttRepository, LeaveRow } from '../application/AttendanceUseCases.js';
import type { DailyStatus } from '../domain/attendance.js';

const leaveCols = {
  id: leave.id,
  studentId: leave.studentId,
  enrolmentId: leave.enrolmentId,
  campusId: leave.campusId,
  fromDate: leave.fromDate,
  toDate: leave.toDate,
  reasonCode: leave.reasonCode,
  reasonNote: leave.reasonNote,
  status: leave.status,
  requestedByUser: leave.requestedByUser,
};

export class DrizzleAttRepository implements AttRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async marksFor(studentIds: string[], date: string) {
    const out = new Map<string, { status: DailyStatus; arrivedAt: Date | null; remarks: string | null }>();
    if (!studentIds.length) return out;
    const rows = await this.tx
      .select({ studentId: sda.studentId, status: sda.status, arrivedAt: sda.arrivedAt, remarks: sda.remarks })
      .from(sda)
      .where(and(eq(sda.attendanceDate, date), inArray(sda.studentId, studentIds)));
    for (const r of rows) out.set(r.studentId, { status: r.status, arrivedAt: r.arrivedAt, remarks: r.remarks });
    return out;
  }

  async upsertMarks(rows: Parameters<AttRepository['upsertMarks']>[0]): Promise<void> {
    if (!rows.length) return;
    await this.tx
      .insert(sda)
      .values(
        rows.map((r) => ({
          orgId: r.orgId,
          campusId: r.campusId,
          attendanceDate: r.date,
          studentId: r.studentId,
          enrolmentId: r.enrolmentId,
          classSectionId: r.classSectionId,
          status: r.status,
          arrivedAt: r.arrivedAt ?? null,
          source: r.source,
          leaveRequestId: r.leaveRequestId ?? null,
          remarks: r.remarks ?? null,
          markedBy: r.markedBy,
        })),
      )
      .onConflictDoUpdate({
        target: [sda.studentId, sda.attendanceDate],
        set: {
          status: sql`excluded.status`,
          arrivedAt: sql`coalesce(excluded.arrived_at, ${sda.arrivedAt})`,
          source: sql`excluded.source`,
          leaveRequestId: sql`excluded.leave_request_id`,
          remarks: sql`excluded.remarks`,
          markedBy: sql`excluded.marked_by`,
          markedAt: sql`now()`,
          rowVersion: sql`${sda.rowVersion} + 1`,
        },
      });
  }

  async approvedLeaveOn(studentIds: string[], date: string): Promise<Map<string, string>> {
    if (!studentIds.length) return new Map();
    const rows = await this.tx
      .select({ studentId: leave.studentId, id: leave.id })
      .from(leave)
      .where(
        and(
          inArray(leave.studentId, studentIds),
          eq(leave.status, 'approved'),
          lte(leave.fromDate, date),
          gte(leave.toDate, date),
        ),
      );
    return new Map(rows.map((r) => [r.studentId, r.id]));
  }

  async countsByStatus(studentId: string, from: string, to: string) {
    const rows = await this.tx
      .select({ status: sda.status, n: count() })
      .from(sda)
      .where(and(eq(sda.studentId, studentId), between(sda.attendanceDate, from, to)))
      .groupBy(sda.status);
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Partial<Record<DailyStatus, number>>;
  }

  async insertLeave(values: Record<string, unknown>): Promise<LeaveRow> {
    const [row] = await this.tx
      .insert(leave)
      .values(values as typeof leave.$inferInsert)
      .returning(leaveCols);
    return row!;
  }

  async leaveForUpdate(id: string): Promise<LeaveRow | null> {
    const [row] = await this.tx.select(leaveCols).from(leave).where(eq(leave.id, id)).for('update');
    return row ?? null;
  }

  async decideLeave(id: string, status: 'approved' | 'rejected', by: string, at: Date): Promise<void> {
    await this.tx.update(leave).set({ status, decidedBy: by, decidedAt: at }).where(eq(leave.id, id));
  }

  leaves(f: { studentIds?: string[]; campusId?: string; status?: string }): Promise<LeaveRow[]> {
    const where: SQL[] = [];
    if (f.studentIds)
      where.push(
        inArray(leave.studentId, f.studentIds.length ? f.studentIds : ['00000000-0000-0000-0000-000000000000']),
      );
    if (f.campusId) where.push(eq(leave.campusId, f.campusId));
    if (f.status) where.push(eq(leave.status, f.status as 'pending'));
    return this.tx
      .select(leaveCols)
      .from(leave)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(leave.fromDate))
      .limit(500);
  }
}
