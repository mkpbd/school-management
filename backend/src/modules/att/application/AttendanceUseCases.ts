import type { EventPublisher, TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { ConflictError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { AcaModuleApi } from '../../aca/public-api/AcaModuleApi.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import type { FilesModuleApi } from '../../platform/public-api/FilesModuleApi.js';
import type { SisModuleApi } from '../../sis/public-api/SisModuleApi.js';
import {
  ALERT_STATUSES,
  assertWithinEditWindow,
  editWindow,
  expandQuickMark,
  isPeriodWise,
  summarise,
  type AttendanceSummary,
  type DailyStatus,
} from '../domain/attendance.js';

export interface DailyMark {
  studentId: string;
  enrolmentId: string;
  status: DailyStatus;
  arrivedAt?: Date | null;
  remarks?: string | null;
  leaveRequestId?: string | null;
  source: 'teacher' | 'device' | 'import' | 'leave_auto' | 'correction';
}

export interface LeaveRow {
  id: string;
  studentId: string;
  enrolmentId: string;
  campusId: string;
  fromDate: string;
  toDate: string;
  reasonCode: string;
  reasonNote: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedByUser: string;
}

export interface AttRepository {
  marksFor(
    studentIds: string[],
    date: string,
  ): Promise<Map<string, { status: DailyStatus; arrivedAt: Date | null; remarks: string | null }>>;
  upsertMarks(
    rows: Array<
      DailyMark & { orgId: string; campusId: string; classSectionId: string; date: string; markedBy: string | null }
    >,
  ): Promise<void>;
  approvedLeaveOn(studentIds: string[], date: string): Promise<Map<string, string>>;
  countsByStatus(studentId: string, from: string, to: string): Promise<Partial<Record<DailyStatus, number>>>;
  insertLeave(values: Record<string, unknown>): Promise<LeaveRow>;
  leaveForUpdate(id: string): Promise<LeaveRow | null>;
  decideLeave(id: string, status: 'approved' | 'rejected', by: string, at: Date): Promise<void>;
  leaves(f: { studentIds?: string[]; campusId?: string; status?: string }): Promise<LeaveRow[]>;
}

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  attRepo: AttRepository;
  scopePolicy: ScopePolicy;
  sisApi: SisModuleApi;
  acaApi: AcaModuleApi;
  coreApi: CoreModuleApi;
  filesApi: FilesModuleApi;
  outbox: EventPublisher;
}

export interface RegisterSheet {
  date: string;
  classSectionId: string;
  sectionName: string;
  schoolDay: boolean;
  holiday?: string | undefined;
  marked: boolean;
  /** marks of this date can still be changed directly (else: correction request) */
  editable: boolean;
  editableUntil: Date;
  /** the year group also takes period-wise attendance */
  periodWise: boolean;
  entries: Array<{
    enrolmentId: string;
    studentId: string;
    rollNo: number | null;
    fullNameEn: string;
    fullNameBn: string | null;
    status: DailyStatus | null;
    suggested: DailyStatus;
    remarks: string | null;
  }>;
}

/** ATT-01: the register as the teacher sees it, pre-filled with approved leave. */
export class GetRegisterSheet extends Query<{ sectionId: string; date: string }, RegisterSheet> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle({ sectionId, date }: { sectionId: string; date: string }): Promise<RegisterSheet> {
    const section = await this.d.acaApi.sectionInfo(sectionId);
    if (!section) throw new NotFoundError('Class section not found', 'SECTION_NOT_FOUND');
    await this.d.scopePolicy.assert('att.daily.view', { campusId: section.campusId, classSectionId: sectionId });
    const day = await this.d.coreApi.isSchoolDay(section.campusId, date);
    const roster = await this.d.sisApi.sectionRoster(sectionId, date);
    const ids = roster.map((r) => r.studentId);
    // one transaction = one connection: queries run sequentially
    const marks = await this.d.attRepo.marksFor(ids, date);
    const leave = await this.d.attRepo.approvedLeaveOn(ids, date);
    const hours = (await this.d.coreApi.getSetting<number>('attendance.edit_window_hours', section.campusId)) ?? 12;
    const window = editWindow(date, this.d.clock.now(), hours);
    const configured = await this.d.coreApi.getSetting<string[]>(
      'attendance.period_wise_year_groups',
      section.campusId,
    );
    return {
      date,
      classSectionId: sectionId,
      sectionName: section.displayName,
      schoolDay: day.schoolDay,
      holiday: day.holiday,
      marked: marks.size > 0,
      editable: window.state === 'open',
      editableUntil: window.editableUntil,
      periodWise: isPeriodWise((await this.d.acaApi.yearGroup(section.yearGroupId))?.code, configured),
      entries: roster.map((r) => {
        const m = marks.get(r.studentId);
        return {
          ...r,
          status: m?.status ?? null,
          suggested: leave.has(r.studentId) ? 'leave' : 'present',
          remarks: m?.remarks ?? null,
        };
      }),
    };
  }
}

