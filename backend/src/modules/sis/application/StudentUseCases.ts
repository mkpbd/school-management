import type {
  BlindIndexer,
  EventPublisher,
  FieldCipher,
  NumberAllocator,
  TransactionRunner,
} from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import type { Page } from '../../../shared/application/pagination.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { ConflictError, InvariantError, NotFoundError, StaleWriteError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { AcaModuleApi } from '../../aca/public-api/AcaModuleApi.js';
import type { IamModuleApi } from '../../iam/public-api/IamModuleApi.js';
import type { FilesModuleApi } from '../../platform/public-api/FilesModuleApi.js';
import { assertPlausibleDob, nextRollNo, normaliseGuardianFlags, type GuardianLinkInput } from '../domain/rules.js';
import type { EnrolmentRow, GuardianLink, SisRepository, StudentListItem, StudentRow } from './ports.js';
import type { SisScopes } from './SisScopes.js';

export interface GuardianInput extends GuardianLinkInput {
  fullNameEn: string;
  fullNameBn?: string;
  phone: string;
  altPhone?: string;
  email?: string;
  nid?: string;
  occupationCode?: string;
  preferredLocale?: 'en' | 'bn';
  /** create a parent-app login (phone OTP) */
  portalAccess?: boolean;
}

export interface StudentInput {
  firstNameEn: string;
  lastNameEn?: string;
  fullNameBn?: string;
  preferredName?: string;
  gender: 'male' | 'female';
  dateOfBirth: string;
  birthCertNo?: string;
  nationality?: string;
  religion?: string;
  bloodGroup?: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
  motherTongue?: string;
  previousSchool?: string;
  houseId?: string | null;
  admittedOn: string;
}

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  sisRepo: SisRepository;
  scopePolicy: ScopePolicy;
  sisScopes: SisScopes;
  numbers: NumberAllocator;
  outbox: EventPublisher;
  fieldCipher: FieldCipher;
  blindIndexer: BlindIndexer;
  iamApi: IamModuleApi;
  acaApi: AcaModuleApi;
  filesApi: FilesModuleApi;
}

/** Shared by registration and enrolment use cases. */
async function enrol(
  d: Deps,
  studentId: string,
  sectionId: string,
  startsOn: string,
  rollNo?: number,
  previousEnrolmentId?: string,
): Promise<EnrolmentRow> {
  const section = await d.acaApi.sectionInfo(sectionId);
  if (!section) throw new NotFoundError('Class section not found', 'SECTION_NOT_FOUND');
  d.scopePolicy.requireCampus(section.campusId);
  const roster = await d.sisRepo.lockSectionEnrolments(sectionId); // row lock serialises concurrent enrolments
  const active = roster.filter((r) => r.status === 'active');
  if (active.length >= section.capacity)
    throw new ConflictError('SECTION_FULL', `${section.displayName} is full (${section.capacity})`);
  const enrolment = await d.sisRepo.insertEnrolment({
    orgId: d.ctx.orgId,
    campusId: section.campusId,
    academicYearId: section.academicYearId,
    studentId,
    classSectionId: section.id,
    yearGroupId: section.yearGroupId,
    rollNo: rollNo ?? nextRollNo(active.map((r) => r.rollNo)),
    startsOn,
    previousEnrolmentId: previousEnrolmentId ?? null,
  });
  await d.sisRepo.updateStudent(studentId, { campusId: section.campusId });
  await d.outbox.write([
    {
      type: 'sis.student_enrolled.v1',
      aggregateType: 'student',
      aggregateId: studentId,
      orgId: d.ctx.orgId,
      campusId: section.campusId,
      occurredAt: d.clock.now(),
      payload: {
        studentId,
        enrolmentId: enrolment.id,
        classSectionId: section.id,
        academicYearId: section.academicYearId,
        yearGroupId: section.yearGroupId,
        startsOn,
      },
    },
  ]);
  return enrolment;
}

/**
 * SIS-01/02: registers a student with family and guardians; siblings share a family when a guardian phone matches
 * (one family login, combined fee view). Optional enrolment in a section.
 */
