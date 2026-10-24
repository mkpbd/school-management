import type { EventPublisher, TransactionRunner } from '../../../shared/application/ports.js';
import type { PermissionCode, RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { ConflictError, ForbiddenError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import type { AcaModuleApi, ScheduledSlot, TeachingGroupInfo } from '../../aca/public-api/AcaModuleApi.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import type { RosterEntry, SisModuleApi } from '../../sis/public-api/SisModuleApi.js';
import {
  assertCorrectionDecidable,
  assertWithinEditWindow,
  editWindow,
  expandQuickMark,
  isPeriodWise,
  missedPeriod,
  suggestPeriodStatus,
  type DailyStatus,
  type PeriodStatus,
} from '../domain/attendance.js';
import type { AttRepository } from './AttendanceUseCases.js';

export interface PeriodMark {
  studentId: string;
  periodDefinitionId: string;
  teachingGroupId: string;
  status: PeriodStatus;
  source: 'teacher' | 'online_join_log' | 'correction';
  markedBy: string | null;
  markedAt: Date;
}

export interface CorrectionRow {
  id: string;
  campusId: string;
  kind: 'daily' | 'period';
  studentId: string;
  attendanceDate: string;
  classSectionId: string | null;
  teachingGroupId: string | null;
  periodDefinitionId: string | null;
  oldStatus: string | null;
  newStatus: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
}

export interface HistoryEvent {
  occurredAt: Date;
  actorUserId: string | null;
  table: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedCols: string[];
}

export interface PeriodAttRepository {
  periodMarks(f: {
    date: string;
    studentIds?: string[];
    periodDefinitionId?: string;
    teachingGroupId?: string;
  }): Promise<PeriodMark[]>;
  /** marks per `${teachingGroupId}|${periodDefinitionId}` */
  markCounts(
    date: string,
    groupPeriods: Array<{ teachingGroupId: string; periodDefinitionId: string }>,
  ): Promise<Map<string, number>>;
  upsertPeriodMarks(
    rows: Array<{
      orgId: string;
      campusId: string;
      date: string;
      periodDefinitionId: string;
      teachingGroupId: string;
      studentId: string;
      status: PeriodStatus;
      source: 'teacher' | 'correction';
      markedBy: string | null;
    }>,
  ): Promise<void>;
  insertCorrection(values: Record<string, unknown>): Promise<CorrectionRow>;
  correctionForUpdate(id: string): Promise<CorrectionRow | null>;
  setCorrectionStatus(
    id: string,
    patch: { status: CorrectionRow['status']; decidedBy?: string; decidedAt?: Date; decisionNote?: string | null },
  ): Promise<void>;
  corrections(f: {
    status?: string;
    campusId?: string | null;
    studentId?: string;
    date?: string;
    requestedBy?: string;
    limit: number;
  }): Promise<CorrectionRow[]>;
  history(studentId: string, date: string): Promise<HistoryEvent[]>;
}

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  attRepo: AttRepository;
  periodAttRepo: PeriodAttRepository;
  scopePolicy: ScopePolicy;
  sisApi: SisModuleApi;
  acaApi: AcaModuleApi;
  coreApi: CoreModuleApi;
  outbox: EventPublisher;
}

const PERIOD_STATUSES: ReadonlySet<string> = new Set(['present', 'absent', 'late', 'excused']);

/** Shared look-ups of the period register. */
class PeriodContext {
  constructor(private readonly d: Deps) {}

  async editHours(campusId: string): Promise<number> {
    return (await this.d.coreApi.getSetting<number>('attendance.edit_window_hours', campusId)) ?? 12;
  }

  async periodWise(campusId: string, yearGroupId: string): Promise<boolean> {
    const configured = await this.d.coreApi.getSetting<string[]>('attendance.period_wise_year_groups', campusId);
    return isPeriodWise((await this.d.acaApi.yearGroup(yearGroupId))?.code, configured);
  }

  async group(groupId: string): Promise<TeachingGroupInfo> {
    const g = await this.d.acaApi.teachingGroup(groupId);
    if (!g) throw new NotFoundError('Teaching group not found', 'GROUP_NOT_FOUND');
    return g;
  }

  /** The timetable cell of the group in that period on that date. */
  async slot(group: TeachingGroupInfo, periodId: string, date: string): Promise<ScheduledSlot> {
    const [slot] = await this.d.acaApi.scheduledSlots({
      date,
      campusId: group.campusId,
      teachingGroupId: group.id,
      periodDefinitionId: periodId,
    });
    if (!slot)
      throw new InvariantError('NOT_SCHEDULED', 'The group has no lesson in this period on that date (timetable)');
    return slot;
  }

  /**
   * The teacher (or cover teacher) of the lesson needs the permission at any scope; anyone else needs it on the
   * group (own subjects) or its section (head of section), or campus-wide.
   */
  async assertAccess(permission: PermissionCode, group: TeachingGroupInfo, slot?: ScheduledSlot): Promise<void> {
    const { ctx, scopePolicy } = this.d;
    const teaches = !!ctx.staffId && !!slot && (slot.coverStaffId ?? slot.staffId) === ctx.staffId;
    if (teaches && scopePolicy.has(permission)) return;
    if (await scopePolicy.allows(permission, { campusId: group.campusId, teachingGroupId: group.id })) return;
    if (
      group.classSectionId &&
      (await scopePolicy.allows(permission, { campusId: group.campusId, classSectionId: group.classSectionId }))
    )
      return;
    throw new ForbiddenError('OUT_OF_SCOPE', 'This class is outside your access scope');
  }

  async roster(group: TeachingGroupInfo, date: string): Promise<RosterEntry[]> {
    if (group.membership === 'whole_section' && group.classSectionId)
      return this.d.sisApi.sectionRoster(group.classSectionId, date);
    return this.d.sisApi.enrolmentRoster(await this.d.acaApi.groupMembersOn(group.id, date), date);
  }

  async dailyStatuses(studentIds: string[], date: string): Promise<Map<string, DailyStatus>> {
    const marks = await this.d.attRepo.marksFor(studentIds, date);
    return new Map([...marks].map(([id, m]) => [id, m.status]));
  }
}

export interface PeriodRegister {
  date: string;
  teachingGroupId: string;
  groupName: string;
  period: { id: string; label: string; startsAt: string; endsAt: string };
  periodWise: boolean;
  editable: boolean;
  editableUntil: Date;
  marked: boolean;
  entries: Array<{
    studentId: string;
    enrolmentId: string;
    rollNo: number | null;
    fullNameEn: string;
    fullNameBn: string | null;
    daily: DailyStatus | null;
    status: PeriodStatus | null;
    suggested: PeriodStatus;
  }>;
}

/** The teacher's day on one screen: registration classes (daily) and the lessons to mark (period-wise years). */
export class GetMyRegisters extends Query<
  { date: string },
  {
    date: string;
    daily: Array<{ classSectionId: string; name: string; students: number; marked: number; editable: boolean }>;
    periods: Array<{
      teachingGroupId: string;
      groupName: string;
      periodDefinitionId: string;
      label: string;
      startsAt: string;
      endsAt: string;
      cover: boolean;
      students: number;
      marked: number;
      editable: boolean;
    }>;
  }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle({ date }: { date: string }) {
    const { ctx, scopePolicy, acaApi, sisApi, attRepo, clock } = this.d;
    if (!scopePolicy.has('att.daily.edit') && !scopePolicy.has('att.period.edit'))
      throw new ForbiddenError('FORBIDDEN', 'Missing permission att.daily.edit or att.period.edit');
    if (!ctx.staffId) return { date, daily: [], periods: [] };
    const pc = new PeriodContext(this.d);
    const year = await this.d.coreApi.yearFor(date);

    const daily = [];
    if (scopePolicy.has('att.daily.edit'))
      for (const sectionId of await acaApi.sectionsOfClassTeacher(ctx.staffId)) {
        const s = await acaApi.sectionInfo(sectionId);
        if (!s || (year && s.academicYearId !== year.id)) continue;
        const roster = await sisApi.sectionRoster(sectionId, date);
        const marks = await attRepo.marksFor(
          roster.map((r) => r.studentId),
          date,
        );
        daily.push({
          classSectionId: sectionId,
          name: s.displayName,
          students: roster.length,
          marked: marks.size,
          editable: editWindow(date, clock.now(), await pc.editHours(s.campusId)).state === 'open',
        });
      }

    const periods = [];
    if (scopePolicy.has('att.period.edit')) {
      const slots = (await acaApi.scheduledSlots({ date, staffId: ctx.staffId })).filter((s) => s.kind === 'teaching');
      const counts = await this.d.periodAttRepo.markCounts(date, slots);
      for (const s of slots) {
        if (!(await pc.periodWise(s.campusId, s.yearGroupId))) continue;
        const group = await pc.group(s.teachingGroupId);
        periods.push({
          teachingGroupId: s.teachingGroupId,
          groupName: s.groupName,
          periodDefinitionId: s.periodDefinitionId,
          label: s.label,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          cover: s.coverStaffId === ctx.staffId,
          students: (await pc.roster(group, date)).length,
          marked: counts.get(`${s.teachingGroupId}|${s.periodDefinitionId}`) ?? 0,
          editable: editWindow(date, clock.now(), await pc.editHours(s.campusId)).state === 'open',
        });
      }
    }
    return { date, daily, periods };
  }
}

