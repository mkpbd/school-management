import type { EventPublisher, TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { ConflictError, ForbiddenError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { distanceMeters } from '../../../shared/domain/geo.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import type { HrmModuleApi, StaffSummary } from '../../hrm/public-api/HrmModuleApi.js';
import {
  available,
  earlyLeaveMinutes,
  lateMinutes,
  overtimeMinutes,
  summariseStaffMonth,
  type PayRules,
  type StaffDayStatus,
  type StaffMonthSummary,
} from '../domain/staffAttendance.js';
import type { LeaveRequestRow, LeaveTypeRow, StaffAttRepository, StaffDayRow } from './staffPorts.js';

export interface StaffAttDeps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  staffAttRepo: StaffAttRepository;
  scopePolicy: ScopePolicy;
  hrmApi: HrmModuleApi;
  coreApi: CoreModuleApi;
  outbox: EventPublisher;
}

export function monthRange(month: string): { from: string; end: string } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new InvariantError('PERIOD_INVALID', 'Month must be YYYY-MM');
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { from: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
}

async function setting<T>(d: StaffAttDeps, key: string, campusId: string | null, fallback: T): Promise<T> {
  return (await d.coreApi.getSetting<T>(key, campusId)) ?? fallback;
}

export async function payRules(d: Pick<StaffAttDeps, 'coreApi'>, campusId: string | null): Promise<PayRules> {
  const get = async <T>(k: string, f: T) => (await d.coreApi.getSetting<T>(k, campusId)) ?? f;
  return {
    absentIsLwp: await get('att.absent_is_lwp', true),
    halfDayIsLwp: await get('att.half_day_is_lwp', true),
    latesPerLwpDay: await get('att.lates_per_lwp_day', 0),
  };
}

/** The staff member (RLS-checked through HRM); not visible = not found. */
async function staffOf(d: StaffAttDeps, staffId: string): Promise<StaffSummary> {
  const s = await d.hrmApi.staffSummary(staffId);
  if (!s) throw new NotFoundError('Staff member not found', 'STAFF_NOT_FOUND');
  return s;
}

/** Self, or someone holding the permission on the staff member's campus. */
async function actOn(d: StaffAttDeps, staffId: string | undefined, permission: `att.${string}`): Promise<StaffSummary> {
  const id = staffId ?? d.ctx.staffId;
  if (!id) throw new InvariantError('STAFF_REQUIRED', 'staffId is required');
  const s = await staffOf(d, id);
  if (id !== d.ctx.staffId) {
    if (!d.scopePolicy.has(permission as never)) throw new NotFoundError();
    d.scopePolicy.requireCampus(s.campusId);
  }
  return s;
}

/** Working days of a leave: school days of the campus, or every day for types that count holidays. */
async function leaveDates(
  d: StaffAttDeps,
  campusId: string,
  type: LeaveTypeRow,
  from: string,
  to: string,
): Promise<string[]> {
  const out: string[] = [];
  for (let day = LocalDate.parse(from); !day.isAfter(LocalDate.parse(to)); day = day.addDays(1)) {
    if (type.countsHolidays) {
      out.push(day.iso);
      continue;
    }
    const info = await d.coreApi.isSchoolDay(campusId, day.iso);
    if (info.schoolDay || info.reason === 'outside_year') out.push(day.iso);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Leave (ATT staff leave): apply -> approve / reject -> (cancel)
// ---------------------------------------------------------------------------------------------------------------

export class ListLeaveTypes extends Query<Record<string, never>, LeaveTypeRow[]> {
  constructor(private readonly d: StaffAttDeps) {
    super(d.uow);
  }
  protected handle() {
    return this.d.staffAttRepo.leaveTypes();
  }
}

/** Balances of a year (created on first use with capped carry-forward); self or att.staff_leave.view. */
export class GetLeaveBalances extends UseCase<
  { staffId?: string; year: number },
  Array<{
    leaveTypeId: string;
    code: string;
    nameEn: string;
    isPaid: boolean;
    entitled: number;
    carried: number;
    taken: number;
    pending: number;
    available: number;
  }>
> {
  constructor(private readonly d: StaffAttDeps) {
    super(d.uow);
  }
  protected async handle(i: { staffId?: string; year: number }) {
    const s = await actOn(this.d, i.staffId, 'att.staff_leave.view');
    const types = (await this.d.staffAttRepo.leaveTypes()).filter(
      (t) => !t.genderRestriction || t.genderRestriction === s.gender,
    );
    await this.d.staffAttRepo.ensureBalances(s.id, i.year, types);
    return (await this.d.staffAttRepo.balances(s.id, i.year)).map((b) => ({ ...b, available: available(b) }));
  }
}

export class ApplyStaffLeave extends UseCase<
  {
    staffId?: string;
    leaveTypeId: string;
    fromDate: string;
    toDate: string;
    halfDay?: boolean;
    reason?: string;
    attachmentFileId?: string;
  },
  { id: string; days: number; status: 'pending' }
> {
  constructor(private readonly d: StaffAttDeps) {
    super(d.uow);
  }
  protected async handle(i: {
    staffId?: string;
    leaveTypeId: string;
    fromDate: string;
    toDate: string;
    halfDay?: boolean;
    reason?: string;
    attachmentFileId?: string;
  }) {
    const { d } = this;
    const s = await actOn(d, i.staffId, 'att.staff_leave.create');
    const type = await d.staffAttRepo.leaveType(i.leaveTypeId);
    if (!type) throw new NotFoundError('Leave type not found', 'LEAVE_TYPE_NOT_FOUND');
    if (type.genderRestriction && type.genderRestriction !== s.gender)
      throw new InvariantError('LEAVE_NOT_ELIGIBLE', `${type.nameEn} is not available for this staff member`);
    if (i.toDate < i.fromDate) throw new InvariantError('DATE_RANGE_INVALID', 'toDate is before fromDate');
    if (i.halfDay && i.fromDate !== i.toDate) throw new InvariantError('HALF_DAY_RANGE', 'A half day is a single date');
    if (i.fromDate.slice(0, 4) !== i.toDate.slice(0, 4))
      throw new InvariantError('LEAVE_CROSSES_YEAR', 'Apply separately for each leave year');
    if (await d.staffAttRepo.overlappingLeave(s.id, i.fromDate, i.toDate))
      throw new ConflictError('LEAVE_OVERLAP', 'Another leave request covers these dates');
    const dates = await leaveDates(d, s.campusId, type, i.fromDate, i.toDate);
    const days = i.halfDay ? (dates.length ? 0.5 : 0) : dates.length;
    if (!days) throw new InvariantError('NO_WORKING_DAYS', 'The dates contain no working day');
    if (type.requiresDocumentAfterDays !== null && days > type.requiresDocumentAfterDays && !i.attachmentFileId)
      throw new InvariantError(
        'DOCUMENT_REQUIRED',
        `${type.nameEn} over ${type.requiresDocumentAfterDays} day(s) needs a document`,
      );

    const year = Number(i.fromDate.slice(0, 4));
    await d.staffAttRepo.ensureBalances(s.id, year, [type]);
    const balance = await d.staffAttRepo.lockBalance(s.id, type.id, year);
    if (!balance || available(balance) < days)
      throw new ConflictError(
        'INSUFFICIENT_LEAVE',
        `Only ${balance ? available(balance) : 0} day(s) of ${type.code} left`,
      );
    const id = await d.staffAttRepo.insertLeave({
      orgId: d.ctx.orgId,
      campusId: s.campusId,
      staffId: s.id,
      leaveTypeId: type.id,
      fromDate: i.fromDate,
      toDate: i.toDate,
      halfDay: !!i.halfDay,
      days: String(days),
      reason: i.reason ?? null,
      attachmentFileId: i.attachmentFileId ?? null,
    });
    await d.staffAttRepo.adjustBalance(s.id, type.id, year, { pending: days });
    return { id, days, status: 'pending' as const };
  }
}

/** Approve (days taken, attendance marked "leave") or reject (days released); never one's own request. */
export class DecideStaffLeave extends UseCase<
  { id: string; decision: 'approved' | 'rejected'; note?: string },
  { id: string; status: string; daysMarked: number }
> {
  constructor(private readonly d: StaffAttDeps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; decision: 'approved' | 'rejected'; note?: string }) {
    const { d } = this;
    const leave = await d.staffAttRepo.leave(i.id, true);
    if (!leave) throw new NotFoundError();
    d.scopePolicy.requireCampus(leave.campusId);
    if (leave.staffId === d.ctx.staffId) throw new ForbiddenError('SELF_APPROVAL', 'You cannot decide your own leave');
    if (leave.status !== 'pending') throw new ConflictError('LEAVE_DECIDED', `Leave is ${leave.status}`);
    const year = Number(leave.fromDate.slice(0, 4));
    let daysMarked = 0;
    if (i.decision === 'approved') {
      await d.staffAttRepo.adjustBalance(leave.staffId, leave.leaveTypeId, year, {
        pending: -leave.days,
        taken: leave.days,
      });
      const type = (await d.staffAttRepo.leaveType(leave.leaveTypeId))!;
      const dates = await leaveDates(d, leave.campusId, type, leave.fromDate, leave.toDate);
      await d.staffAttRepo.upsertDays(
        dates.map((date) => ({
          orgId: d.ctx.orgId,
          campusId: leave.campusId,
          staffId: leave.staffId,
          attendanceDate: date,
          status: 'leave',
          source: 'leave_auto',
          lateMinutes: 0,
          earlyLeaveMinutes: 0,
          overtimeMinutes: 0,
        })),
      );
      daysMarked = dates.length;
    } else {
      await d.staffAttRepo.adjustBalance(leave.staffId, leave.leaveTypeId, year, { pending: -leave.days });
    }
    await d.staffAttRepo.setLeaveStatus(leave.id, i.decision);
    await d.outbox.write([
      {
        type: 'att.staff_leave_decided.v1',
        aggregateType: 'staff_leave',
        aggregateId: leave.id,
        orgId: d.ctx.orgId,
        campusId: leave.campusId,
        occurredAt: d.clock.now(),
        payload: {
          leaveId: leave.id,
          staffId: leave.staffId,
          leaveCode: leave.leaveCode,
          fromDate: leave.fromDate,
          toDate: leave.toDate,
          days: leave.days,
          decision: i.decision,
          note: i.note ?? null,
        },
      },
    ]);
    return { id: leave.id, status: i.decision, daysMarked };
  }
}

/** The applicant (before it starts) or the approver cancels; an approved leave gives its days back. */
export class CancelStaffLeave extends UseCase<{ id: string }, { id: string; status: 'cancelled' }> {
  constructor(private readonly d: StaffAttDeps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const { d } = this;
    const leave = await d.staffAttRepo.leave(id, true);
    if (!leave) throw new NotFoundError();
    const own = leave.staffId === d.ctx.staffId;
    const approver = d.scopePolicy.has('att.staff_leave.approve');
    if (!own && !approver) throw new NotFoundError();
    if (!own) d.scopePolicy.requireCampus(leave.campusId);
    if (leave.status !== 'pending' && leave.status !== 'approved')
      throw new ConflictError('LEAVE_CLOSED', `Leave is ${leave.status}`);
    const today = LocalDate.today(d.clock).iso;
    if (leave.status === 'approved' && !approver && leave.fromDate <= today)
      throw new ConflictError('LEAVE_STARTED', 'Ask HR to cancel a leave that has started');
    const year = Number(leave.fromDate.slice(0, 4));
    if (leave.status === 'pending') {
      await d.staffAttRepo.adjustBalance(leave.staffId, leave.leaveTypeId, year, { pending: -leave.days });
    } else {
      await d.staffAttRepo.adjustBalance(leave.staffId, leave.leaveTypeId, year, { taken: -leave.days });
      const dates: string[] = [];
      for (let day = LocalDate.parse(leave.fromDate); !day.isAfter(LocalDate.parse(leave.toDate)); day = day.addDays(1))
        dates.push(day.iso);
      await d.staffAttRepo.deleteLeaveDays(leave.staffId, dates);
    }
    await d.staffAttRepo.setLeaveStatus(leave.id, 'cancelled');
    return { id, status: 'cancelled' as const };
  }
}

export class ListStaffLeaves extends Query<
  { staffId?: string; campusId?: string; status?: string; from?: string; to?: string; limit: number },
  LeaveRequestRow[]
> {
  constructor(private readonly d: StaffAttDeps) {
    super(d.uow);
  }
  protected async handle(i: {
    staffId?: string;
    campusId?: string;
    status?: string;
    from?: string;
    to?: string;
    limit: number;
  }) {
    if (!this.d.scopePolicy.has('att.staff_leave.view')) {
      if (!this.d.ctx.staffId) throw new NotFoundError();
      return this.d.staffAttRepo.leaves({ ...i, staffId: this.d.ctx.staffId, campusId: undefined });
    }
    return this.d.staffAttRepo.leaves(i);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Daily attendance: HR register, or self check-in / check-out (optional campus geofence)
// ---------------------------------------------------------------------------------------------------------------

async function dayTimes(d: StaffAttDeps, campusId: string) {
  return {
    start: await setting(d, 'att.staff_start_time', campusId, '08:00'),
    end: await setting(d, 'att.staff_end_time', campusId, '15:00'),
    grace: await setting(d, 'att.staff_grace_minutes', campusId, 10),
    minOt: await setting(d, 'att.staff_min_overtime_minutes', campusId, 30),
  };
}

export interface StaffSheetRow {
  staffId: string;
  staffNo: string;
  name: string;
  day: StaffDayRow | null;
}

export class GetStaffDailySheet extends Query<
  { campusId?: string; date: string },
  { campusId: string; date: string; schoolDay: boolean; rows: StaffSheetRow[] }
> {
  constructor(private readonly d: StaffAttDeps) {
    super(d.uow);
  }
  protected async handle(i: { campusId?: string; date: string }) {
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    const staff = (await this.d.hrmApi.staffOfCampus(campusId)).filter(
      (s) => s.joinedOn <= i.date && (!s.leftOn || s.leftOn >= i.date),
    );
    const days = new Map((await this.d.staffAttRepo.daysOn(campusId, i.date)).map((r) => [r.staffId, r]));
    return {
      campusId,
      date: i.date,
      schoolDay: (await this.d.coreApi.isSchoolDay(campusId, i.date)).schoolDay,
      rows: staff.map((s) => ({ staffId: s.id, staffNo: s.staffNo, name: s.fullNameEn, day: days.get(s.id) ?? null })),
    };
  }
}

export class MarkStaffDaily extends UseCase<
  {
    campusId?: string;
    date: string;
    entries: Array<{
      staffId: string;
      status: StaffDayStatus;
      checkInAt?: string;
      checkOutAt?: string;
      overtimeMinutes?: number;
    }>;
  },
  { saved: number }
> {
  constructor(private readonly d: StaffAttDeps) {
    super(d.uow);
  }
  protected async handle(i: {
    campusId?: string;
    date: string;
    entries: Array<{
      staffId: string;
      status: StaffDayStatus;
      checkInAt?: string;
      checkOutAt?: string;
      overtimeMinutes?: number;
    }>;
  }) {
    const { d } = this;
    const campusId = d.scopePolicy.requireCampus(i.campusId);
    if (i.date > LocalDate.today(d.clock).iso) throw new InvariantError('FUTURE_DATE', 'Cannot mark a future date');
    const onCampus = new Set((await d.hrmApi.staffOfCampus(campusId)).map((s) => s.id));
    const unknown = i.entries.filter((e) => !onCampus.has(e.staffId));
    if (unknown.length)
      throw new InvariantError('STAFF_NOT_ON_CAMPUS', `${unknown.length} staff member(s) not on this campus`);
    const t = await dayTimes(d, campusId);
    await d.staffAttRepo.upsertDays(
      i.entries.map((e) => {
        const checkIn = e.checkInAt ? new Date(e.checkInAt) : null;
        const checkOut = e.checkOutAt ? new Date(e.checkOutAt) : null;
        const late = checkIn ? lateMinutes(checkIn, t.start, t.grace) : 0;
        return {
          orgId: d.ctx.orgId,
          campusId,
          staffId: e.staffId,
          attendanceDate: i.date,
          status: e.status === 'present' && late > 0 ? 'late' : e.status,
          checkInAt: checkIn,
          checkOutAt: checkOut,
          lateMinutes: late,
          earlyLeaveMinutes: checkOut ? earlyLeaveMinutes(checkOut, t.end) : 0,
          overtimeMinutes: e.overtimeMinutes ?? (checkOut ? overtimeMinutes(checkOut, t.end, t.minOt) : 0),
          source: 'manual',
        };
      }),
    );
    return { saved: i.entries.length };
  }
}

async function assertInsideCampus(d: StaffAttDeps, campusId: string, lat?: number, lng?: number): Promise<void> {
  const fence = await d.coreApi.getSetting<{ lat: number; lng: number; radiusMeters: number }>(
    'att.staff_geofence',
    campusId,
  );
  if (!fence) return;
  if (lat === undefined || lng === undefined)
    throw new InvariantError('LOCATION_REQUIRED', 'Location is required to check in on this campus');
  const meters = distanceMeters({ lat, lng }, fence);
  if (meters > fence.radiusMeters)
    throw new ForbiddenError('OUTSIDE_CAMPUS', `You are ${meters} m from campus (limit ${fence.radiusMeters} m)`);
}

export class StaffCheckIn extends UseCase<{ lat?: number; lng?: number }, StaffDayRow> {
  constructor(private readonly d: StaffAttDeps) {
    super(d.uow);
  }
  protected async handle(i: { lat?: number; lng?: number }) {
    const { d } = this;
    if (!d.ctx.staffId) throw new NotFoundError('No staff record for this login', 'NOT_STAFF');
    const s = await staffOf(d, d.ctx.staffId);
    await assertInsideCampus(d, s.campusId, i.lat, i.lng);
    const today = LocalDate.today(d.clock).iso;
    const existing = await d.staffAttRepo.day(s.id, today);
    if (existing?.status === 'leave') throw new ConflictError('ON_LEAVE', 'You are on approved leave today');
    if (existing?.checkInAt) throw new ConflictError('ALREADY_CHECKED_IN', 'Already checked in today');
    const now = d.clock.now();
    const t = await dayTimes(d, s.campusId);
    const late = lateMinutes(now, t.start, t.grace);
    await d.staffAttRepo.upsertDays([
      {
        orgId: d.ctx.orgId,
        campusId: s.campusId,
        staffId: s.id,
        attendanceDate: today,
        status: late > 0 ? 'late' : 'present',
        checkInAt: now,
        lateMinutes: late,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        source: 'mobile_geo',
        geoLat: i.lat === undefined ? null : i.lat.toFixed(6),
        geoLng: i.lng === undefined ? null : i.lng.toFixed(6),
      },
    ]);
    return (await d.staffAttRepo.day(s.id, today))!;
  }
}

export class StaffCheckOut extends UseCase<{ lat?: number; lng?: number }, StaffDayRow> {
  constructor(private readonly d: StaffAttDeps) {
    super(d.uow);
  }
  protected async handle(i: { lat?: number; lng?: number }) {
    const { d } = this;
    if (!d.ctx.staffId) throw new NotFoundError('No staff record for this login', 'NOT_STAFF');
    const s = await staffOf(d, d.ctx.staffId);
    await assertInsideCampus(d, s.campusId, i.lat, i.lng);
    const today = LocalDate.today(d.clock).iso;
    const existing = await d.staffAttRepo.day(s.id, today);
    if (!existing?.checkInAt) throw new ConflictError('NOT_CHECKED_IN', 'Check in first');
    const now = d.clock.now();
    const t = await dayTimes(d, s.campusId);
    await d.staffAttRepo.upsertDays([
      {
        orgId: d.ctx.orgId,
        campusId: s.campusId,
        staffId: s.id,
        attendanceDate: today,
        status: existing.status,
        checkOutAt: now,
        lateMinutes: existing.lateMinutes,
        earlyLeaveMinutes: earlyLeaveMinutes(now, t.end),
        overtimeMinutes: overtimeMinutes(now, t.end, t.minOt),
        source: 'mobile_geo',
      },
    ]);
    return (await d.staffAttRepo.day(s.id, today))!;
  }
}

export class GetStaffMonth extends Query<
  { staffId?: string; month: string },
  { staffId: string; month: string; days: StaffDayRow[]; summary: StaffMonthSummary }
> {
  constructor(private readonly d: StaffAttDeps) {
    super(d.uow);
  }
  protected async handle(i: { staffId?: string; month: string }) {
    const s = await actOn(this.d, i.staffId, 'att.staff.view');
    const { from, end } = monthRange(i.month);
    const counts = (await this.d.staffAttRepo.monthCounts([s.id], from, end)).get(s.id)!;
    return {
      staffId: s.id,
      month: i.month,
      days: await this.d.staffAttRepo.days(s.id, from, end),
      summary: summariseStaffMonth(counts, await payRules(this.d, s.campusId)),
    };
  }
}