export class RegisterStudent extends UseCase<
  {
    campusId?: string;
    student: StudentInput;
    guardians: GuardianInput[];
    enrolment?: { classSectionId: string; rollNo?: number };
  },
  { student: StudentRow; guardians: GuardianLink[]; enrolment: EnrolmentRow | null; siblingFamily: boolean }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(input: {
    campusId?: string;
    student: StudentInput;
    guardians: GuardianInput[];
    enrolment?: { classSectionId: string; rollNo?: number };
  }) {
    const d = this.d;
    const campusId = d.scopePolicy.requireCampus(input.campusId);
    assertPlausibleDob(input.student.dateOfBirth, input.student.admittedOn);
    const guardians = normaliseGuardianFlags(input.guardians);

    const { birthCertNo, ...studentFields } = input.student;
    const birthCertBidx = birthCertNo ? d.blindIndexer.of(birthCertNo) : null;
    if (birthCertBidx) {
      const dup = await d.sisRepo.findStudentByBirthCertBidx(birthCertBidx);
      if (dup)
        throw new ConflictError(
          'DUPLICATE_STUDENT',
          `A student with this birth certificate exists (${dup.admissionNo})`,
        );
    }

    // family: re-use when any guardian phone is already known (sibling)
    let familyId: string | undefined;
    const existingGuardians = new Map<string, string>(); // phone -> guardian id
    for (const g of guardians) {
      const existing = await d.sisRepo.findGuardianByPhone(g.phone);
      if (existing) {
        familyId ??= existing.familyId;
        existingGuardians.set(g.phone, existing.id);
      }
    }
    const siblingFamily = familyId !== undefined;
    familyId ??= await d.sisRepo.insertFamily({
      orgId: d.ctx.orgId,
      familyCode: await d.numbers.next({ campusId: null, key: 'family' }),
    });

    const student = await d.sisRepo.insertStudent({
      ...studentFields,
      orgId: d.ctx.orgId,
      campusId,
      familyId,
      admissionNo: await d.numbers.next({ campusId, key: 'admission_no' }),
      birthCertNoEnc: birthCertNo ? d.fieldCipher.encrypt(birthCertNo) : null,
      birthCertNoBidx: birthCertBidx,
      status: 'active',
    });

    let billingGuardianId: string | undefined;
    for (const g of guardians) {
      let guardianId = existingGuardians.get(g.phone);
      if (!guardianId) {
        const userId =
          g.portalAccess === false
            ? null
            : (await d.iamApi.ensureGuardianAccount({ phone: g.phone, locale: g.preferredLocale ?? 'bn' })).userId;
        const row = await d.sisRepo.insertGuardian({
          orgId: d.ctx.orgId,
          familyId,
          userId,
          fullNameEn: g.fullNameEn,
          fullNameBn: g.fullNameBn ?? null,
          phone: g.phone,
          altPhone: g.altPhone ?? null,
          email: g.email ?? null,
          nidEnc: g.nid ? d.fieldCipher.encrypt(g.nid) : null,
          nidBidx: g.nid ? d.blindIndexer.of(g.nid) : null,
          occupationCode: g.occupationCode ?? null,
          preferredLocale: g.preferredLocale ?? 'bn',
        });
        guardianId = row.id;
      }
      await d.sisRepo.linkGuardian(student.id, guardianId, g);
      if (g.isFeePayer) billingGuardianId ??= guardianId;
    }
    if (billingGuardianId && !siblingFamily) await d.sisRepo.setBillingGuardian(familyId, billingGuardianId);

    const enrolment = input.enrolment
      ? await enrol(d, student.id, input.enrolment.classSectionId, input.student.admittedOn, input.enrolment.rollNo)
      : null;
    await d.outbox.write([
      {
        type: 'sis.student_registered.v1',
        aggregateType: 'student',
        aggregateId: student.id,
        orgId: d.ctx.orgId,
        campusId,
        occurredAt: d.clock.now(),
        payload: { studentId: student.id, familyId, admissionNo: student.admissionNo, siblingFamily },
      },
    ]);
    const links = (await d.sisRepo.guardiansOf([student.id])).get(student.id) ?? [];
    return { student: (await d.sisRepo.findStudent(student.id))!, guardians: links, enrolment, siblingFamily };
  }
}

export class EnrolStudent extends UseCase<
  { studentId: string; classSectionId: string; startsOn: string; rollNo?: number },
  EnrolmentRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { studentId: string; classSectionId: string; startsOn: string; rollNo?: number }) {
    const student = await this.d.sisRepo.findStudent(i.studentId);
    if (!student) throw new NotFoundError();
    if (student.status !== 'active') throw new InvariantError('STUDENT_NOT_ACTIVE', `Student is ${student.status}`);
    return enrol(this.d, i.studentId, i.classSectionId, i.startsOn, i.rollNo);
  }
}

