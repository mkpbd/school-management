import { and, asc, eq, gt, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  classSection,
  periodDefinition,
  substitution,
  teachingGroup,
  teachingGroupMember,
  teachingGroupTeacher,
  timetable,
  timetableSlot,
  yearGroup,
} from '../../../shared/infrastructure/db/schema/aca.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type {
  AcaModuleApi,
  ScheduledSlot,
  SectionInfo,
  TeachingGroupInfo,
  TeachingGroupRef,
  YearGroupInfo,
} from '../public-api/AcaModuleApi.js';

export class AcaModuleApiImpl implements AcaModuleApi {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private run<T>(fn: () => Promise<T>): Promise<T> {
    return this.d.uow.run(fn, { readOnly: !this.d.uow.isActive() });
  }

  sectionInfo(sectionId: string): Promise<SectionInfo | null> {
    return this.run(async () => {
      const [row] = await this.d.uow
        .tx()
        .select({
          id: classSection.id,
          campusId: classSection.campusId,
          academicYearId: classSection.academicYearId,
          yearGroupId: classSection.yearGroupId,
          displayName: classSection.displayName,
          classTeacherStaffId: classSection.classTeacherStaffId,
          headOfSectionStaffId: classSection.headOfSectionStaffId,
          capacity: classSection.capacity,
        })
        .from(classSection)
        .where(eq(classSection.id, sectionId));
      return row ?? null;
    });
  }

  yearGroup(yearGroupId: string): Promise<YearGroupInfo | null> {
    return this.run(async () => {
      const [row] = await this.d.uow
        .tx()
        .select({ id: yearGroup.id, code: yearGroup.code, nameEn: yearGroup.nameEn, seq: yearGroup.seq })
        .from(yearGroup)
        .where(eq(yearGroup.id, yearGroupId));
      return row ?? null;
    });
  }

  yearGroups(): Promise<YearGroupInfo[]> {
    return this.run(() =>
      this.d.uow
        .tx()
        .select({ id: yearGroup.id, code: yearGroup.code, nameEn: yearGroup.nameEn, seq: yearGroup.seq })
        .from(yearGroup)
        .orderBy(asc(yearGroup.seq)),
    );
  }

  sectionsOfClassTeacher(staffId: string): Promise<string[]> {
    return this.run(async () =>
      (
        await this.d.uow
          .tx()
          .select({ id: classSection.id })
          .from(classSection)
          .where(eq(classSection.classTeacherStaffId, staffId))
      ).map((r) => r.id),
    );
  }

  sectionsOfHeadOfSection(staffId: string): Promise<string[]> {
    return this.run(async () =>
      (
        await this.d.uow
          .tx()
          .select({ id: classSection.id })
          .from(classSection)
          .where(eq(classSection.headOfSectionStaffId, staffId))
      ).map((r) => r.id),
    );
  }

  teachingGroupsOfTeacher(staffId: string, onDate?: string): Promise<TeachingGroupRef[]> {
    const day = onDate ?? sql`current_date`;
    return this.run(() =>
      this.d.uow
        .tx()
        .select({
          id: teachingGroup.id,
          subjectId: teachingGroup.subjectId,
          classSectionId: teachingGroup.classSectionId,
          membership: teachingGroup.membership,
        })
        .from(teachingGroupTeacher)
        .innerJoin(teachingGroup, eq(teachingGroup.id, teachingGroupTeacher.teachingGroupId))
        .where(
          and(
            eq(teachingGroupTeacher.staffId, staffId),
            lte(teachingGroupTeacher.validFrom, day as string),
            or(isNull(teachingGroupTeacher.validTo), gte(teachingGroupTeacher.validTo, day as string)),
          ),
        ),
    );
  }

  teachingGroup(groupId: string): Promise<TeachingGroupInfo | null> {
    return this.run(async () => {
      const [row] = await this.d.uow
        .tx()
        .select({
          id: teachingGroup.id,
          campusId: teachingGroup.campusId,
          academicYearId: teachingGroup.academicYearId,
          subjectId: teachingGroup.subjectId,
          yearGroupId: teachingGroup.yearGroupId,
          name: teachingGroup.name,
          membership: teachingGroup.membership,
          classSectionId: teachingGroup.classSectionId,
        })
        .from(teachingGroup)
        .where(eq(teachingGroup.id, groupId));
      return row ?? null;
    });
  }