/** Period register of one lesson, pre-filled from the day's register (absent stays absent, leave -> excused). */
export class GetPeriodRegister extends Query<{ groupId: string; periodId: string; date: string }, PeriodRegister> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { groupId: string; periodId: string; date: string }): Promise<PeriodRegister> {
    const pc = new PeriodContext(this.d);
    const group = await pc.group(i.groupId);
    const slot = await pc.slot(group, i.periodId, i.date);
    await pc.assertAccess('att.period.view', group, slot);
    const roster = await pc.roster(group, i.date);
    const ids = roster.map((r) => r.studentId);
    const daily = await pc.dailyStatuses(ids, i.date);
    const marks = new Map(
      (await this.d.periodAttRepo.periodMarks({ date: i.date, studentIds: ids, periodDefinitionId: i.periodId }))
        .filter((m) => m.teachingGroupId === group.id)
        .map((m) => [m.studentId, m.status]),
    );
    const window = editWindow(i.date, this.d.clock.now(), await pc.editHours(group.campusId));
    return {
      date: i.date,
      teachingGroupId: group.id,
      groupName: group.name,
      period: { id: slot.periodDefinitionId, label: slot.label, startsAt: slot.startsAt, endsAt: slot.endsAt },
      periodWise: await pc.periodWise(group.campusId, group.yearGroupId),
      editable: window.state === 'open',
      editableUntil: window.editableUntil,
      marked: marks.size > 0,
      entries: roster.map((r) => ({
        studentId: r.studentId,
        enrolmentId: r.enrolmentId,
        rollNo: r.rollNo,
        fullNameEn: r.fullNameEn,
        fullNameBn: r.fullNameBn,
        daily: daily.get(r.studentId) ?? null,
        status: marks.get(r.studentId) ?? null,
        suggested: suggestPeriodStatus(daily.get(r.studentId)),
      })),
    };
  }
}