/**
 * ATT-01/03: marks a whole section in one call; with `markRest` the teacher sends only the exceptions and everyone
 * else is marked present (or leave, when approved leave covers the day). Only rows whose status changes are written; a change to absent/late
 * emits an event that COM turns into a guardian SMS/push (deduplicated per student and day).
 */
export class MarkDailyAttendance extends UseCase<
  {
    sectionId: string;
    date: string;
    markRest?: boolean;
    entries: Array<{ studentId: string; status: DailyStatus; arrivedAt?: string; remarks?: string }>;
  },
  { date: string; present: number; absent: number; late: number; other: number; changed: number; alerts: number }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: {
    sectionId: string;
    date: string;
    markRest?: boolean;
    entries: Array<{ studentId: string; status: DailyStatus; arrivedAt?: string; remarks?: string }>;
  }) {
    const { ctx, clock } = this.d;
    const section = await this.d.acaApi.sectionInfo(i.sectionId);
    if (!section) throw new NotFoundError('Class section not found', 'SECTION_NOT_FOUND');
    await this.d.scopePolicy.assert('att.daily.edit', { campusId: section.campusId, classSectionId: i.sectionId });
    const hours = (await this.d.coreApi.getSetting<number>('attendance.edit_window_hours', section.campusId)) ?? 12;
    assertWithinEditWindow(i.date, clock.now(), hours);
    const day = await this.d.coreApi.isSchoolDay(section.campusId, i.date);
    if (!day.schoolDay)
      throw new InvariantError('NOT_A_SCHOOL_DAY', `${i.date} is not a school day (${day.holiday ?? day.reason})`);

    const roster = await this.d.sisApi.sectionRoster(i.sectionId, i.date);
    const byStudent = new Map(roster.map((r) => [r.studentId, r]));
    const unknown = i.entries.filter((e) => !byStudent.has(e.studentId));
    if (unknown.length)
      throw new InvariantError(
        'STUDENT_NOT_IN_SECTION',
        `${unknown.length} student(s) are not on this section's roster`,
      );
    const leave = await this.d.attRepo.approvedLeaveOn(
      roster.map((r) => r.studentId),
      i.date,
    );
    const entries: Array<{ studentId: string; status: DailyStatus; arrivedAt?: string; remarks?: string }> =
      expandQuickMark(
        roster.map((r) => ({
          studentId: r.studentId,
          suggested: (leave.has(r.studentId) ? 'leave' : 'present') as DailyStatus,
        })),
        i.entries,
        i.markRest ?? false,
      );

    const before = await this.d.attRepo.marksFor(
      entries.map((e) => e.studentId),
      i.date,
    );
    const changed = entries.filter((e) => {
      const old = before.get(e.studentId);
      return !old || old.status !== e.status || (old.remarks ?? null) !== (e.remarks ?? null);
    });
    await this.d.attRepo.upsertMarks(
      changed.map((e) => ({
        orgId: ctx.orgId,
        campusId: section.campusId,
        classSectionId: section.id,
        date: i.date,
        studentId: e.studentId,
        enrolmentId: byStudent.get(e.studentId)!.enrolmentId,
        status: e.status,
        arrivedAt: e.arrivedAt ? new Date(e.arrivedAt) : null,
        remarks: e.remarks ?? null,
        leaveRequestId: e.status === 'leave' ? (leave.get(e.studentId) ?? null) : null,
        source: before.has(e.studentId) ? 'correction' : 'teacher',
        markedBy: ctx.userId,
      })),
    );

    const alerts = changed.filter((e) => ALERT_STATUSES.has(e.status) && before.get(e.studentId)?.status !== e.status);
    await this.d.outbox.write(
      alerts.map((e) => {
        const r = byStudent.get(e.studentId)!;
        return {
          type:
            e.status === 'late' ? ('att.student_marked_late.v1' as const) : ('att.student_marked_absent.v1' as const),
          aggregateType: 'student',
          aggregateId: e.studentId,
          orgId: ctx.orgId,
          campusId: section.campusId,
          occurredAt: clock.now(),
          payload: {
            studentId: e.studentId,
            studentName: r.fullNameEn,
            studentNameBn: r.fullNameBn,
            date: i.date,
            status: e.status,
            classSectionId: section.id,
            sectionName: section.displayName,
            arrivedAt: e.arrivedAt ?? null,
          },
        };
      }),
    );
    const count = (s: DailyStatus) => entries.filter((e) => e.status === s).length;
    return {
      date: i.date,
      present: count('present'),
      absent: count('absent'),
      late: count('late'),
      other: entries.length - count('present') - count('absent') - count('late'),
      changed: changed.length,
      alerts: alerts.length,
    };
  }
}

