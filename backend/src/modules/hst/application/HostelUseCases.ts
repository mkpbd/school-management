import type { EventPublisher, TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import type { DomainEvent } from '../../../shared/domain/DomainEvent.js';
import { ConflictError, ForbiddenError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import type { FeeModuleApi } from '../../fee/public-api/FeeModuleApi.js';
import type { HrmModuleApi } from '../../hrm/public-api/HrmModuleApi.js';
import type { SisModuleApi } from '../../sis/public-api/SisModuleApi.js';
import {
  assertCanCheckOut,
  assertGenderAllowed,
  defaultBeds,
  minutesLate,
  type RollStatus,
  type RoomType,
} from '../domain/hostel.js';
import type {
  AllocationRow,
  HostelRow,
  HstRepository,
  OccupancyRoom,
  OutpassRow,
  ResidentRow,
  RollRow,
  VisitorRow,
} from './ports.js';

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  hstRepo: HstRepository;
  scopePolicy: ScopePolicy;
  outbox: EventPublisher;
  sisApi: SisModuleApi;
  hrmApi: HrmModuleApi;
  feeApi: FeeModuleApi;
  coreApi: CoreModuleApi;
}

const SOURCE = 'hst';

async function visibleHostel(d: Deps, id: string): Promise<HostelRow> {
  const h = await d.hstRepo.hostel(id);
  if (!h) throw new NotFoundError('Hostel not found', 'HOSTEL_NOT_FOUND');
  d.scopePolicy.requireCampus(h.campusId);
  return h;
}

/** Staff with the permission (campus-checked), or a guardian / the student for their own record. */
async function assertStudentAccess(
  d: Deps,
  studentId: string,
  permission: `hst.${string}`,
  campusId?: string,
): Promise<'staff' | 'guardian' | 'self'> {
  if (d.scopePolicy.has(permission as never)) {
    if (campusId) d.scopePolicy.requireCampus(campusId);
    return 'staff';
  }
  if (d.ctx.studentId === studentId) return 'self';
  if (d.ctx.guardianId && (await d.sisApi.isGuardianOf(d.ctx.guardianId, studentId))) return 'guardian';
  throw new NotFoundError();
}

function event(
  d: Deps,
  type: string,
  aggregateId: string,
  campusId: string,
  payload: Record<string, unknown>,
): DomainEvent {
  return {
    type: type as DomainEvent['type'],
    aggregateType: 'hostel',
    aggregateId,
    orgId: d.ctx.orgId,
    campusId,
    occurredAt: d.clock.now(),
    payload,
  };
}

/** Adds the student's name and admission number to rows that carry a studentId. */
async function withNames<R extends { studentId: string }>(
  d: Deps,
  rows: R[],
): Promise<Array<R & { studentName: string; admissionNo: string }>> {
  const briefs = await d.sisApi.studentBriefs([...new Set(rows.map((r) => r.studentId))]);
  return rows.map((r) => ({
    ...r,
    studentName: briefs.get(r.studentId)?.fullNameEn ?? '',
    admissionNo: briefs.get(r.studentId)?.admissionNo ?? '',
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------------------------------------------

/** A room with its beds (default count from the room type; dormitories need `beds`). */
export class CreateRoom extends UseCase<
  { hostelId: string; code: string; floor: number; roomType: RoomType; monthlyFeePaisa: number; beds?: number },
  { roomId: string; beds: number }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    hostelId: string;
    code: string;
    floor: number;
    roomType: RoomType;
    monthlyFeePaisa: number;
    beds?: number;
  }) {
    const h = await visibleHostel(this.d, i.hostelId);
    const labels = defaultBeds(i.roomType, i.beds);
    const roomId = await this.d.hstRepo.insertRoom({
      orgId: this.d.ctx.orgId,
      campusId: h.campusId,
      hostelId: h.id,
      code: i.code,
      floor: i.floor,
      roomType: i.roomType,
      monthlyFeePaisa: i.monthlyFeePaisa,
    });
    const beds = await this.d.hstRepo.insertBeds(
      labels.map((code) => ({ orgId: this.d.ctx.orgId, campusId: h.campusId, roomId, code })),
    );
    return { roomId, beds };
  }
}

export class AddBeds extends UseCase<{ roomId: string; codes: string[] }, { added: number }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { roomId: string; codes: string[] }) {
    const r = await this.d.hstRepo.room(i.roomId);
    if (!r) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(r.campusId);
    const added = await this.d.hstRepo.insertBeds(
      [...new Set(i.codes)].map((code) => ({ orgId: this.d.ctx.orgId, campusId: r.campusId, roomId: r.id, code })),
    );
    return { added };
  }
}

