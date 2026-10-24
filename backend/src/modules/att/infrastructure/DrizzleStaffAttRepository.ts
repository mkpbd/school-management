import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import {
  staffAttendance,
  staffLeaveBalance,
  staffLeaveRequest,
  staffLeaveType,
} from '../../../shared/infrastructure/db/schema/att.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { LeaveBalance, StaffMonthCounts } from '../domain/staffAttendance.js';
import type { LeaveRequestRow, LeaveTypeRow, StaffAttRepository, StaffDayRow } from '../application/staffPorts.js';

const typeCols = {
  id: staffLeaveType.id,
  code: staffLeaveType.code,
  nameEn: staffLeaveType.nameEn,
  annualQuotaDays: staffLeaveType.annualQuotaDays,
  maxCarryForward: staffLeaveType.maxCarryForward,
  isPaid: staffLeaveType.isPaid,
  genderRestriction: staffLeaveType.genderRestriction,
  requiresDocumentAfterDays: staffLeaveType.requiresDocumentAfterDays,
  countsHolidays: staffLeaveType.countsHolidays,
};
const toType = (
  r: { annualQuotaDays: string; maxCarryForward: string } & Omit<LeaveTypeRow, 'annualQuotaDays' | 'maxCarryForward'>,
): LeaveTypeRow => ({
  ...r,
  annualQuotaDays: Number(r.annualQuotaDays),
  maxCarryForward: Number(r.maxCarryForward),
});

const dayCols = {
  staffId: staffAttendance.staffId,
  attendanceDate: staffAttendance.attendanceDate,
  status: staffAttendance.status,
  checkInAt: staffAttendance.checkInAt,
  checkOutAt: staffAttendance.checkOutAt,
  lateMinutes: staffAttendance.lateMinutes,
  earlyLeaveMinutes: staffAttendance.earlyLeaveMinutes,
  overtimeMinutes: staffAttendance.overtimeMinutes,
  source: staffAttendance.source,
};

/**
 * Staff attendance and leave. att.staff_leave_balance has no org / campus columns (no RLS): use cases resolve the
 * staff member through HrmModuleApi (RLS-checked) before touching a balance.
 */
