import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { enrolment, guardian, student, studentGuardian } from '../../../shared/infrastructure/db/schema/sis.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { SisRepository } from '../application/ports.js';
import type {
  ContactPerson,
  EnrolmentSummary,
  RosterEntry,
  SisModuleApi,
  StudentBrief,
} from '../public-api/SisModuleApi.js';

const contactCols = {
  guardianId: guardian.id,
  userId: guardian.userId,
  fullNameEn: guardian.fullNameEn,
  phone: guardian.phone,
  email: guardian.email,
  locale: guardian.preferredLocale,
};

type AudienceFilter = Parameters<SisModuleApi['audienceUsers']>[0];

export class SisModuleApiImpl implements SisModuleApi {
  constructor(private readonly d: { uow: UnitOfWork; sisRepo: SisRepository }) {}

  private run<T>(fn: () => Promise<T>): Promise<T> {
    return this.d.uow.run(fn, { readOnly: !this.d.uow.isActive() });
  }

  activeEnrolment(studentId: string, onDate?: string): Promise<EnrolmentSummary | null> {
    return this.run(() => this.d.sisRepo.activeEnrolment(studentId, onDate));
  }

  sectionRoster(sectionId: string, onDate: string): Promise<RosterEntry[]> {
    return this.run(() => this.d.sisRepo.sectionRoster(sectionId, onDate));
  }

  enrolmentRoster(enrolmentIds: string[], onDate: string): Promise<RosterEntry[]> {
    return this.run(() => this.d.sisRepo.enrolmentRoster(enrolmentIds, onDate));
  }

  activeEnrolments(f: {
    campusId: string;
    academicYearId: string;
    yearGroupIds?: string[];
    onDate: string;
  }): Promise<EnrolmentSummary[]> {
    return this.run(() => {
      const where = [
        eq(enrolment.campusId, f.campusId),
        eq(enrolment.academicYearId, f.academicYearId),
        eq(enrolment.status, 'active'),
        lte(enrolment.startsOn, f.onDate),
        or(isNull(enrolment.endsOn), gte(enrolment.endsOn, f.onDate)),
      ];
      if (f.yearGroupIds?.length) where.push(inArray(enrolment.yearGroupId, f.yearGroupIds));
      return this.d.uow
        .tx()
        .select({
          id: enrolment.id,
          studentId: enrolment.studentId,
          campusId: enrolment.campusId,
          academicYearId: enrolment.academicYearId,
          classSectionId: enrolment.classSectionId,
          yearGroupId: enrolment.yearGroupId,
          rollNo: enrolment.rollNo,
          startsOn: enrolment.startsOn,
          endsOn: enrolment.endsOn,
        })
        .from(enrolment)
        .where(and(...where))
        .orderBy(enrolment.id);
    });
  }

  audienceUsers(f: AudienceFilter): Promise<{ studentUserIds: string[]; guardianUserIds: string[] }> {
    return this.run(async () => {
      const where = [
        eq(enrolment.status, 'active'),
        lte(enrolment.startsOn, f.onDate),
        or(isNull(enrolment.endsOn), gte(enrolment.endsOn, f.onDate)),
      ];
      if (f.campusId) where.push(eq(enrolment.campusId, f.campusId));
      if (f.yearGroupIds?.length) where.push(inArray(enrolment.yearGroupId, f.yearGroupIds));
      if (f.sectionIds?.length) where.push(inArray(enrolment.classSectionId, f.sectionIds));
      if (f.houseIds?.length) where.push(inArray(student.houseId, f.houseIds));
      if (f.studentIds?.length) where.push(inArray(enrolment.studentId, f.studentIds));
      const students = await this.d.uow
        .tx()
        .selectDistinct({ id: student.id, userId: student.userId })
        .from(enrolment)
        .innerJoin(student, eq(student.id, enrolment.studentId))
        .where(and(...where));
      const studentUserIds = f.students ? students.map((s) => s.userId).filter((x): x is string => !!x) : [];
      let guardianUserIds: string[] = [];
      if (f.guardians && students.length) {
        const rows = await this.d.uow
          .tx()
          .selectDistinct({ userId: guardian.userId })
          .from(studentGuardian)
          .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
          .where(
            inArray(
              studentGuardian.studentId,
              students.map((s) => s.id),
            ),
          );
        guardianUserIds = rows.map((r) => r.userId).filter((x): x is string => !!x);
      }
      return { studentUserIds: [...new Set(studentUserIds)], guardianUserIds };
    });
  }

  studentBriefs(studentIds: string[]): Promise<Map<string, StudentBrief>> {
    return this.run(async () => {
      if (!studentIds.length) return new Map();
      const rows = await this.d.uow
        .tx()
        .select({
          id: student.id,
          admissionNo: student.admissionNo,
          fullNameEn: student.fullNameEn,
          fullNameBn: student.fullNameBn,
          campusId: student.campusId,
          familyId: student.familyId,
          status: student.status,
          gender: student.gender,
        })
        .from(student)
        .where(inArray(student.id, studentIds));
      return new Map(rows.map((r) => [r.id, r]));
    });
  }

  primaryContacts(studentIds: string[]): Promise<Map<string, ContactPerson>> {
    return this.run(async () => {
      if (!studentIds.length) return new Map();
      const rows = await this.d.uow
        .tx()
        .select({ studentId: studentGuardian.studentId, ...contactCols })
        .from(studentGuardian)
        .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
        .where(
          and(
            inArray(studentGuardian.studentId, studentIds),
            eq(studentGuardian.isPrimaryContact, true),
            isNull(guardian.deletedAt),
          ),
        );
      return new Map(rows.map(({ studentId, ...c }) => [studentId, c]));
    });
  }

  feePayers(familyId: string): Promise<ContactPerson[]> {
    return this.run(() =>
      this.d.uow
        .tx()
        .selectDistinct(contactCols)
        .from(studentGuardian)
        .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
        .where(and(eq(guardian.familyId, familyId), eq(studentGuardian.isFeePayer, true), isNull(guardian.deletedAt))),
    );
  }

  isGuardianOf(guardianId: string, studentId: string): Promise<boolean> {
    return this.run(async () => (await this.d.sisRepo.childrenOfGuardian(guardianId)).includes(studentId));
  }

  childrenOfGuardian(guardianId: string): Promise<string[]> {
    return this.run(() => this.d.sisRepo.childrenOfGuardian(guardianId));
  }
}
