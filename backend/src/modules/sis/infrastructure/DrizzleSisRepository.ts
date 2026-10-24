import { and, asc, eq, gt, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { decodeCursor, toPage, type Page } from '../../../shared/application/pagination.js';
import {
  enrolment,
  family,
  guardian,
  student,
  studentDocument,
  studentGuardian,
} from '../../../shared/infrastructure/db/schema/sis.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type {
  EnrolmentRow,
  GuardianLink,
  GuardianRow,
  SisRepository,
  StudentListItem,
  StudentRow,
  StudentSearch,
} from '../application/ports.js';

const studentCols = {
  id: student.id,
  campusId: student.campusId,
  familyId: student.familyId,
  userId: student.userId,
  admissionNo: student.admissionNo,
  firstNameEn: student.firstNameEn,
  lastNameEn: student.lastNameEn,
  fullNameEn: student.fullNameEn,
  fullNameBn: student.fullNameBn,
  preferredName: student.preferredName,
  gender: student.gender,
  dateOfBirth: student.dateOfBirth,
  nationality: student.nationality,
  religion: student.religion,
  bloodGroup: student.bloodGroup,
  motherTongue: student.motherTongue,
  previousSchool: student.previousSchool,
  hasSpecialNeeds: student.hasSpecialNeeds,
  houseId: student.houseId,
  photoFileId: student.photoFileId,
  status: student.status,
  admittedOn: student.admittedOn,
  leftOn: student.leftOn,
  hasBirthCert: sql<boolean>`${student.birthCertNoBidx} IS NOT NULL`,
  rowVersion: student.rowVersion,
};

const guardianCols = {
  id: guardian.id,
  familyId: guardian.familyId,
  userId: guardian.userId,
  fullNameEn: guardian.fullNameEn,
  fullNameBn: guardian.fullNameBn,
  phone: guardian.phone,
  altPhone: guardian.altPhone,
  email: guardian.email,
  occupationCode: guardian.occupationCode,
  preferredLocale: guardian.preferredLocale,
  rowVersion: guardian.rowVersion,
};

const enrolmentCols = {
  id: enrolment.id,
  studentId: enrolment.studentId,
  campusId: enrolment.campusId,
  academicYearId: enrolment.academicYearId,
  classSectionId: enrolment.classSectionId,
  yearGroupId: enrolment.yearGroupId,
  rollNo: enrolment.rollNo,
  status: enrolment.status,
  startsOn: enrolment.startsOn,
  endsOn: enrolment.endsOn,
};

const activeOn = (onDate: string) =>
  and(
    eq(enrolment.status, 'active'),
    lte(enrolment.startsOn, onDate),
    or(isNull(enrolment.endsOn), gte(enrolment.endsOn, onDate)),
  );