/** ATT-05: attendance % for a student over a range (default: academic year to date). */
export class GetStudentAttendanceSummary extends Query<
  { studentId: string; from?: string; to?: string },
  AttendanceSummary & { from: string; to: string }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { studentId: string; from?: string; to?: string }) {
    const enrolment = await this.d.sisApi.activeEnrolment(i.studentId);
    const briefs = await this.d.sisApi.studentBriefs([i.studentId]);
    const brief = briefs.get(i.studentId);
    if (!brief) throw new NotFoundError();
    const permission =
      this.d.ctx.userType === 'guardian' || this.d.ctx.userType === 'student' ? 'prt.portal.view' : 'att.daily.view';
    await this.d.scopePolicy.assert(permission, { campusId: brief.campusId, studentId: i.studentId });
    const to = i.to ?? LocalDate.today(this.d.clock).iso;
    const year = enrolment ? await this.d.coreApi.getYear(enrolment.academicYearId) : await this.d.coreApi.yearFor(to);
    const from = i.from ?? year?.startsOn ?? to;
    return { from, to, ...summarise(await this.d.attRepo.countsByStatus(i.studentId, from, to)) };
  }
}

/** ATT-04: guardian (or office) applies for leave; the class teacher decides. */
export class ApplyStudentLeave extends UseCase<
  {
    studentId: string;
    fromDate: string;
    toDate: string;
    reasonCode: string;
    reasonNote?: string;
    attachmentFileId?: string;
  },
  LeaveRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: {
    studentId: string;
    fromDate: string;
    toDate: string;
    reasonCode: string;
    reasonNote?: string;
    attachmentFileId?: string;
  }) {
    if (LocalDate.parse(i.toDate).isBefore(LocalDate.parse(i.fromDate)))
      throw new InvariantError('DATE_RANGE_INVALID', 'toDate is before fromDate');
    const enrolment = await this.d.sisApi.activeEnrolment(i.studentId, i.fromDate);
    if (!enrolment) throw new InvariantError('NOT_ENROLLED', 'Student is not enrolled on that date');
    await this.d.scopePolicy.assert('att.student_leave.create', {
      campusId: enrolment.campusId,
      studentId: i.studentId,
    });
    if (i.attachmentFileId) await this.d.filesApi.requireUsable(i.attachmentFileId, 'leave_attachment');
    const overlapping = await this.d.attRepo.leaves({ studentIds: [i.studentId] });
    if (
      overlapping.some(
        (l) => (l.status === 'pending' || l.status === 'approved') && l.fromDate <= i.toDate && l.toDate >= i.fromDate,
      )
    ) {
      throw new ConflictError('LEAVE_OVERLAP', 'A leave request already covers these dates');
    }
    return this.d.attRepo.insertLeave({
      orgId: this.d.ctx.orgId,
      campusId: enrolment.campusId,
      studentId: i.studentId,
      enrolmentId: enrolment.id,
      fromDate: i.fromDate,
      toDate: i.toDate,
      reasonCode: i.reasonCode,
      reasonNote: i.reasonNote ?? null,
      attachmentFileId: i.attachmentFileId ?? null,
      requestedByUser: this.d.ctx.userId,
    });
  }
}