export interface Occupancy {
  hostel: HostelRow;
  date: string;
  rooms: Array<OccupancyRoom & { beds: Array<OccupancyRoom['beds'][number] & { studentName: string | null }> }>;
  totals: { beds: number; occupied: number; free: number; inactive: number };
}

/** Room / bed map with who sleeps where on a date. */
export class GetOccupancy extends Query<{ hostelId: string; date?: string }, Occupancy> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { hostelId: string; date?: string }) {
    const h = await visibleHostel(this.d, i.hostelId);
    const date = i.date ?? LocalDate.today(this.d.clock).iso;
    const rooms = await this.d.hstRepo.occupancy(h.id, date);
    const ids = rooms.flatMap((r) => r.beds.map((b) => b.studentId).filter((x): x is string => !!x));
    const briefs = await this.d.sisApi.studentBriefs(ids);
    let beds = 0;
    let occupied = 0;
    let inactive = 0;
    const out = rooms.map((r) => ({
      ...r,
      beds: r.beds.map((b) => {
        if (!b.isActive) inactive++;
        else beds++;
        if (b.studentId) occupied++;
        return { ...b, studentName: b.studentId ? (briefs.get(b.studentId)?.fullNameEn ?? null) : null };
      }),
    }));
    return { hostel: h, date, rooms: out, totals: { beds, occupied, free: beds - occupied, inactive } };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Allocation: bed + monthly rent / meal fee items (FEE bills them with the monthly invoice)
// ---------------------------------------------------------------------------------------------------------------

async function startFeeItems(
  d: Deps,
  a: { id: string; campusId: string; enrolmentId: string; validFrom: string; rent: number; meal: number },
) {
  if (a.rent > 0)
    await d.feeApi.addStudentFeeItem({
      enrolmentId: a.enrolmentId,
      campusId: a.campusId,
      feeHeadCode: 'HOSTEL',
      amountPaisa: a.rent,
      validFrom: a.validFrom,
      sourceModule: SOURCE,
      sourceRef: a.id,
    });
  if (a.meal > 0)
    await d.feeApi.addStudentFeeItem({
      enrolmentId: a.enrolmentId,
      campusId: a.campusId,
      feeHeadCode: 'MEAL',
      amountPaisa: a.meal,
      validFrom: a.validFrom,
      sourceModule: SOURCE,
      sourceRef: a.id,
    });
}

async function allocate(
  d: Deps,
  i: { studentId: string; bedId: string; validFrom: string; mealPlan: 'full' | 'none' },
): Promise<AllocationRow> {
  const bed = await d.hstRepo.bed(i.bedId);
  if (!bed) throw new NotFoundError('Bed not found', 'BED_NOT_FOUND');
  d.scopePolicy.requireCampus(bed.campusId);
  if (!bed.isActive || !bed.roomActive) throw new ConflictError('BED_INACTIVE', 'Bed or room is out of use');
  const h = (await d.hstRepo.hostel(bed.hostelId))!;
  if (!h.isActive) throw new ConflictError('HOSTEL_INACTIVE', 'Hostel is closed');
  const student = (await d.sisApi.studentBriefs([i.studentId])).get(i.studentId);
  if (!student) throw new NotFoundError('Student not found', 'STUDENT_NOT_FOUND');
  assertGenderAllowed(h.gender, student.gender);
  const enrolment = await d.sisApi.activeEnrolment(i.studentId, i.validFrom);
  if (!enrolment) throw new ConflictError('STUDENT_NOT_ENROLLED', 'Student has no active enrolment on that date');
  if (enrolment.campusId !== h.campusId)
    throw new InvariantError('HOSTEL_OTHER_CAMPUS', "The hostel belongs to another campus than the student's");
  if (await d.hstRepo.activeAllocationOf(i.studentId, i.validFrom))
    throw new ConflictError('ALREADY_ALLOCATED', 'The student already has a bed; transfer or vacate it first');
  const meal =
    i.mealPlan === 'full' ? ((await d.coreApi.getSetting<number>('hst.meal_fee_paisa', h.campusId)) ?? 0) : 0;
  const id = await d.hstRepo.insertAllocation({
    orgId: d.ctx.orgId,
    campusId: h.campusId,
    hostelId: h.id,
    bedId: bed.id,
    studentId: i.studentId,
    enrolmentId: enrolment.id,
    validFrom: i.validFrom,
    mealPlan: i.mealPlan,
    monthlyFeePaisa: bed.monthlyFeePaisa,
    mealFeePaisa: meal,
  }); // the bed exclusion constraint refuses a bed taken in the same period (409 OVERLAP)
  await startFeeItems(d, {
    id,
    campusId: h.campusId,
    enrolmentId: enrolment.id,
    validFrom: i.validFrom,
    rent: bed.monthlyFeePaisa,
    meal,
  });
  return (await d.hstRepo.allocation(id, false))!;
}

export class AllocateBed extends UseCase<
  { studentId: string; bedId: string; validFrom?: string; mealPlan?: 'full' | 'none' },
  AllocationRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { studentId: string; bedId: string; validFrom?: string; mealPlan?: 'full' | 'none' }) {
    return allocate(this.d, {
      studentId: i.studentId,
      bedId: i.bedId,
      validFrom: i.validFrom ?? LocalDate.today(this.d.clock).iso,
      mealPlan: i.mealPlan ?? 'full',
    });
  }
}