export class DrizzleSisRepository implements SisRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async findGuardianByPhone(phone: string): Promise<GuardianRow | null> {
    const [row] = await this.tx
      .select(guardianCols)
      .from(guardian)
      .where(and(eq(guardian.phone, phone), isNull(guardian.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async insertFamily(values: { orgId: string; familyCode: string }): Promise<string> {
    const [row] = await this.tx.insert(family).values(values).returning({ id: family.id });
    return row!.id;
  }

  async setBillingGuardian(familyId: string, guardianId: string): Promise<void> {
    await this.tx.update(family).set({ billingGuardianId: guardianId }).where(eq(family.id, familyId));
  }

  async insertGuardian(values: Record<string, unknown>): Promise<GuardianRow> {
    const [row] = await this.tx
      .insert(guardian)
      .values(values as typeof guardian.$inferInsert)
      .returning(guardianCols);
    return row!;
  }

  async updateGuardian(id: string, values: Record<string, unknown>, expectedVersion?: number) {
    const where = [eq(guardian.id, id), isNull(guardian.deletedAt)];
    if (expectedVersion !== undefined) where.push(eq(guardian.rowVersion, expectedVersion));
    const [row] = await this.tx
      .update(guardian)
      .set(values)
      .where(and(...where))
      .returning(guardianCols);
    if (row) return row;
    const [exists] = await this.tx.select({ id: guardian.id }).from(guardian).where(eq(guardian.id, id));
    return exists ? ('stale' as const) : null;
  }

  async linkGuardian(
    studentId: string,
    guardianId: string,
    f: { relationship: string; isPrimaryContact: boolean; isFeePayer: boolean; canPickup: boolean },
  ) {
    const values = {
      studentId,
      guardianId,
      relationship: f.relationship as 'father',
      isPrimaryContact: f.isPrimaryContact,
      isFeePayer: f.isFeePayer,
      canPickup: f.canPickup,
    };
    await this.tx
      .insert(studentGuardian)
      .values(values)
      .onConflictDoUpdate({
        target: [studentGuardian.studentId, studentGuardian.guardianId],
        set: {
          relationship: values.relationship,
          isPrimaryContact: f.isPrimaryContact,
          isFeePayer: f.isFeePayer,
          canPickup: f.canPickup,
        },
      });
  }

  async clearPrimaryContact(studentId: string): Promise<void> {
    await this.tx
      .update(studentGuardian)
      .set({ isPrimaryContact: false })
      .where(eq(studentGuardian.studentId, studentId));
  }

  async guardiansOf(studentIds: string[]): Promise<Map<string, GuardianLink[]>> {
    const out = new Map<string, GuardianLink[]>();
    if (!studentIds.length) return out;
    const rows = await this.tx
      .select({
        ...guardianCols,
        studentId: studentGuardian.studentId,
        relationship: studentGuardian.relationship,
        isPrimaryContact: studentGuardian.isPrimaryContact,
        isFeePayer: studentGuardian.isFeePayer,
        canPickup: studentGuardian.canPickup,
        portalAccess: studentGuardian.portalAccess,
      })
      .from(studentGuardian)
      .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
      .where(and(inArray(studentGuardian.studentId, studentIds), isNull(guardian.deletedAt)))
      .orderBy(sql`${studentGuardian.isPrimaryContact} DESC`, asc(guardian.fullNameEn));
    for (const { studentId, ...g } of rows) {
      const list = out.get(studentId) ?? [];
      list.push(g);
      out.set(studentId, list);
    }
    return out;
  }

  async findStudentByBirthCertBidx(bidx: Buffer) {
    const [row] = await this.tx
      .select({ id: student.id, admissionNo: student.admissionNo })
      .from(student)
      .where(and(eq(student.birthCertNoBidx, bidx), isNull(student.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async insertStudent(values: Record<string, unknown>): Promise<StudentRow> {
    const [row] = await this.tx
      .insert(student)
      .values(values as typeof student.$inferInsert)
      .returning(studentCols);
    return row as StudentRow;
  }

  async updateStudent(id: string, values: Record<string, unknown>, expectedVersion?: number) {
    const where = [eq(student.id, id), isNull(student.deletedAt)];
    if (expectedVersion !== undefined) where.push(eq(student.rowVersion, expectedVersion));
    const [row] = await this.tx
      .update(student)
      .set(values)
      .where(and(...where))
      .returning(studentCols);
    if (row) return row as StudentRow;
    return (await this.findStudent(id)) ? ('stale' as const) : null;
  }

  async findStudent(id: string): Promise<StudentRow | null> {
    const [row] = await this.tx
      .select(studentCols)
      .from(student)
      .where(and(eq(student.id, id), isNull(student.deletedAt)));
    return (row as StudentRow | undefined) ?? null;
  }

  async searchStudents(f: StudentSearch): Promise<Page<StudentListItem>> {
    const today = sql`current_date`;
    const where: SQL[] = [isNull(student.deletedAt)];
    if (f.campusId) where.push(eq(student.campusId, f.campusId));
    if (f.status) where.push(eq(student.status, f.status as 'active'));
    if (f.studentIds)
      where.push(inArray(student.id, f.studentIds.length ? f.studentIds : ['00000000-0000-0000-0000-000000000000']));
    if (f.q) where.push(ilike(student.searchText, `%${f.q.toLowerCase()}%`));
    if (f.birthCertBidx) where.push(eq(student.birthCertNoBidx, f.birthCertBidx));
    if (f.guardianPhone) {
      where.push(
        inArray(
          student.id,
          this.tx
            .select({ id: studentGuardian.studentId })
            .from(studentGuardian)
            .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
            .where(eq(guardian.phone, f.guardianPhone)),
        ),
      );
    }
    if (f.classSectionIds) where.push(inArray(enrolment.classSectionId, f.classSectionIds));
    const cursor = decodeCursor(f.cursor);
    if (cursor) where.push(gt(student.id, cursor.id));
    const rows = await this.tx
      .select({
        id: student.id,
        admissionNo: student.admissionNo,
        fullNameEn: student.fullNameEn,
        fullNameBn: student.fullNameBn,
        gender: student.gender,
        status: student.status,
        campusId: student.campusId,
        classSectionId: enrolment.classSectionId,
        rollNo: enrolment.rollNo,
      })
      .from(student)
      .leftJoin(
        enrolment,
        and(
          eq(enrolment.studentId, student.id),
          eq(enrolment.status, 'active'),
          lte(enrolment.startsOn, today as unknown as string),
          or(isNull(enrolment.endsOn), gte(enrolment.endsOn, today as unknown as string)),
        ),
      )
      .where(and(...where))
      .orderBy(asc(student.id))
      .limit(f.limit + 1);
    return toPage(rows as StudentListItem[], f.limit, (r) => ({ k: [], id: r.id }));
  }

  async activeEnrolment(studentId: string, onDate?: string): Promise<EnrolmentRow | null> {
    const day = onDate ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
    const [row] = await this.tx
      .select(enrolmentCols)
      .from(enrolment)
      .where(and(eq(enrolment.studentId, studentId), activeOn(day)))
      .limit(1);
    return row ?? null;
  }

  enrolments(studentId: string): Promise<EnrolmentRow[]> {
    return this.tx
      .select(enrolmentCols)
      .from(enrolment)
      .where(eq(enrolment.studentId, studentId))
      .orderBy(asc(enrolment.startsOn));
  }

  async lockSectionEnrolments(sectionId: string) {
    return this.tx
      .select({ rollNo: enrolment.rollNo, status: enrolment.status })
      .from(enrolment)
      .where(eq(enrolment.classSectionId, sectionId))
      .for('update');
  }

  async insertEnrolment(values: Record<string, unknown>): Promise<EnrolmentRow> {
    const [row] = await this.tx
      .insert(enrolment)
      .values(values as typeof enrolment.$inferInsert)
      .returning(enrolmentCols);
    return row!;
  }

  async endEnrolment(id: string, endsOn: string, status: string, reason: string): Promise<void> {
    await this.tx
      .update(enrolment)
      .set({ endsOn, status: status as 'transferred_out', endReason: reason })
      .where(eq(enrolment.id, id));
  }

  sectionRoster(sectionId: string, onDate: string) {
    return this.tx
      .select({
        enrolmentId: enrolment.id,
        studentId: student.id,
        rollNo: enrolment.rollNo,
        fullNameEn: sql<string>`${student.fullNameEn}`, // generated column, never null
        fullNameBn: student.fullNameBn,
        gender: student.gender,
      })
      .from(enrolment)
      .innerJoin(student, eq(student.id, enrolment.studentId))
      .where(and(eq(enrolment.classSectionId, sectionId), activeOn(onDate)))
      .orderBy(asc(enrolment.rollNo), asc(student.fullNameEn));
  }

  enrolmentRoster(enrolmentIds: string[], onDate: string) {
    if (!enrolmentIds.length) return Promise.resolve([]);
    return this.tx
      .select({
        enrolmentId: enrolment.id,
        studentId: student.id,
        rollNo: enrolment.rollNo,
        fullNameEn: sql<string>`${student.fullNameEn}`,
        fullNameBn: student.fullNameBn,
        gender: student.gender,
      })
      .from(enrolment)
      .innerJoin(student, eq(student.id, enrolment.studentId))
      .where(and(inArray(enrolment.id, enrolmentIds), activeOn(onDate)))
      .orderBy(asc(student.fullNameEn));
  }

  enrolmentsByIds(ids: string[]): Promise<EnrolmentRow[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.tx.select(enrolmentCols).from(enrolment).where(inArray(enrolment.id, ids));
  }

  async insertDocument(values: Record<string, unknown>) {
    const [row] = await this.tx
      .insert(studentDocument)
      .values(values as typeof studentDocument.$inferInsert)
      .returning({ id: studentDocument.id });
    return row!;
  }

  documents(studentId: string) {
    return this.tx
      .select({
        id: studentDocument.id,
        docType: studentDocument.docType,
        fileId: studentDocument.fileId,
        expiresOn: studentDocument.expiresOn,
        verificationStatus: studentDocument.verificationStatus,
      })
      .from(studentDocument)
      .where(and(eq(studentDocument.studentId, studentId), isNull(studentDocument.deletedAt)));
  }

  async verifyDocument(id: string, status: 'verified' | 'rejected', by: string) {
    const rows = await this.tx
      .update(studentDocument)
      .set({ verificationStatus: status, verifiedBy: by, verifiedAt: new Date() })
      .where(eq(studentDocument.id, id))
      .returning({ id: studentDocument.id });
    return rows.length > 0;
  }

  async childrenOfGuardian(guardianId: string): Promise<string[]> {
    const rows = await this.tx
      .select({ id: studentGuardian.studentId })
      .from(studentGuardian)
      .where(and(eq(studentGuardian.guardianId, guardianId), eq(studentGuardian.portalAccess, true)));
    return rows.map((r) => r.id);
  }

  async studentsInSections(sectionIds: string[], onDate: string): Promise<string[]> {
    if (!sectionIds.length) return [];
    const rows = await this.tx
      .select({ id: enrolment.studentId })
      .from(enrolment)
      .where(and(inArray(enrolment.classSectionId, sectionIds), activeOn(onDate)));
    return rows.map((r) => r.id);
  }

  async studentsInEnrolments(enrolmentIds: string[]): Promise<string[]> {
    if (!enrolmentIds.length) return [];
    return (
      await this.tx.select({ id: enrolment.studentId }).from(enrolment).where(inArray(enrolment.id, enrolmentIds))
    ).map((r) => r.id);
  }
}