/** SIS-04 mid-year transfer between sections/campuses: closes the placement and opens a new one (history kept). */
export class TransferStudent extends UseCase<
  { studentId: string; toClassSectionId: string; onDate: string; reason: string },
  EnrolmentRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { studentId: string; toClassSectionId: string; onDate: string; reason: string }) {
    const current = await this.d.sisRepo.activeEnrolment(i.studentId, i.onDate);
    if (!current) throw new InvariantError('NOT_ENROLLED', 'Student has no active enrolment on that date');
    if (current.classSectionId === i.toClassSectionId)
      throw new InvariantError('SAME_SECTION', 'Student is already in this section');
    if (!LocalDate.parse(i.onDate).isAfter(LocalDate.parse(current.startsOn))) {
      throw new InvariantError('TRANSFER_DATE_INVALID', 'Transfer date must be after the current placement start');
    }
    this.d.scopePolicy.requireCampus(current.campusId);
    await this.d.sisRepo.endEnrolment(
      current.id,
      LocalDate.parse(i.onDate).addDays(-1).iso,
      'transferred_out',
      i.reason,
    );
    const next = await enrol(this.d, i.studentId, i.toClassSectionId, i.onDate, undefined, current.id);
    await this.d.outbox.write([
      {
        type: 'sis.student_transferred.v1',
        aggregateType: 'student',
        aggregateId: i.studentId,
        orgId: this.d.ctx.orgId,
        campusId: next.campusId,
        occurredAt: this.d.clock.now(),
        payload: { studentId: i.studentId, fromEnrolmentId: current.id, toEnrolmentId: next.id, onDate: i.onDate },
      },
    ]);
    return next;
  }
}

export type StudentPatch = Partial<Omit<StudentInput, 'admittedOn'>> & { status?: 'active' | 'on_hold' };

export class UpdateStudent extends UseCase<{ id: string; patch: StudentPatch; expectedVersion?: number }, StudentRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { id: string; patch: StudentPatch; expectedVersion?: number }) {
    const existing = await this.d.sisRepo.findStudent(i.id);
    if (!existing) throw new NotFoundError();
    await this.d.scopePolicy.assert('sis.student.edit', { campusId: existing.campusId, studentId: i.id });
    const { birthCertNo, ...rest } = i.patch;
    const values: Record<string, unknown> = { ...rest };
    if (birthCertNo !== undefined) {
      values.birthCertNoEnc = birthCertNo ? this.d.fieldCipher.encrypt(birthCertNo) : null;
      values.birthCertNoBidx = birthCertNo ? this.d.blindIndexer.of(birthCertNo) : null;
    }
    const result = await this.d.sisRepo.updateStudent(i.id, values, i.expectedVersion);
    if (result === 'stale') throw new StaleWriteError();
    if (!result) throw new NotFoundError();
    return result;
  }
}

export interface Student360 {
  student: StudentRow;
  guardians: GuardianLink[];
  currentEnrolment: EnrolmentRow | null;
  enrolmentHistory: EnrolmentRow[];
  documents: Array<{
    id: string;
    docType: string;
    fileId: string;
    expiresOn: string | null;
    verificationStatus: string;
  }>;
}

/** SIS-01/SIS-09: profile + guardians + placement history + documents, scope-checked (guardians: own children). */
export class GetStudent extends Query<{ id: string }, Student360> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle({ id }: { id: string }) {
    const student = await this.d.sisRepo.findStudent(id);
    if (!student) throw new NotFoundError();
    const permission =
      this.d.ctx.userType === 'guardian' || this.d.ctx.userType === 'student' ? 'prt.portal.view' : 'sis.student.view';
    await this.d.scopePolicy.assert(permission, { campusId: student.campusId, studentId: id });
    // one transaction = one connection: queries run sequentially
    const guardians = await this.d.sisRepo.guardiansOf([id]);
    const history = await this.d.sisRepo.enrolments(id);
    const documents = await this.d.sisRepo.documents(id);
    const today = LocalDate.today(this.d.clock).iso;
    const current =
      history.find((e) => e.status === 'active' && e.startsOn <= today && (!e.endsOn || e.endsOn >= today)) ?? null;
    return {
      student,
      guardians: guardians.get(id) ?? [],
      currentEnrolment: current,
      enrolmentHistory: history,
      documents,
    };
  }
}