async function endAllocation(d: Deps, a: AllocationRow, lastDay: string, reason: string): Promise<void> {
  if (a.validTo) throw new ConflictError('ALLOCATION_ENDED', 'This allocation has already ended');
  if (lastDay < a.validFrom) throw new InvariantError('DATE_RANGE_INVALID', 'The last day is before the start');
  await d.hstRepo.endAllocation(a.id, lastDay, reason);
  await d.feeApi.endStudentFeeItems(SOURCE, a.id, lastDay);
}

/** Moves the student to another bed from a date (rent follows the new room). */
export class TransferBed extends UseCase<
  { allocationId: string; bedId: string; fromDate?: string; mealPlan?: 'full' | 'none' },
  AllocationRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { allocationId: string; bedId: string; fromDate?: string; mealPlan?: 'full' | 'none' }) {
    const a = await this.d.hstRepo.allocation(i.allocationId, true);
    if (!a) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(a.campusId);
    if (a.bedId === i.bedId) throw new InvariantError('SAME_BED', 'Already on this bed');
    const from = i.fromDate ?? LocalDate.today(this.d.clock).iso;
    if (from <= a.validFrom)
      throw new InvariantError('DATE_RANGE_INVALID', 'Transfer date must be after the allocation start');
    await endAllocation(this.d, a, LocalDate.parse(from).addDays(-1).iso, 'transfer');
    return allocate(this.d, {
      studentId: a.studentId,
      bedId: i.bedId,
      validFrom: from,
      mealPlan: i.mealPlan ?? a.mealPlan,
    });
  }
}

export class VacateBed extends UseCase<{ allocationId: string; lastDay?: string; reason: string }, AllocationRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { allocationId: string; lastDay?: string; reason: string }) {
    const a = await this.d.hstRepo.allocation(i.allocationId, true);
    if (!a) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(a.campusId);
    await endAllocation(this.d, a, i.lastDay ?? LocalDate.today(this.d.clock).iso, i.reason);
    return (await this.d.hstRepo.allocation(a.id, false))!;
  }
}

