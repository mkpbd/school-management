import type { EventPublisher, NumberAllocator, TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { ConflictError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import type { FilesModuleApi } from '../../platform/public-api/FilesModuleApi.js';

export interface CpdSessionRow {
  id: string;
  campusId: string;
  courseId: string;
  title: string;
  hours: number;
  startsAt: Date;
  endsAt: Date;
  venue: string | null;
  trainer: string | null;
  capacity: number;
  status: 'scheduled' | 'completed' | 'cancelled';
  registered: number;
}

export interface CpdRecordRow {
  id: string;
  staffId: string;
  staffName: string;
  title: string;
  provider: string | null;
  completedOn: string;
  hours: number;
  source: 'session' | 'external';
  sessionId: string | null;
  certificateNo: string | null;
  certificateFileId: string | null;
  verifiedAt: Date | null;
}

export interface CpdRepository {
  course(id: string): Promise<{ id: string; title: string; hours: number; isActive: boolean } | null>;
  insertSession(values: Record<string, unknown>): Promise<string>;
  session(id: string, forUpdate: boolean): Promise<CpdSessionRow | null>;
  sessions(f: { campusId?: string; from?: Date; to?: Date; status?: string }): Promise<CpdSessionRow[]>;
  setSessionStatus(id: string, status: CpdSessionRow['status']): Promise<void>;
  /** registrations of the session become cancelled; returns the staff who were registered */
  cancelRegistrations(sessionId: string): Promise<string[]>;
  registrations(
    sessionId: string,
  ): Promise<Array<{ staffId: string; staffNo: string; name: string; status: string; registeredAt: Date }>>;
  attendance(sessionId: string): Promise<Array<{ staffId: string; status: string }>>;
  register(v: { sessionId: string; staffId: string; orgId: string; campusId: string }): Promise<boolean>;
  markAttendance(sessionId: string, staffId: string, status: 'attended' | 'absent', at: Date): Promise<boolean>;
  insertRecord(values: Record<string, unknown>): Promise<string>;
  record(id: string): Promise<CpdRecordRow | null>;
  records(f: { staffId?: string; from: string; to: string; pendingOnly?: boolean }): Promise<CpdRecordRow[]>;
  verifyRecord(id: string, by: string, at: Date): Promise<boolean>;
  staffCampus(staffId: string): Promise<string | null>;
  hoursByStaff(f: {
    campusId?: string;
    from: string;
    to: string;
  }): Promise<Array<{ staffId: string; staffNo: string; name: string; verifiedHours: number; pendingHours: number }>>;
}

export interface CpdCertificate {
  school: string;
  staffName: string;
  title: string;
  hours: number;
  completedOn: string;
  certificateNo: string;
  trainer: string | null;
}

/** Port: CPD certificate as PDF (infrastructure: pdfkit). */
export interface CpdCertificateRenderer {
  render(c: CpdCertificate): Promise<Buffer>;
}

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  cpdRepo: CpdRepository;
  scopePolicy: ScopePolicy;
  numbers: NumberAllocator;
  filesApi: FilesModuleApi;
  coreApi: CoreModuleApi;
  cpdCertificates: CpdCertificateRenderer;
  outbox: EventPublisher;
}

const yearRange = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` });

/** Self (a staff login), or someone with the permission on the staff member's campus. */
async function forStaff(
  d: Deps,
  staffId: string | undefined,
  permission: 'hrm.cpd.create' | 'hrm.cpd.view',
): Promise<string> {
  const id = staffId ?? d.ctx.staffId;
  if (!id) throw new InvariantError('STAFF_REQUIRED', 'staffId is required');
  if (id !== d.ctx.staffId) {
    if (!d.scopePolicy.has(permission)) throw new NotFoundError();
    const campus = await d.cpdRepo.staffCampus(id);
    if (!campus) throw new NotFoundError('Staff member not found', 'STAFF_NOT_FOUND');
    d.scopePolicy.requireCampus(campus);
  }
  return id;
}

// ---------------------------------------------------------------------------------------------------------------
// Sessions: schedule -> register -> attendance -> complete (records + certificate numbers)
// ---------------------------------------------------------------------------------------------------------------

export class ScheduleCpdSession extends UseCase<
  {
    courseId: string;
    campusId?: string;
    startsAt: string;
    endsAt: string;
    venue?: string;
    trainer?: string;
    capacity?: number;
  },
  CpdSessionRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    courseId: string;
    campusId?: string;
    startsAt: string;
    endsAt: string;
    venue?: string;
    trainer?: string;
    capacity?: number;
  }) {
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    const course = await this.d.cpdRepo.course(i.courseId);
    if (!course || !course.isActive) throw new NotFoundError('Course not found or inactive', 'COURSE_NOT_FOUND');
    if (new Date(i.endsAt) <= new Date(i.startsAt))
      throw new InvariantError('DATE_RANGE_INVALID', 'Session ends before it starts');
    const id = await this.d.cpdRepo.insertSession({
      orgId: this.d.ctx.orgId,
      campusId,
      courseId: course.id,
      startsAt: new Date(i.startsAt),
      endsAt: new Date(i.endsAt),
      venue: i.venue ?? null,
      trainer: i.trainer ?? null,
      capacity: i.capacity ?? 30,
    });
    return (await this.d.cpdRepo.session(id, false))!;
  }
}

export class ListCpdSessions extends Query<
  { campusId?: string; from?: string; to?: string; status?: string },
  CpdSessionRow[]
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { campusId?: string; from?: string; to?: string; status?: string }) {
    return this.d.cpdRepo.sessions({
      campusId: i.campusId,
      status: i.status,
      from: i.from ? new Date(i.from) : undefined,
      to: i.to ? new Date(i.to) : undefined,
    });
  }
}

/** A teacher registers themself (or HR registers them); capacity is enforced under a session row lock. */
export class RegisterForCpdSession extends UseCase<
  { sessionId: string; staffId?: string },
  { registered: number; capacity: number }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { sessionId: string; staffId?: string }) {
    const staffId = await forStaff(this.d, i.staffId, 'hrm.cpd.create');
    const s = await this.d.cpdRepo.session(i.sessionId, true);
    if (!s) throw new NotFoundError();
    if (s.status !== 'scheduled') throw new ConflictError('SESSION_CLOSED', `Session is ${s.status}`);
    if (s.startsAt <= this.d.clock.now())
      throw new ConflictError('SESSION_STARTED', 'Registration closed: the session has started');
    if (s.registered >= s.capacity) throw new ConflictError('SESSION_FULL', `All ${s.capacity} places are taken`);
    if (!(await this.d.cpdRepo.register({ sessionId: s.id, staffId, orgId: this.d.ctx.orgId, campusId: s.campusId })))
      throw new ConflictError('ALREADY_REGISTERED', 'Already registered for this session');
    return { registered: s.registered + 1, capacity: s.capacity };
  }
}

export class MarkCpdAttendance extends UseCase<
  { sessionId: string; entries: Array<{ staffId: string; status: 'attended' | 'absent' }> },
  { marked: number }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { sessionId: string; entries: Array<{ staffId: string; status: 'attended' | 'absent' }> }) {
    const s = await this.d.cpdRepo.session(i.sessionId, true);
    if (!s) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(s.campusId);
    if (s.status !== 'scheduled') throw new ConflictError('SESSION_CLOSED', `Session is ${s.status}`);
    let marked = 0;
    for (const e of i.entries) {
      if (!(await this.d.cpdRepo.markAttendance(s.id, e.staffId, e.status, this.d.clock.now())))
        throw new InvariantError('NOT_REGISTERED', 'A staff member is not registered for this session');
      marked++;
    }
    return { marked };
  }
}

/** Who registered for a session and their attendance mark (to mark attendance and print the sign-in sheet). */
export class ListCpdRegistrations extends Query<
  { sessionId: string },
  Array<{ staffId: string; staffNo: string; name: string; status: string; registeredAt: Date }>
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ sessionId }: { sessionId: string }) {
    const s = await this.d.cpdRepo.session(sessionId, false);
    if (!s) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(s.campusId);
    return this.d.cpdRepo.registrations(s.id);
  }
}

/** Cancels a scheduled session: registrations are cancelled and the registered staff are told why. */
export class CancelCpdSession extends UseCase<{ sessionId: string; reason: string }, { cancelled: number }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { sessionId: string; reason: string }) {
    const { d } = this;
    const s = await d.cpdRepo.session(i.sessionId, true);
    if (!s) throw new NotFoundError();
    d.scopePolicy.requireCampus(s.campusId);
    if (s.status !== 'scheduled') throw new ConflictError('SESSION_CLOSED', `Session is ${s.status}`);
    const staffIds = await d.cpdRepo.cancelRegistrations(s.id);
    await d.cpdRepo.setSessionStatus(s.id, 'cancelled');
    if (staffIds.length)
      await d.outbox.write([
        {
          type: 'hrm.cpd_session_cancelled.v1',
          aggregateType: 'cpd_session',
          aggregateId: s.id,
          orgId: d.ctx.orgId,
          campusId: s.campusId,
          occurredAt: d.clock.now(),
          payload: { sessionId: s.id, title: s.title, startsAt: s.startsAt.toISOString(), reason: i.reason, staffIds },
        },
      ]);
    return { cancelled: staffIds.length };
  }
}

/** Completion: every attendee gets a verified CPD record with the course hours and a certificate number. */
export class CompleteCpdSession extends UseCase<{ sessionId: string }, { records: number }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ sessionId }: { sessionId: string }) {
    const { d } = this;
    const s = await d.cpdRepo.session(sessionId, true);
    if (!s) throw new NotFoundError();
    d.scopePolicy.requireCampus(s.campusId);
    if (s.status !== 'scheduled') throw new ConflictError('SESSION_CLOSED', `Session is ${s.status}`);
    const attended = (await d.cpdRepo.attendance(s.id)).filter((a) => a.status === 'attended');
    if (!attended.length) throw new InvariantError('NO_ATTENDEES', 'Mark attendance before completing the session');
    const completedOn = LocalDate.fromInstant(s.endsAt).iso;
    for (const a of attended)
      await d.cpdRepo.insertRecord({
        orgId: d.ctx.orgId,
        staffId: a.staffId,
        cpdCourseId: s.courseId,
        title: s.title,
        provider: s.trainer,
        completedOn,
        hours: String(s.hours),
        source: 'session',
        sessionId: s.id,
        certificateNo: await d.numbers.next({ campusId: null, key: 'cpd_certificate' }),
        verifiedBy: d.ctx.userId,
        verifiedAt: d.clock.now(),
      });
    await d.cpdRepo.setSessionStatus(s.id, 'completed');
    return { records: attended.length };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// External training and hours
// ---------------------------------------------------------------------------------------------------------------

export class LogExternalCpd extends UseCase<
  {
    staffId?: string;
    title: string;
    provider?: string;
    completedOn: string;
    hours: number;
    certificateFileId?: string;
  },
  CpdRecordRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    staffId?: string;
    title: string;
    provider?: string;
    completedOn: string;
    hours: number;
    certificateFileId?: string;
  }) {
    const staffId = await forStaff(this.d, i.staffId, 'hrm.cpd.create');
    if (i.completedOn > LocalDate.today(this.d.clock).iso)
      throw new InvariantError('FUTURE_DATE', 'Training is in the future');
    if (i.certificateFileId) await this.d.filesApi.requireUsable(i.certificateFileId, 'cpd_certificate');
    const id = await this.d.cpdRepo.insertRecord({
      orgId: this.d.ctx.orgId,
      staffId,
      title: i.title,
      provider: i.provider ?? null,
      completedOn: i.completedOn,
      hours: String(i.hours),
      source: 'external',
      certificateFileId: i.certificateFileId ?? null,
    });
    return (await this.d.cpdRepo.record(id))!;
  }
}

export class VerifyCpdRecord extends UseCase<{ id: string }, CpdRecordRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const r = await this.d.cpdRepo.record(id);
    if (!r) throw new NotFoundError();
    if (r.staffId === this.d.ctx.staffId)
      throw new ConflictError('SELF_VERIFICATION', 'You cannot verify your own training');
    if (r.verifiedAt) throw new ConflictError('ALREADY_VERIFIED', 'Already verified');
    await this.d.cpdRepo.verifyRecord(id, this.d.ctx.userId!, this.d.clock.now());
    return (await this.d.cpdRepo.record(id))!;
  }
}

async function targetHours(d: Deps): Promise<number> {
  return (await d.coreApi.getSetting<number>('hrm.cpd_target_hours')) ?? 20;
}

export interface MyCpd {
  staffId: string;
  year: number;
  records: CpdRecordRow[];
  totals: { verifiedHours: number; pendingHours: number; targetHours: number; progressPercent: number };
}

export class GetStaffCpd extends Query<{ staffId?: string; year: number }, MyCpd> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { staffId?: string; year: number }) {
    const staffId = await forStaff(this.d, i.staffId, 'hrm.cpd.view');
    const records = await this.d.cpdRepo.records({ staffId, ...yearRange(i.year) });
    const verified = records.filter((r) => r.verifiedAt).reduce((s, r) => s + r.hours, 0);
    const pending = records.filter((r) => !r.verifiedAt).reduce((s, r) => s + r.hours, 0);
    const target = await targetHours(this.d);
    return {
      staffId,
      year: i.year,
      records,
      totals: {
        verifiedHours: verified,
        pendingHours: pending,
        targetHours: target,
        progressPercent: Math.min(100, Math.round((verified / target) * 100)),
      },
    };
  }
}

/** Every staff member's verified hours against the target (who is behind). */
export class CpdSummary extends Query<
  { campusId?: string; year: number },
  {
    year: number;
    targetHours: number;
    rows: Array<{
      staffId: string;
      staffNo: string;
      name: string;
      verifiedHours: number;
      pendingHours: number;
      met: boolean;
    }>;
  }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { campusId?: string; year: number }) {
    const target = await targetHours(this.d);
    const rows = await this.d.cpdRepo.hoursByStaff({ campusId: i.campusId, ...yearRange(i.year) });
    return { year: i.year, targetHours: target, rows: rows.map((r) => ({ ...r, met: r.verifiedHours >= target })) };
  }
}

export class ListPendingCpd extends Query<{ year: number }, CpdRecordRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { year: number }) {
    return this.d.cpdRepo.records({ ...yearRange(i.year), pendingOnly: true });
  }
}

/** Certificate of a verified session record (the staff member or CPD staff). */
export class RenderCpdCertificate extends Query<{ id: string }, { filename: string; pdf: Buffer }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const r = await this.d.cpdRepo.record(id);
    if (!r) throw new NotFoundError();
    await forStaff(this.d, r.staffId, 'hrm.cpd.view');
    if (!r.certificateNo || !r.verifiedAt)
      throw new ConflictError('NO_CERTIFICATE', 'Certificates are issued for completed in-house sessions');
    const campus = await this.d.cpdRepo.staffCampus(r.staffId);
    const school =
      (await this.d.coreApi.getSetting<string>('org.display_name', campus)) ??
      (campus ? (await this.d.coreApi.getCampus(campus))?.nameEn : undefined) ??
      'School';
    const s = r.sessionId ? await this.d.cpdRepo.session(r.sessionId, false) : null;
    const pdf = await this.d.cpdCertificates.render({
      school,
      staffName: r.staffName,
      title: r.title,
      hours: r.hours,
      completedOn: r.completedOn,
      certificateNo: r.certificateNo,
      trainer: s?.trainer ?? r.provider,
    });
    return { filename: `cpd-certificate-${r.certificateNo}.pdf`, pdf };
  }
}