/**
 * Marks one lesson. With `markRest` only the exceptions are sent. Only changed rows are written (edits are audited);
 * a student absent from the lesson but present at school that day alerts the guardian once per period.
 */
export class MarkPeriodAttendance extends UseCase<
  {
    groupId: string;
    periodId: string;
    date: string;
    markRest: boolean;
    entries: Array<{ studentId: string; status: PeriodStatus }>;
  },
  { date: string; present: number; absent: number; late: number; excused: number; changed: number; alerts: number }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: {
    groupId: string;
    periodId: string;
    date: string;
    markRest: boolean;
    entries: Array<{ studentId: string; status: PeriodStatus }>;
  }) {
    const { ctx, clock } = this.d;
    const pc = new PeriodContext(this.d);
    const group = await pc.group(i.groupId);
    const slot = await pc.slot(group, i.periodId, i.date);
    await pc.assertAccess('att.period.edit', group, slot);
    if (slot.kind !== 'teaching') throw new InvariantError('NOT_A_LESSON', `${slot.label} is not a teaching period`);
    if (!(await pc.periodWise(group.campusId, group.yearGroupId)))
      throw new InvariantError(
        'PERIOD_WISE_NOT_ENABLED',
        'This year group takes daily attendance only (setting attendance.period_wise_year_groups)',
      );
    assertWithinEditWindow(i.date, clock.now(), await pc.editHours(group.campusId));
    const day = await this.d.coreApi.isSchoolDay(group.campusId, i.date);
    if (!day.schoolDay)
      throw new InvariantError('NOT_A_SCHOOL_DAY', `${i.date} is not a school day (${day.holiday ?? day.reason})`);
    if (clock.now() < new Date(`${i.date}T${slot.startsAt}+06:00`))
      throw new InvariantError('PERIOD_NOT_STARTED', `${slot.label} starts at ${slot.startsAt.slice(0, 5)}`);

    const roster = await pc.roster(group, i.date);
    const byStudent = new Map(roster.map((r) => [r.studentId, r]));
    const unknown = i.entries.filter((e) => !byStudent.has(e.studentId));
    if (unknown.length)
      throw new InvariantError('STUDENT_NOT_IN_GROUP', `${unknown.length} student(s) are not in this teaching group`);
    const ids = roster.map((r) => r.studentId);
    const daily = await pc.dailyStatuses(ids, i.date);
    const entries = expandQuickMark(
      roster.map((r) => ({ studentId: r.studentId, suggested: suggestPeriodStatus(daily.get(r.studentId)) })),
      i.entries,
      i.markRest,
    );

    const before = new Map(
      (
        await this.d.periodAttRepo.periodMarks({
          date: i.date,
          studentIds: entries.map((e) => e.studentId),
          periodDefinitionId: i.periodId,
        })
      ).map((m) => [m.studentId, m]),
    );
    const clash = entries.filter((e) => {
      const m = before.get(e.studentId);
      return m && m.teachingGroupId !== group.id;
    });
    if (clash.length)
      throw new ConflictError(
        'PERIOD_MARKED_IN_OTHER_GROUP',
        `${clash.length} student(s) are already marked in another group for this period`,
      );
    const changed = entries.filter((e) => before.get(e.studentId)?.status !== e.status);
    await this.d.periodAttRepo.upsertPeriodMarks(
      changed.map((e) => ({
        orgId: ctx.orgId,
        campusId: group.campusId,
        date: i.date,
        periodDefinitionId: i.periodId,
        teachingGroupId: group.id,
        studentId: e.studentId,
        status: e.status,
        source: before.has(e.studentId) ? 'correction' : 'teacher',
        markedBy: ctx.userId,
      })),
    );

    const alerts = changed.filter((e) => missedPeriod(daily.get(e.studentId), e.status));
    const events = [];
    for (const e of alerts) {
      const r = byStudent.get(e.studentId)!;
      const enrolment = await this.d.sisApi.activeEnrolment(e.studentId, i.date);
      const section = enrolment ? await this.d.acaApi.sectionInfo(enrolment.classSectionId) : null;
      events.push({
        type: 'att.student_missed_period.v1' as const,
        aggregateType: 'student',
        aggregateId: e.studentId,
        orgId: ctx.orgId,
        campusId: group.campusId,
        occurredAt: clock.now(),
        payload: {
          studentId: e.studentId,
          studentName: r.fullNameEn,
          studentNameBn: r.fullNameBn,
          date: i.date,
          periodDefinitionId: i.periodId,
          periodLabel: slot.label,
          groupName: group.name,
          sectionName: section?.displayName ?? '',
        },
      });
    }
    await this.d.outbox.write(events);
    const count = (s: PeriodStatus) => entries.filter((e) => e.status === s).length;
    return {
      date: i.date,
      present: count('present'),
      absent: count('absent'),
      late: count('late'),
      excused: count('excused'),
      changed: changed.length,
      alerts: alerts.length,
    };
  }
}