export class ListResidents extends Query<
  { hostelId: string; date?: string },
  Array<ResidentRow & { studentName: string; admissionNo: string }>
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { hostelId: string; date?: string }) {
    const h = await visibleHostel(this.d, i.hostelId);
    const rows = await this.d.hstRepo.residents(h.id, i.date ?? LocalDate.today(this.d.clock).iso);
    const briefs = await this.d.sisApi.studentBriefs(rows.map((r) => r.studentId));
    return rows.map((r) => ({
      ...r,
      studentName: briefs.get(r.studentId)?.fullNameEn ?? '',
      admissionNo: briefs.get(r.studentId)?.admissionNo ?? '',
    }));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Roll call: morning / night; residents out on a pass are pre-filled "on leave"; absences alert guardians
// ---------------------------------------------------------------------------------------------------------------

export interface RollSheet {
  hostelId: string;
  date: string;
  session: 'morning' | 'night';
  rows: Array<{
    studentId: string;
    studentName: string;
    roomCode: string;
    bedCode: string;
    outOnPass: boolean;
    mark: RollRow | null;
  }>;
}

export class GetRollCall extends Query<{ hostelId: string; date: string; session: 'morning' | 'night' }, RollSheet> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { hostelId: string; date: string; session: 'morning' | 'night' }) {
    const h = await visibleHostel(this.d, i.hostelId);
    const residents = await this.d.hstRepo.residents(h.id, i.date);
    const marks = new Map((await this.d.hstRepo.rollCall(h.id, i.date, i.session)).map((m) => [m.studentId, m]));
    const out = new Set(await this.d.hstRepo.studentsOut(h.id));
    const briefs = await this.d.sisApi.studentBriefs(residents.map((r) => r.studentId));
    return {
      hostelId: h.id,
      date: i.date,
      session: i.session,
      rows: residents.map((r) => ({
        studentId: r.studentId,
        studentName: briefs.get(r.studentId)?.fullNameEn ?? '',
        roomCode: r.roomCode,
        bedCode: r.bedCode,
        outOnPass: out.has(r.studentId),
        mark: marks.get(r.studentId) ?? null,
      })),
    };
  }
}