/** Approve/reject; approval marks every school day in the range as `leave` (source leave_auto) unless already present. */
export class DecideStudentLeave extends UseCase<
  { leaveId: string; decision: 'approved' | 'rejected' },
  { status: string; daysMarked: number }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { leaveId: string; decision: 'approved' | 'rejected' }) {
    const leave = await this.d.attRepo.leaveForUpdate(i.leaveId);
    if (!leave) throw new NotFoundError();
    if (leave.status !== 'pending')
      throw new ConflictError('LEAVE_ALREADY_DECIDED', `Leave is already ${leave.status}`);
    const enrolment = await this.d.sisApi.activeEnrolment(leave.studentId, leave.fromDate);
    await this.d.scopePolicy.assert('att.student_leave.approve', {
      campusId: leave.campusId,
      studentId: leave.studentId,
      ...(enrolment ? { classSectionId: enrolment.classSectionId } : {}),
    });
    await this.d.attRepo.decideLeave(leave.id, i.decision, this.d.ctx.userId!, this.d.clock.now());

    let daysMarked = 0;
    if (i.decision === 'approved' && enrolment) {
      const rows: Parameters<AttRepository['upsertMarks']>[0] = [];
      for (
        let day = LocalDate.parse(leave.fromDate);
        !day.isAfter(LocalDate.parse(leave.toDate));
        day = day.addDays(1)
      ) {
        if (!(await this.d.coreApi.isSchoolDay(leave.campusId, day.iso)).schoolDay) continue;
        const existing = (await this.d.attRepo.marksFor([leave.studentId], day.iso)).get(leave.studentId);
        if (existing && (existing.status === 'present' || existing.status === 'late')) continue;
        rows.push({
          orgId: this.d.ctx.orgId,
          campusId: leave.campusId,
          classSectionId: enrolment.classSectionId,
          date: day.iso,
          studentId: leave.studentId,
          enrolmentId: enrolment.id,
          status: 'leave',
          leaveRequestId: leave.id,
          source: 'leave_auto',
          markedBy: this.d.ctx.userId,
        });
      }
      await this.d.attRepo.upsertMarks(rows);
      daysMarked = rows.length;
    }
    await this.d.outbox.write([
      {
        type: 'att.leave_decided.v1',
        aggregateType: 'student_leave_request',
        aggregateId: leave.id,
        orgId: this.d.ctx.orgId,
        campusId: leave.campusId,
        occurredAt: this.d.clock.now(),
        payload: {
          leaveId: leave.id,
          studentId: leave.studentId,
          decision: i.decision,
          fromDate: leave.fromDate,
          toDate: leave.toDate,
          requestedByUser: leave.requestedByUser,
        },
      },
    ]);
    return { status: i.decision, daysMarked };
  }
}

export class ListStudentLeaves extends Query<{ studentId?: string; status?: string }, LeaveRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { studentId?: string; status?: string }) {
    if (i.studentId) {
      const brief = (await this.d.sisApi.studentBriefs([i.studentId])).get(i.studentId);
      if (!brief) throw new NotFoundError();
      const permission = this.d.ctx.userType === 'guardian' ? 'att.student_leave.create' : 'att.student_leave.view';
      await this.d.scopePolicy.assert(permission, { campusId: brief.campusId, studentId: i.studentId });
      return this.d.attRepo.leaves({ studentIds: [i.studentId], status: i.status });
    }
    if (this.d.ctx.userType === 'guardian' && this.d.ctx.guardianId) {
      return this.d.attRepo.leaves({
        studentIds: await this.d.sisApi.childrenOfGuardian(this.d.ctx.guardianId),
        status: i.status,
      });
    }
    this.d.scopePolicy.grantsFor('att.student_leave.view');
    return this.d.attRepo.leaves({ status: i.status, campusId: this.d.ctx.activeCampusId });
  }
}