/** Class teacher's view of a day: daily mark and every lesson mark per student, with missed lessons counted. */
export class GetSectionDay extends Query<
  { sectionId: string; date: string },
  {
    date: string;
    classSectionId: string;
    sectionName: string;
    periods: Array<{ periodDefinitionId: string; label: string; startsAt: string }>;
    students: Array<{
      studentId: string;
      rollNo: number | null;
      fullNameEn: string;
      daily: DailyStatus | null;
      periods: Record<string, { status: PeriodStatus; teachingGroupId: string }>;
      missedPeriods: number;
    }>;
  }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle({ sectionId, date }: { sectionId: string; date: string }) {
    const section = await this.d.acaApi.sectionInfo(sectionId);
    if (!section) throw new NotFoundError('Class section not found', 'SECTION_NOT_FOUND');
    await this.d.scopePolicy.assert('att.daily.view', { campusId: section.campusId, classSectionId: sectionId });
    const pc = new PeriodContext(this.d);
    const roster = await this.d.sisApi.sectionRoster(sectionId, date);
    const ids = roster.map((r) => r.studentId);
    const daily = await pc.dailyStatuses(ids, date);
    const marks = await this.d.periodAttRepo.periodMarks({ date, studentIds: ids });
    const campusSlots = await this.d.acaApi.scheduledSlots({ date, campusId: section.campusId });
    const labels = new Map(campusSlots.map((s) => [s.periodDefinitionId, s]));
    const columnIds = new Set([
      ...campusSlots
        .filter((s) => s.classSectionId === sectionId && s.kind === 'teaching')
        .map((s) => s.periodDefinitionId),
      ...marks.map((m) => m.periodDefinitionId),
    ]);
    const periods = [...columnIds]
      .map((id) => ({
        periodDefinitionId: id,
        label: labels.get(id)?.label ?? '',
        startsAt: labels.get(id)?.startsAt ?? '',
      }))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return {
      date,
      classSectionId: sectionId,
      sectionName: section.displayName,
      periods,
      students: roster.map((r) => {
        const own = marks.filter((m) => m.studentId === r.studentId);
        const d = daily.get(r.studentId);
        return {
          studentId: r.studentId,
          rollNo: r.rollNo,
          fullNameEn: r.fullNameEn,
          daily: d ?? null,
          periods: Object.fromEntries(
            own.map((m) => [m.periodDefinitionId, { status: m.status, teachingGroupId: m.teachingGroupId }]),
          ),
          missedPeriods: own.filter((m) => missedPeriod(d, m.status)).length,
        };
      }),
    };
  }
}