export class MarkRollCall extends UseCase<
  {
    hostelId: string;
    date: string;
    session: 'morning' | 'night';
    entries: Array<{ studentId: string; status: RollStatus; note?: string }>;
  },
  { saved: number; absentAlerts: number }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    hostelId: string;
    date: string;
    session: 'morning' | 'night';
    entries: Array<{ studentId: string; status: RollStatus; note?: string }>;
  }) {
    const { d } = this;
    const h = await visibleHostel(d, i.hostelId);
    if (i.date > LocalDate.today(d.clock).iso) throw new InvariantError('FUTURE_DATE', 'Cannot mark a future date');
    const residents = new Set((await d.hstRepo.residents(h.id, i.date)).map((r) => r.studentId));
    const strangers = i.entries.filter((e) => !residents.has(e.studentId));
    if (strangers.length)
      throw new InvariantError('NOT_RESIDENT', `${strangers.length} student(s) do not live in this hostel`);
    const before = new Map((await d.hstRepo.rollCall(h.id, i.date, i.session)).map((m) => [m.studentId, m.status]));
    await d.hstRepo.upsertRollCall(
      i.entries.map((e) => ({
        orgId: d.ctx.orgId,
        campusId: h.campusId,
        hostelId: h.id,
        rollDate: i.date,
        session: i.session,
        studentId: e.studentId,
        status: e.status,
        note: e.note ?? null,
        markedBy: d.ctx.userId,
        markedAt: d.clock.now(),
      })),
    );
    // only a change to "absent" alerts (re-saving the sheet does not repeat SMS; COM dedupes as well)
    const absent = i.entries.filter((e) => e.status === 'absent' && before.get(e.studentId) !== 'absent');
    if (absent.length)
      await d.outbox.write(
        absent.map((e) =>
          event(d, 'hst.roll_call_absent.v1', h.id, h.campusId, {
            studentId: e.studentId,
            hostelName: h.name,
            date: i.date,
            session: i.session,
          }),
        ),
      );
    return { saved: i.entries.length, absentAlerts: absent.length };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Out-pass: request (guardian / staff) -> approve (warden) -> gate check-out -> check-in; overdue alerts
// ---------------------------------------------------------------------------------------------------------------

export class RequestOutpass extends UseCase<
  {
    studentId: string;
    kind: 'day_out' | 'home_leave' | 'medical' | 'other';
    destination: string;
    reason?: string;
    escortName?: string;
    escortPhone?: string;
    outFrom: string;
    returnBy: string;
  },
  OutpassRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    studentId: string;
    kind: 'day_out' | 'home_leave' | 'medical' | 'other';
    destination: string;
    reason?: string;
    escortName?: string;
    escortPhone?: string;
    outFrom: string;
    returnBy: string;
  }) {
    const { d } = this;
    const who = await assertStudentAccess(d, i.studentId, 'hst.outpass.create');
    if (who === 'self')
      throw new ForbiddenError('GUARDIAN_OR_WARDEN', 'A guardian or the warden must request an out-pass');
    const from = new Date(i.outFrom);
    const to = new Date(i.returnBy);
    if (to <= from) throw new InvariantError('DATE_RANGE_INVALID', 'Return time must be after the start');
    if (to <= d.clock.now()) throw new InvariantError('OUTPASS_IN_PAST', 'The out-pass would already be over');
    const a = await d.hstRepo.activeAllocationOf(i.studentId, LocalDate.fromInstant(from).iso);
    if (!a) throw new ConflictError('NOT_RESIDENT', 'The student does not live in a hostel on that date');
    if (who === 'staff') d.scopePolicy.requireCampus(a.campusId);
    if (await d.hstRepo.overlappingOutpass(i.studentId, from, to))
      throw new ConflictError('OUTPASS_OVERLAP', 'Another out-pass covers this time');
    const id = await d.hstRepo.insertOutpass({
      orgId: d.ctx.orgId,
      campusId: a.campusId,
      hostelId: a.hostelId,
      studentId: i.studentId,
      kind: i.kind,
      destination: i.destination,
      reason: i.reason ?? null,
      escortName: i.escortName ?? null,
      escortPhone: i.escortPhone ?? null,
      outFrom: from,
      returnBy: to,
      requestedBy: d.ctx.userId,
      requestedByType: who === 'guardian' ? 'guardian' : 'staff',
    });
    return (await d.hstRepo.outpass(id, false))!;
  }
}

export class DecideOutpass extends UseCase<
  { id: string; decision: 'approved' | 'rejected'; note?: string },
  OutpassRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; decision: 'approved' | 'rejected'; note?: string }) {
    const { d } = this;
    const p = await d.hstRepo.outpass(i.id, true);
    if (!p) throw new NotFoundError();
    d.scopePolicy.requireCampus(p.campusId);
    if (p.status !== 'pending') throw new ConflictError('OUTPASS_DECIDED', `Out-pass is ${p.status}`);
    await d.hstRepo.updateOutpass(p.id, {
      status: i.decision,
      decidedBy: d.ctx.userId,
      decidedAt: d.clock.now(),
      decisionNote: i.note ?? null,
    });
    await d.outbox.write([
      event(d, 'hst.outpass_decided.v1', p.id, p.campusId, {
        outpassId: p.id,
        studentId: p.studentId,
        decision: i.decision,
        outFrom: p.outFrom.toISOString(),
        returnBy: p.returnBy.toISOString(),
        note: i.note ?? null,
      }),
    ]);
    return (await d.hstRepo.outpass(p.id, false))!;
  }
}

export class CancelOutpass extends UseCase<{ id: string }, OutpassRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const p = await this.d.hstRepo.outpass(id, true);
    if (!p) throw new NotFoundError();
    await assertStudentAccess(this.d, p.studentId, 'hst.outpass.approve', p.campusId);
    if (p.status !== 'pending' && p.status !== 'approved')
      throw new ConflictError('OUTPASS_CLOSED', `Out-pass is ${p.status}`);
    await this.d.hstRepo.updateOutpass(p.id, { status: 'cancelled' });
    return (await this.d.hstRepo.outpass(p.id, false))!;
  }
}