/** Search is narrowed to the caller's data scope (campus, own classes/subjects/section, own children). */
export class SearchStudents extends Query<
  {
    campusId?: string;
    classSectionId?: string;
    status?: string;
    q?: string;
    birthCertNo?: string;
    guardianPhone?: string;
    limit: number;
    cursor?: string;
  },
  Page<StudentListItem>
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: {
    campusId?: string;
    classSectionId?: string;
    status?: string;
    q?: string;
    birthCertNo?: string;
    guardianPhone?: string;
    limit: number;
    cursor?: string;
  }) {
    const narrowing = await this.d.sisScopes.narrowingFor('sis.student.view');
    const classSectionIds = i.classSectionId ? [i.classSectionId] : undefined;
    if (narrowing.kind === 'none') return { items: [], nextCursor: null };
    return this.d.sisRepo.searchStudents({
      campusId: i.campusId,
      classSectionIds,
      studentIds: narrowing.kind === 'students' ? narrowing.studentIds : undefined,
      status: i.status,
      q: i.q,
      birthCertBidx: i.birthCertNo ? this.d.blindIndexer.of(i.birthCertNo) : undefined,
      guardianPhone: i.guardianPhone,
      limit: i.limit,
      cursor: i.cursor,
    });
  }
}

export class AttachStudentDocument extends UseCase<
  { studentId: string; docType: string; fileId: string; expiresOn?: string },
  { id: string }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { studentId: string; docType: string; fileId: string; expiresOn?: string }) {
    const student = await this.d.sisRepo.findStudent(i.studentId);
    if (!student) throw new NotFoundError();
    await this.d.scopePolicy.assert('sis.document.create', { campusId: student.campusId, studentId: i.studentId });
    await this.d.filesApi.requireUsable(i.fileId, 'student_document');
    return this.d.sisRepo.insertDocument({
      orgId: this.d.ctx.orgId,
      campusId: student.campusId,
      studentId: i.studentId,
      docType: i.docType,
      fileId: i.fileId,
      expiresOn: i.expiresOn ?? null,
    });
  }
}

export class VerifyStudentDocument extends UseCase<
  { documentId: string; status: 'verified' | 'rejected' },
  { ok: true }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { documentId: string; status: 'verified' | 'rejected' }) {
    if (!(await this.d.sisRepo.verifyDocument(i.documentId, i.status, this.d.ctx.userId!))) throw new NotFoundError();
    return { ok: true as const };
  }
}

export class AddGuardian extends UseCase<{ studentId: string; guardian: GuardianInput }, GuardianLink[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }

  protected async handle(i: { studentId: string; guardian: GuardianInput }) {
    const d = this.d;
    const student = await d.sisRepo.findStudent(i.studentId);
    if (!student) throw new NotFoundError();
    await d.scopePolicy.assert('sis.guardian.create', { campusId: student.campusId, studentId: student.id });
    const g = i.guardian;
    let guardian = await d.sisRepo.findGuardianByPhone(g.phone);
    if (guardian && guardian.familyId !== student.familyId) {
      throw new ConflictError(
        'GUARDIAN_IN_OTHER_FAMILY',
        'This phone belongs to a guardian of another family; merge the families first',
      );
    }
    if (!guardian) {
      const userId =
        g.portalAccess === false
          ? null
          : (await d.iamApi.ensureGuardianAccount({ phone: g.phone, locale: g.preferredLocale ?? 'bn' })).userId;
      guardian = await d.sisRepo.insertGuardian({
        orgId: d.ctx.orgId,
        familyId: student.familyId,
        userId,
        fullNameEn: g.fullNameEn,
        fullNameBn: g.fullNameBn ?? null,
        phone: g.phone,
        email: g.email ?? null,
        nidEnc: g.nid ? d.fieldCipher.encrypt(g.nid) : null,
        nidBidx: g.nid ? d.blindIndexer.of(g.nid) : null,
        occupationCode: g.occupationCode ?? null,
        preferredLocale: g.preferredLocale ?? 'bn',
      });
    }
    if (g.isPrimaryContact) await d.sisRepo.clearPrimaryContact(student.id);
    await d.sisRepo.linkGuardian(student.id, guardian.id, {
      relationship: g.relationship,
      isPrimaryContact: !!g.isPrimaryContact,
      isFeePayer: !!g.isFeePayer,
      canPickup: g.canPickup ?? true,
    });
    return (await d.sisRepo.guardiansOf([student.id])).get(student.id) ?? [];
  }
}

export class GetSectionRoster extends Query<
  { sectionId: string; onDate: string },
  Awaited<ReturnType<SisRepository['sectionRoster']>>
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { sectionId: string; onDate: string }) {
    const section = await this.d.acaApi.sectionInfo(i.sectionId);
    if (!section) throw new NotFoundError();
    await this.d.scopePolicy.assert('sis.student.view', { campusId: section.campusId, classSectionId: i.sectionId });
    return this.d.sisRepo.sectionRoster(i.sectionId, i.onDate);
  }
}