// ------------------------------------------------------------------------------------------------------------------
// corrections (after the edit window) and history
// ------------------------------------------------------------------------------------------------------------------

type CorrectionTarget =
  | { kind: 'daily'; campusId: string; classSectionId: string; enrolmentId: string }
  | { kind: 'period'; campusId: string; group: TeachingGroupInfo; slot?: ScheduledSlot };

async function assertCorrectionAccess(d: Deps, permission: PermissionCode, t: CorrectionTarget): Promise<void> {
  if (t.kind === 'daily')
    return d.scopePolicy.assert(permission, { campusId: t.campusId, classSectionId: t.classSectionId });
  return new PeriodContext(d).assertAccess(permission, t.group, t.slot);
}

/** A lesson mark's target: its group, and the lesson as timetabled that day (so the teacher who took it qualifies). */
async function periodTarget(
  d: Deps,
  groupId: string,
  periodId: string,
  date: string,
): Promise<CorrectionTarget & { kind: 'period' }> {
  const group = await new PeriodContext(d).group(groupId);
  const [slot] = await d.acaApi.scheduledSlots({
    date,
    campusId: group.campusId,
    teachingGroupId: group.id,
    periodDefinitionId: periodId,
  });
  return { kind: 'period', campusId: group.campusId, group, ...(slot ? { slot } : {}) };
}