export class CheckOutAtGate extends UseCase<{ id: string }, OutpassRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const { d } = this;
    const p = await d.hstRepo.outpass(id, true);
    if (!p) throw new NotFoundError();
    d.scopePolicy.requireCampus(p.campusId);
    const now = d.clock.now();
    assertCanCheckOut(p, now, (await d.coreApi.getSetting<number>('hst.checkout_early_minutes', p.campusId)) ?? 60);
    await d.hstRepo.updateOutpass(p.id, { status: 'out', checkedOutAt: now, checkedOutBy: d.ctx.userId });
    const h = (await d.hstRepo.hostel(p.hostelId))!;
    await d.outbox.write([
      event(d, 'hst.student_left.v1', p.id, p.campusId, {
        outpassId: p.id,
        studentId: p.studentId,
        hostelName: h.name,
        at: now.toISOString(),
        returnBy: p.returnBy.toISOString(),
        escortName: p.escortName,
      }),
    ]);
    return (await d.hstRepo.outpass(p.id, false))!;
  }
}

export class CheckInAtGate extends UseCase<{ id: string }, OutpassRow & { minutesLate: number }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const { d } = this;
    const p = await d.hstRepo.outpass(id, true);
    if (!p) throw new NotFoundError();
    d.scopePolicy.requireCampus(p.campusId);
    if (p.status !== 'out') throw new ConflictError('NOT_OUT', `Out-pass is ${p.status}`);
    const now = d.clock.now();
    const late = minutesLate(p.returnBy, now);
    await d.hstRepo.updateOutpass(p.id, { status: 'returned', checkedInAt: now, checkedInBy: d.ctx.userId });
    const h = (await d.hstRepo.hostel(p.hostelId))!;
    await d.outbox.write([
      event(d, 'hst.student_returned.v1', p.id, p.campusId, {
        outpassId: p.id,
        studentId: p.studentId,
        hostelName: h.name,
        at: now.toISOString(),
        minutesLate: late,
      }),
    ]);
    return { ...(await d.hstRepo.outpass(p.id, false))!, minutesLate: late };
  }
}

export class ListOutpasses extends Query<
  { hostelId?: string; studentId?: string; status?: string; limit: number },
  Array<OutpassRow & { studentName: string; admissionNo: string }>
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { hostelId?: string; studentId?: string; status?: string; limit: number }) {
    if (!this.d.scopePolicy.has('hst.outpass.view')) {
      if (!i.studentId) throw new InvariantError('STUDENT_REQUIRED', 'studentId is required');
      await assertStudentAccess(this.d, i.studentId, 'hst.outpass.view');
    }
    return withNames(this.d, await this.d.hstRepo.outpasses(i));
  }
}

/** Students still out after their return time: guardian + warden alerted once (job every 10 minutes). */
export class AlertOverdueOutpasses extends UseCase<Record<string, never>, { overdue: number }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle() {
    const { d } = this;
    const rows = await d.hstRepo.overdueOutpasses(d.clock.now(), 200);
    const events: DomainEvent[] = [];
    for (const p of rows) {
      const h = (await d.hstRepo.hostel(p.hostelId))!;
      await d.hstRepo.updateOutpass(p.id, { overdueNotifiedAt: d.clock.now() });
      events.push(
        event(d, 'hst.outpass_overdue.v1', p.id, p.campusId, {
          outpassId: p.id,
          studentId: p.studentId,
          hostelName: h.name,
          returnBy: p.returnBy.toISOString(),
          wardenStaffId: h.wardenStaffId,
        }),
      );
    }
    if (events.length) await d.outbox.write(events);
    return { overdue: rows.length };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Visitors
// ---------------------------------------------------------------------------------------------------------------

export class LogVisitorIn extends UseCase<
  { studentId: string; visitorName: string; relation: string; phone?: string; idDocNo?: string; purpose?: string },
  VisitorRow & { knownContact: boolean }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    studentId: string;
    visitorName: string;
    relation: string;
    phone?: string;
    idDocNo?: string;
    purpose?: string;
  }) {
    const { d } = this;
    const today = LocalDate.today(d.clock).iso;
    const a = await d.hstRepo.activeAllocationOf(i.studentId, today);
    if (!a) throw new ConflictError('NOT_RESIDENT', 'The student does not live in a hostel');
    d.scopePolicy.requireCampus(a.campusId);
    const id = await d.hstRepo.insertVisitor({
      orgId: d.ctx.orgId,
      campusId: a.campusId,
      hostelId: a.hostelId,
      studentId: i.studentId,
      visitorName: i.visitorName,
      relation: i.relation,
      phone: i.phone ?? null,
      idDocNo: i.idDocNo ?? null,
      purpose: i.purpose ?? null,
      inAt: d.clock.now(),
      recordedBy: d.ctx.userId,
    });
    // a visitor whose phone is the primary guardian's is "known"; others deserve a second look at the desk
    const contact = (await d.sisApi.primaryContacts([i.studentId])).get(i.studentId);
    return { ...(await d.hstRepo.visitor(id))!, knownContact: !!i.phone && contact?.phone === i.phone };
  }
}