export class DrizzleStaffAttRepository implements StaffAttRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async leaveTypes(): Promise<LeaveTypeRow[]> {
    return (await this.tx.select(typeCols).from(staffLeaveType).orderBy(asc(staffLeaveType.code))).map(toType);
  }

  async leaveType(id: string): Promise<LeaveTypeRow | null> {
    const [r] = await this.tx.select(typeCols).from(staffLeaveType).where(eq(staffLeaveType.id, id));
    return r ? toType(r) : null;
  }

  async ensureBalances(staffId: string, year: number, types: LeaveTypeRow[]): Promise<void> {
    if (!types.length) return;
    // carry forward what was left last year, capped per type
    const prev = await this.tx
      .select({
        leaveTypeId: staffLeaveBalance.leaveTypeId,
        left: sql<string>`(${staffLeaveBalance.entitledDays} + ${staffLeaveBalance.carriedDays} - ${staffLeaveBalance.takenDays})`,
      })
      .from(staffLeaveBalance)
      .where(and(eq(staffLeaveBalance.staffId, staffId), eq(staffLeaveBalance.leaveYear, year - 1)));
    const leftOf = new Map(prev.map((p) => [p.leaveTypeId, Number(p.left)]));
    await this.tx
      .insert(staffLeaveBalance)
      .values(
        types.map((t) => ({
          staffId,
          leaveTypeId: t.id,
          leaveYear: year,
          entitledDays: String(t.annualQuotaDays),
          carriedDays: String(Math.max(0, Math.min(t.maxCarryForward, leftOf.get(t.id) ?? 0))),
        })),
      )
      .onConflictDoNothing();
  }

  async balances(staffId: string, year: number) {
    const rows = await this.tx
      .select({
        leaveTypeId: staffLeaveBalance.leaveTypeId,
        code: staffLeaveType.code,
        nameEn: staffLeaveType.nameEn,
        isPaid: staffLeaveType.isPaid,
        entitled: staffLeaveBalance.entitledDays,
        carried: staffLeaveBalance.carriedDays,
        taken: staffLeaveBalance.takenDays,
        pending: staffLeaveBalance.pendingDays,
      })
      .from(staffLeaveBalance)
      .innerJoin(staffLeaveType, eq(staffLeaveType.id, staffLeaveBalance.leaveTypeId))
      .where(and(eq(staffLeaveBalance.staffId, staffId), eq(staffLeaveBalance.leaveYear, year)))
      .orderBy(asc(staffLeaveType.code));
    return rows.map((r) => ({
      ...r,
      entitled: Number(r.entitled),
      carried: Number(r.carried),
      taken: Number(r.taken),
      pending: Number(r.pending),
    }));
  }

  async lockBalance(staffId: string, leaveTypeId: string, year: number): Promise<LeaveBalance | null> {
    const [r] = await this.tx
      .select({
        entitled: staffLeaveBalance.entitledDays,
        carried: staffLeaveBalance.carriedDays,
        taken: staffLeaveBalance.takenDays,
        pending: staffLeaveBalance.pendingDays,
      })
      .from(staffLeaveBalance)
      .where(
        and(
          eq(staffLeaveBalance.staffId, staffId),
          eq(staffLeaveBalance.leaveTypeId, leaveTypeId),
          eq(staffLeaveBalance.leaveYear, year),
        ),
      )
      .for('update');
    return r
      ? { entitled: Number(r.entitled), carried: Number(r.carried), taken: Number(r.taken), pending: Number(r.pending) }
      : null;
  }

  async adjustBalance(
    staffId: string,
    leaveTypeId: string,
    year: number,
    delta: { pending?: number; taken?: number },
  ): Promise<void> {
    await this.tx
      .update(staffLeaveBalance)
      .set({
        pendingDays: sql`${staffLeaveBalance.pendingDays} + ${delta.pending ?? 0}`,
        takenDays: sql`${staffLeaveBalance.takenDays} + ${delta.taken ?? 0}`,
      })
      .where(
        and(
          eq(staffLeaveBalance.staffId, staffId),
          eq(staffLeaveBalance.leaveTypeId, leaveTypeId),
          eq(staffLeaveBalance.leaveYear, year),
        ),
      );
  }

  async overlappingLeave(staffId: string, from: string, to: string): Promise<boolean> {
    const [r] = await this.tx
      .select({ id: staffLeaveRequest.id })
      .from(staffLeaveRequest)
      .where(
        and(
          eq(staffLeaveRequest.staffId, staffId),
          inArray(staffLeaveRequest.status, ['pending', 'approved']),
          lte(staffLeaveRequest.fromDate, to),
          gte(staffLeaveRequest.toDate, from),
        ),
      )
      .limit(1);
    return !!r;
  }

  async insertLeave(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(staffLeaveRequest)
      .values(values as typeof staffLeaveRequest.$inferInsert)
      .returning({ id: staffLeaveRequest.id });
    return r!.id;
  }

  private leaveQuery() {
    return this.tx
      .select({
        id: staffLeaveRequest.id,
        campusId: staffLeaveRequest.campusId,
        staffId: staffLeaveRequest.staffId,
        leaveTypeId: staffLeaveRequest.leaveTypeId,
        leaveCode: staffLeaveType.code,
        isPaid: staffLeaveType.isPaid,
        fromDate: staffLeaveRequest.fromDate,
        toDate: staffLeaveRequest.toDate,
        halfDay: staffLeaveRequest.halfDay,
        days: staffLeaveRequest.days,
        reason: staffLeaveRequest.reason,
        attachmentFileId: staffLeaveRequest.attachmentFileId,
        status: staffLeaveRequest.status,
        createdBy: staffLeaveRequest.createdBy,
      })
      .from(staffLeaveRequest)
      .innerJoin(staffLeaveType, eq(staffLeaveType.id, staffLeaveRequest.leaveTypeId));
  }

  async leave(id: string, forUpdate: boolean): Promise<LeaveRequestRow | null> {
    if (forUpdate)
      await this.tx
        .select({ id: staffLeaveRequest.id })
        .from(staffLeaveRequest)
        .where(eq(staffLeaveRequest.id, id))
        .for('update');
    const [r] = await this.leaveQuery().where(eq(staffLeaveRequest.id, id));
    return r ? { ...r, days: Number(r.days) } : null;
  }

  async setLeaveStatus(id: string, status: LeaveRequestRow['status']): Promise<void> {
    await this.tx.update(staffLeaveRequest).set({ status }).where(eq(staffLeaveRequest.id, id));
  }

  async leaves(f: { staffId?: string; campusId?: string; status?: string; from?: string; to?: string; limit: number }) {
    const where: SQL[] = [];
    if (f.staffId) where.push(eq(staffLeaveRequest.staffId, f.staffId));
    if (f.campusId) where.push(eq(staffLeaveRequest.campusId, f.campusId));
    if (f.status) where.push(eq(staffLeaveRequest.status, f.status as LeaveRequestRow['status']));
    if (f.from) where.push(gte(staffLeaveRequest.toDate, f.from));
    if (f.to) where.push(lte(staffLeaveRequest.fromDate, f.to));
    const rows = await this.leaveQuery()
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(staffLeaveRequest.fromDate))
      .limit(f.limit);
    return rows.map((r) => ({ ...r, days: Number(r.days) }));
  }

  // ---------------- daily attendance ----------------
  async upsertDays(rows: Array<Record<string, unknown>>): Promise<void> {
    if (!rows.length) return;
    await this.tx
      .insert(staffAttendance)
      .values(rows as Array<typeof staffAttendance.$inferInsert>)
      .onConflictDoUpdate({
        target: [staffAttendance.staffId, staffAttendance.attendanceDate],
        set: {
          status: sql`excluded.status`,
          checkInAt: sql`coalesce(excluded.check_in_at, ${staffAttendance.checkInAt})`,
          checkOutAt: sql`coalesce(excluded.check_out_at, ${staffAttendance.checkOutAt})`,
          lateMinutes: sql`excluded.late_minutes`,
          earlyLeaveMinutes: sql`excluded.early_leave_minutes`,
          overtimeMinutes: sql`excluded.overtime_minutes`,
          source: sql`excluded.source`,
          geoLat: sql`coalesce(excluded.geo_lat, ${staffAttendance.geoLat})`,
          geoLng: sql`coalesce(excluded.geo_lng, ${staffAttendance.geoLng})`,
        },
      });
  }

  async deleteLeaveDays(staffId: string, dates: string[]): Promise<void> {
    if (!dates.length) return;
    await this.tx
      .delete(staffAttendance)
      .where(
        and(
          eq(staffAttendance.staffId, staffId),
          inArray(staffAttendance.attendanceDate, dates),
          eq(staffAttendance.source, 'leave_auto'),
        ),
      );
  }

  async day(staffId: string, date: string): Promise<StaffDayRow | null> {
    const [r] = await this.tx
      .select(dayCols)
      .from(staffAttendance)
      .where(and(eq(staffAttendance.staffId, staffId), eq(staffAttendance.attendanceDate, date)));
    return r ?? null;
  }

  async daysOn(campusId: string, date: string): Promise<StaffDayRow[]> {
    return this.tx
      .select(dayCols)
      .from(staffAttendance)
      .where(and(eq(staffAttendance.campusId, campusId), eq(staffAttendance.attendanceDate, date)));
  }

  async days(staffId: string, from: string, to: string): Promise<StaffDayRow[]> {
    return this.tx
      .select(dayCols)
      .from(staffAttendance)
      .where(
        and(
          eq(staffAttendance.staffId, staffId),
          gte(staffAttendance.attendanceDate, from),
          lte(staffAttendance.attendanceDate, to),
        ),
      )
      .orderBy(asc(staffAttendance.attendanceDate));
  }

  async monthCounts(staffIds: string[], from: string, to: string): Promise<Map<string, StaffMonthCounts>> {
    const out = new Map<string, StaffMonthCounts>();
    if (!staffIds.length) return out;
    const n = (status: string) => sql<number>`(count(*) FILTER (WHERE ${staffAttendance.status} = ${status}))::int`;
    const rows = await this.tx
      .select({
        staffId: staffAttendance.staffId,
        present: n('present'),
        late: n('late'),
        absent: n('absent'),
        halfDay: n('half_day'),
        leave: n('leave'),
        onDuty: n('on_duty'),
        overtimeMinutes: sql<number>`coalesce(sum(${staffAttendance.overtimeMinutes}), 0)::int`,
      })
      .from(staffAttendance)
      .where(
        and(
          inArray(staffAttendance.staffId, staffIds),
          gte(staffAttendance.attendanceDate, from),
          lte(staffAttendance.attendanceDate, to),
        ),
      )
      .groupBy(staffAttendance.staffId);
    // leave days of unpaid types: attendance "leave" days covered by an approved unpaid request
    const unpaid = await this.tx.execute<{ staff_id: string; days: string }>(sql`
      SELECT a.staff_id, sum(CASE WHEN r.half_day THEN 0.5 ELSE 1 END) AS days
        FROM att.staff_attendance a
        JOIN att.staff_leave_request r
          ON r.staff_id = a.staff_id AND r.status = 'approved'
         AND a.attendance_date BETWEEN r.from_date AND r.to_date
        JOIN att.staff_leave_type t ON t.id = r.leave_type_id AND NOT t.is_paid
       WHERE a.status = 'leave' AND a.attendance_date BETWEEN ${from} AND ${to}
         AND a.staff_id = ANY(ARRAY[${sql.join(
           staffIds.map((id) => sql`${id}`),
           sql`, `,
         )}]::uuid[])
       GROUP BY a.staff_id`);
    const unpaidOf = new Map(unpaid.rows.map((r) => [r.staff_id, Number(r.days)]));
    for (const id of staffIds) {
      const r = rows.find((x) => x.staffId === id);
      out.set(id, {
        present: r?.present ?? 0,
        late: r?.late ?? 0,
        absent: r?.absent ?? 0,
        halfDay: r?.halfDay ?? 0,
        leave: r?.leave ?? 0,
        onDuty: r?.onDuty ?? 0,
        overtimeMinutes: r?.overtimeMinutes ?? 0,
        unpaidLeave: unpaidOf.get(id) ?? 0,
      });
    }
    return out;
  }
}