async function dailyTarget(d: Deps, studentId: string, date: string): Promise<CorrectionTarget & { kind: 'daily' }> {
  const enrolment = await d.sisApi.activeEnrolment(studentId, date);
  if (!enrolment) throw new InvariantError('NOT_ENROLLED', 'Student was not enrolled on that date');
  return {
    kind: 'daily',
    campusId: enrolment.campusId,
    classSectionId: enrolment.classSectionId,
    enrolmentId: enrolment.id,
  };
}

/** A change to a mark whose edit window has closed; applied when someone else approves it. */
export class RequestAttendanceCorrection extends UseCase<
  {
    kind: 'daily' | 'period';
    studentId: string;
    date: string;
    periodDefinitionId?: string;
    newStatus: string;
    reason: string;
  },
  CorrectionRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: {
    kind: 'daily' | 'period';
    studentId: string;
    date: string;
    periodDefinitionId?: string;
    newStatus: string;
    reason: string;
  }) {
    const pc = new PeriodContext(this.d);
    let target: CorrectionTarget;
    let oldStatus: string | null;
    if (i.kind === 'daily') {
      if (i.periodDefinitionId) throw new InvariantError('PERIOD_NOT_ALLOWED', 'A daily correction has no period');
      target = await dailyTarget(this.d, i.studentId, i.date);
      oldStatus = (await this.d.attRepo.marksFor([i.studentId], i.date)).get(i.studentId)?.status ?? null;
    } else {
      if (!i.periodDefinitionId) throw new InvariantError('PERIOD_REQUIRED', 'periodDefinitionId is required');
      if (!PERIOD_STATUSES.has(i.newStatus))
        throw new InvariantError('STATUS_INVALID', 'A lesson mark is present, absent, late or excused');
      const [mark] = await this.d.periodAttRepo.periodMarks({
        date: i.date,
        studentIds: [i.studentId],
        periodDefinitionId: i.periodDefinitionId,
      });
      if (!mark) throw new NotFoundError('No lesson mark to correct', 'PERIOD_MARK_NOT_FOUND');
      target = await periodTarget(this.d, mark.teachingGroupId, i.periodDefinitionId, i.date);
      oldStatus = mark.status;
    }
    await assertCorrectionAccess(this.d, 'att.correction.create', target);
    const window = editWindow(i.date, this.d.clock.now(), await pc.editHours(target.campusId));
    if (window.state === 'future') throw new InvariantError('ATTENDANCE_FUTURE_DATE', 'The date is in the future');
    if (window.state === 'open')
      throw new InvariantError('EDIT_WINDOW_OPEN', 'The register is still editable; change the mark directly');
    if (oldStatus === i.newStatus) throw new InvariantError('NO_CHANGE', `The mark is already ${i.newStatus}`);

    return this.d.periodAttRepo.insertCorrection({
      orgId: this.d.ctx.orgId,
      campusId: target.campusId,
      kind: i.kind,
      studentId: i.studentId,
      attendanceDate: i.date,
      classSectionId: target.kind === 'daily' ? target.classSectionId : target.group.classSectionId,
      teachingGroupId: target.kind === 'period' ? target.group.id : null,
      periodDefinitionId: i.periodDefinitionId ?? null,
      oldStatus,
      newStatus: i.newStatus,
      reason: i.reason.trim(),
      requestedBy: this.d.ctx.userId,
    });
  }
}