export class LogVisitorOut extends UseCase<{ id: string }, VisitorRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    if (!(await this.d.hstRepo.setVisitorOut(id, this.d.clock.now())))
      throw new ConflictError('VISITOR_OUT', 'Visitor not found or already signed out');
    return (await this.d.hstRepo.visitor(id))!;
  }
}

export class ListVisitors extends Query<
  { hostelId?: string; studentId?: string; date?: string; limit: number },
  Array<VisitorRow & { studentName: string; admissionNo: string }>
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { hostelId?: string; studentId?: string; date?: string; limit: number }) {
    const from = i.date ? new Date(`${i.date}T00:00:00+06:00`) : undefined;
    const to = from ? new Date(from.getTime() + 86_400_000) : undefined;
    return withNames(
      this.d,
      await this.d.hstRepo.visitors({ hostelId: i.hostelId, studentId: i.studentId, from, to, limit: i.limit }),
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Parent / student view
// ---------------------------------------------------------------------------------------------------------------

export interface StudentHostel {
  studentId: string;
  allocation: (AllocationRow & { hostelName: string; roomCode: string; bedCode: string }) | null;
  warden: { name: string; phone: string } | null;
  hostelPhone: string | null;
  outpasses: OutpassRow[];
  lastRollCalls: Array<{ date: string; session: string; status: string }>;
}

export class GetStudentHostel extends Query<{ studentId: string }, StudentHostel> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ studentId }: { studentId: string }) {
    const { d } = this;
    await assertStudentAccess(d, studentId, 'hst.allocation.view');
    const today = LocalDate.today(d.clock).iso;
    const a = await d.hstRepo.activeAllocationOf(studentId, today);
    if (!a) return { studentId, allocation: null, warden: null, hostelPhone: null, outpasses: [], lastRollCalls: [] };
    const h = (await d.hstRepo.hostel(a.hostelId))!;
    const bed = (await d.hstRepo.bed(a.bedId))!;
    const warden = h.wardenStaffId ? await d.hrmApi.staffSummary(h.wardenStaffId) : null;
    const lastRollCalls: StudentHostel['lastRollCalls'] = [];
    for (let n = 0; n < 3; n++) {
      const date = LocalDate.parse(today).addDays(-n).iso;
      for (const session of ['night', 'morning'] as const) {
        const mark = (await d.hstRepo.rollCall(h.id, date, session)).find((m) => m.studentId === studentId);
        if (mark) lastRollCalls.push({ date, session, status: mark.status });
      }
    }
    return {
      studentId,
      allocation: { ...a, hostelName: h.name, roomCode: bed.roomCode, bedCode: bed.code },
      warden: warden ? { name: warden.fullNameEn, phone: warden.phone } : null,
      hostelPhone: h.phone,
      outpasses: await d.hstRepo.outpasses({ studentId, limit: 10 }),
      lastRollCalls,
    };
  }
}

export type { ResidentRow };