  groupMembersOn(groupId: string, onDate: string): Promise<string[]> {
    return this.run(async () =>
      (
        await this.d.uow
          .tx()
          .select({ enrolmentId: teachingGroupMember.enrolmentId })
          .from(teachingGroupMember)
          .where(
            and(
              eq(teachingGroupMember.teachingGroupId, groupId),
              lte(teachingGroupMember.joinedOn, onDate),
              or(isNull(teachingGroupMember.leftOn), gt(teachingGroupMember.leftOn, onDate)),
            ),
          )
      ).map((r) => r.enrolmentId),
    );
  }

  scheduledSlots(f: {
    date: string;
    campusId?: string;
    staffId?: string;
    teachingGroupId?: string;
    periodDefinitionId?: string;
    classSectionId?: string;
  }): Promise<ScheduledSlot[]> {
    // the latest published timetable of each campus that is in effect on the date
    const inEffect = sql`(SELECT DISTINCT ON (t.campus_id) t.id FROM aca.timetable t
      WHERE t.status = 'published' AND t.effective_from <= ${f.date}::date
        AND (t.effective_to IS NULL OR t.effective_to >= ${f.date}::date)
      ORDER BY t.campus_id, t.effective_from DESC)`;
    const where: SQL[] = [
      sql`${timetableSlot.timetableId} IN ${inEffect}`,
      eq(timetableSlot.dayOfWeek, LocalDate.parse(f.date).dayOfWeek()),
    ];
    if (f.campusId) where.push(eq(timetable.campusId, f.campusId));
    if (f.teachingGroupId) where.push(eq(timetableSlot.teachingGroupId, f.teachingGroupId));
    if (f.periodDefinitionId) where.push(eq(timetableSlot.periodDefinitionId, f.periodDefinitionId));
    if (f.classSectionId) where.push(eq(teachingGroup.classSectionId, f.classSectionId));
    if (f.staffId)
      where.push(
        or(
          and(
            eq(timetableSlot.staffId, f.staffId),
            or(isNull(substitution.coverStaffId), eq(substitution.coverStaffId, f.staffId)),
          ),
          eq(substitution.coverStaffId, f.staffId),
        )!,
      );
    return this.run(() =>
      this.d.uow
        .tx()
        .select({
          slotId: timetableSlot.id,
          campusId: timetable.campusId,
          periodDefinitionId: periodDefinition.id,
          periodNo: periodDefinition.periodNo,
          label: periodDefinition.label,
          kind: periodDefinition.kind,
          startsAt: periodDefinition.startsAt,
          endsAt: periodDefinition.endsAt,
          teachingGroupId: teachingGroup.id,
          groupName: teachingGroup.name,
          yearGroupId: teachingGroup.yearGroupId,
          classSectionId: teachingGroup.classSectionId,
          membership: teachingGroup.membership,
          staffId: timetableSlot.staffId,
          coverStaffId: substitution.coverStaffId,
        })
        .from(timetableSlot)
        .innerJoin(timetable, eq(timetable.id, timetableSlot.timetableId))
        .innerJoin(periodDefinition, eq(periodDefinition.id, timetableSlot.periodDefinitionId))
        .innerJoin(teachingGroup, eq(teachingGroup.id, timetableSlot.teachingGroupId))
        .leftJoin(
          substitution,
          and(
            eq(substitution.timetableSlotId, timetableSlot.id),
            eq(substitution.coverDate, f.date),
            inArray(substitution.status, ['assigned', 'accepted', 'completed']),
          ),
        )
        .where(and(...where))
        .orderBy(asc(periodDefinition.startsAt), asc(teachingGroup.name)),
    );
  }

  explicitMemberEnrolments(groupIds: string[]): Promise<string[]> {
    if (!groupIds.length) return Promise.resolve([]);
    return this.run(async () =>
      (
        await this.d.uow
          .tx()
          .select({ enrolmentId: teachingGroupMember.enrolmentId })
          .from(teachingGroupMember)
          .where(and(inArray(teachingGroupMember.teachingGroupId, groupIds), isNull(teachingGroupMember.leftOn)))
      ).map((r) => r.enrolmentId),
    );
  }
}