/** Approve (applies the change as source = correction, audited) or reject. Never by the requester. */
export class DecideAttendanceCorrection extends UseCase<
  { id: string; decision: 'approved' | 'rejected'; note?: string },
  CorrectionRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { id: string; decision: 'approved' | 'rejected'; note?: string }) {
    const { ctx, clock } = this.d;
    const c = await this.d.periodAttRepo.correctionForUpdate(i.id);
    if (!c) throw new NotFoundError('Correction not found', 'CORRECTION_NOT_FOUND');
    const target: CorrectionTarget =
      c.kind === 'daily'
        ? await dailyTarget(this.d, c.studentId, c.attendanceDate)
        : await periodTarget(this.d, c.teachingGroupId!, c.periodDefinitionId!, c.attendanceDate);
    await assertCorrectionAccess(this.d, 'att.correction.approve', target);
    assertCorrectionDecidable(c, ctx.userId!);

    if (i.decision === 'approved') {
      if (target.kind === 'daily') {
        const current = (await this.d.attRepo.marksFor([c.studentId], c.attendanceDate)).get(c.studentId);
        if ((current?.status ?? null) !== c.oldStatus)
          throw new ConflictError('MARK_CHANGED', 'The mark changed after the request; reject it and ask again');
        await this.d.attRepo.upsertMarks([
          {
            orgId: ctx.orgId,
            campusId: target.campusId,
            classSectionId: target.classSectionId,
            date: c.attendanceDate,
            studentId: c.studentId,
            enrolmentId: target.enrolmentId,
            status: c.newStatus as DailyStatus,
            remarks: `Correction: ${c.reason}`.slice(0, 200),
            source: 'correction',
            markedBy: ctx.userId,
          },
        ]);
      } else {
        const [current] = await this.d.periodAttRepo.periodMarks({
          date: c.attendanceDate,
          studentIds: [c.studentId],
          periodDefinitionId: c.periodDefinitionId!,
        });
        if ((current?.status ?? null) !== c.oldStatus)
          throw new ConflictError('MARK_CHANGED', 'The mark changed after the request; reject it and ask again');
        await this.d.periodAttRepo.upsertPeriodMarks([
          {
            orgId: ctx.orgId,
            campusId: target.campusId,
            date: c.attendanceDate,
            periodDefinitionId: c.periodDefinitionId!,
            teachingGroupId: c.teachingGroupId!,
            studentId: c.studentId,
            status: c.newStatus as PeriodStatus,
            source: 'correction',
            markedBy: ctx.userId,
          },
        ]);
      }
    }
    const decidedAt = clock.now();
    await this.d.periodAttRepo.setCorrectionStatus(c.id, {
      status: i.decision,
      decidedBy: ctx.userId!,
      decidedAt,
      decisionNote: i.note ?? null,
    });
    const student = (await this.d.sisApi.studentBriefs([c.studentId])).get(c.studentId);
    await this.d.outbox.write([
      {
        type: 'att.correction_decided.v1',
        aggregateType: 'attendance_correction',
        aggregateId: c.id,
        orgId: ctx.orgId,
        campusId: c.campusId,
        occurredAt: decidedAt,
        payload: {
          correctionId: c.id,
          requestedBy: c.requestedBy,
          studentName: student?.fullNameEn ?? '',
          date: c.attendanceDate,
          kind: c.kind,
          newStatus: c.newStatus,
          decision: i.decision,
          note: i.note ?? null,
        },
      },
    ]);
    return { ...c, status: i.decision, decidedBy: ctx.userId!, decidedAt, decisionNote: i.note ?? null };
  }
}

/** The requester withdraws a pending correction. */
export class CancelAttendanceCorrection extends UseCase<{ id: string }, { status: 'cancelled' }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle({ id }: { id: string }) {
    const c = await this.d.periodAttRepo.correctionForUpdate(id);
    if (!c || c.requestedBy !== this.d.ctx.userId)
      throw new NotFoundError('Correction not found', 'CORRECTION_NOT_FOUND');
    if (c.status !== 'pending')
      throw new InvariantError('CORRECTION_ALREADY_DECIDED', `The correction is already ${c.status}`);
    await this.d.periodAttRepo.setCorrectionStatus(id, { status: 'cancelled' });
    return { status: 'cancelled' as const };
  }
}

/** Approvers see the campus queue; everyone else sees their own requests. */
export class ListAttendanceCorrections extends Query<
  { status?: string; studentId?: string; date?: string; mine?: boolean },
  Array<CorrectionRow & { studentName: string | null }>
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { status?: string; studentId?: string; date?: string; mine?: boolean }) {
    const { scopePolicy, ctx } = this.d;
    if (!scopePolicy.has('att.correction.approve') && !scopePolicy.has('att.correction.create'))
      throw new ForbiddenError('FORBIDDEN', 'Missing permission att.correction.create');
    const mine = i.mine || !scopePolicy.has('att.correction.approve');
    const rows = await this.d.periodAttRepo.corrections({
      status: i.status,
      studentId: i.studentId,
      date: i.date,
      campusId: ctx.activeCampusId,
      requestedBy: mine ? ctx.userId! : undefined,
      limit: 500,
    });
    const visible = [];
    for (const r of rows)
      if (
        mine ||
        (await scopePolicy.allows('att.correction.approve', {
          campusId: r.campusId,
          ...(r.teachingGroupId ? { teachingGroupId: r.teachingGroupId } : { classSectionId: r.classSectionId! }),
        })) ||
        (r.classSectionId &&
          (await scopePolicy.allows('att.correction.approve', {
            campusId: r.campusId,
            classSectionId: r.classSectionId,
          })))
      )
        visible.push(r);
    const names = await this.d.sisApi.studentBriefs([...new Set(visible.map((r) => r.studentId))]);
    return visible.map((r) => ({ ...r, studentName: names.get(r.studentId)?.fullNameEn ?? null }));
  }
}

/** Every recorded change to a student's marks on a date: who changed what, when, from what to what, and why. */
export class GetMarkHistory extends Query<
  { studentId: string; date: string },
  {
    studentId: string;
    date: string;
    daily: { status: DailyStatus; remarks: string | null } | null;
    periods: PeriodMark[];
    changes: Array<{
      at: Date;
      by: string | null;
      register: 'daily' | 'period';
      periodDefinitionId: string | null;
      action: string;
      from: string | null;
      to: string | null;
      source: string | null;
      changed: string[];
    }>;
    corrections: CorrectionRow[];
  }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle({ studentId, date }: { studentId: string; date: string }) {
    const brief = (await this.d.sisApi.studentBriefs([studentId])).get(studentId);
    if (!brief) throw new NotFoundError();
    const target = { campusId: brief.campusId, studentId };
    let allowed = false;
    for (const p of ['att.daily.view', 'att.period.view', 'att.correction.approve'] as const)
      if (!allowed && (await this.d.scopePolicy.allows(p, target))) allowed = true;
    if (!allowed) throw new ForbiddenError('OUT_OF_SCOPE', 'This student is outside your access scope');

    const daily = (await this.d.attRepo.marksFor([studentId], date)).get(studentId);
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    return {
      studentId,
      date,
      daily: daily ? { status: daily.status, remarks: daily.remarks } : null,
      periods: await this.d.periodAttRepo.periodMarks({ date, studentIds: [studentId] }),
      changes: (await this.d.periodAttRepo.history(studentId, date)).map((e) => ({
        at: e.occurredAt,
        by: e.actorUserId,
        register: e.table === 'period_attendance' ? ('period' as const) : ('daily' as const),
        periodDefinitionId: str((e.after ?? e.before)?.period_definition_id),
        action: e.action,
        from: str(e.before?.status),
        to: str(e.after?.status),
        source: str(e.after?.source),
        changed: e.changedCols,
      })),
      corrections: await this.d.periodAttRepo.corrections({ studentId, date, limit: 50 }),
    };
  }
}
