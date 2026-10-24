import { and, asc, count, eq, gt, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import {
  classSection,
  curriculumSubject,
  periodDefinition,
  subject,
  teachingGroup,
  teachingGroupMember,
  teachingGroupTeacher,
  timetable,
  timetableSlot,
} from '../../../shared/infrastructure/db/schema/aca.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { AcaRepository, SlotInput, TimetableSlotView } from '../application/TeachingUseCases.js';

export class DrizzleAcaRepository implements AcaRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async sectionForUpdate(sectionId: string) {
    const [row] = await this.tx
      .select({
        id: classSection.id,
        orgId: classSection.orgId,
        campusId: classSection.campusId,
        academicYearId: classSection.academicYearId,
        yearGroupId: classSection.yearGroupId,
        displayName: classSection.displayName,
      })
      .from(classSection)
      .where(eq(classSection.id, sectionId))
      .for('update');
    return row ?? null;
  }

  async curriculumSubjects(academicYearId: string, yearGroupId: string) {
    const rows = await this.tx
      .select({
        subjectId: curriculumSubject.subjectId,
        subjectName: subject.nameEn,
        groupId: curriculumSubject.subjectGroupId,
      })
      .from(curriculumSubject)
      .innerJoin(subject, eq(subject.id, curriculumSubject.subjectId))
      .where(and(eq(curriculumSubject.academicYearId, academicYearId), eq(curriculumSubject.yearGroupId, yearGroupId)))
      .orderBy(asc(curriculumSubject.reportOrder));
    return rows.map((r) => ({ subjectId: r.subjectId, subjectName: r.subjectName, compulsory: r.groupId === null }));
  }

  async existingSectionGroupSubjects(sectionId: string): Promise<Set<string>> {
    const rows = await this.tx
      .select({ subjectId: teachingGroup.subjectId })
      .from(teachingGroup)
      .where(eq(teachingGroup.classSectionId, sectionId));
    return new Set(rows.map((r) => r.subjectId));
  }

  async insertTeachingGroups(rows: Array<Record<string, unknown>>): Promise<number> {
    if (!rows.length) return 0;
    const inserted = await this.tx
      .insert(teachingGroup)
      .values(rows as Array<typeof teachingGroup.$inferInsert>)
      .returning({ id: teachingGroup.id });
    return inserted.length;
  }

  async teachingGroup(id: string) {
    const [row] = await this.tx
      .select({
        id: teachingGroup.id,
        membership: teachingGroup.membership,
        academicYearId: teachingGroup.academicYearId,
      })
      .from(teachingGroup)
      .where(eq(teachingGroup.id, id));
    return row ?? null;
  }

  async assignTeacher(
    groupId: string,
    staffId: string,
    role: 'main' | 'assistant',
    periodsPerWeek: number,
    validFrom: string,
  ) {
    await this.tx
      .insert(teachingGroupTeacher)
      .values({ teachingGroupId: groupId, staffId, role, periodsPerWeek, validFrom })
      .onConflictDoUpdate({
        target: [teachingGroupTeacher.teachingGroupId, teachingGroupTeacher.staffId, teachingGroupTeacher.validFrom],
        set: { role, periodsPerWeek, validTo: null },
      });
  }

  async endTeacher(groupId: string, staffId: string, validTo: string) {
    const rows = await this.tx
      .update(teachingGroupTeacher)
      .set({ validTo })
      .where(
        and(
          eq(teachingGroupTeacher.teachingGroupId, groupId),
          eq(teachingGroupTeacher.staffId, staffId),
          isNull(teachingGroupTeacher.validTo),
        ),
      )
      .returning({ id: teachingGroupTeacher.staffId });
    return rows.length;
  }

  groupTeachers(groupId: string, onDate: string) {
    return this.tx
      .select({
        staffId: teachingGroupTeacher.staffId,
        role: teachingGroupTeacher.role,
        periodsPerWeek: teachingGroupTeacher.periodsPerWeek,
        validFrom: teachingGroupTeacher.validFrom,
        validTo: teachingGroupTeacher.validTo,
      })
      .from(teachingGroupTeacher)
      .where(
        and(
          eq(teachingGroupTeacher.teachingGroupId, groupId),
          lte(teachingGroupTeacher.validFrom, onDate),
          or(isNull(teachingGroupTeacher.validTo), gte(teachingGroupTeacher.validTo, onDate)),
        ),
      )
      .orderBy(asc(teachingGroupTeacher.role), asc(teachingGroupTeacher.validFrom));
  }

  groupMembers(groupId: string, onDate: string) {
    return this.tx
      .select({
        enrolmentId: teachingGroupMember.enrolmentId,
        joinedOn: teachingGroupMember.joinedOn,
        leftOn: teachingGroupMember.leftOn,
      })
      .from(teachingGroupMember)
      .where(
        and(
          eq(teachingGroupMember.teachingGroupId, groupId),
          lte(teachingGroupMember.joinedOn, onDate),
          or(isNull(teachingGroupMember.leftOn), gt(teachingGroupMember.leftOn, onDate)),
        ),
      )
      .orderBy(asc(teachingGroupMember.joinedOn));
  }

  async replaceMembers(groupId: string, enrolmentIds: string[], onDate: string) {
    const current = await this.tx
      .select({ enrolmentId: teachingGroupMember.enrolmentId, leftOn: teachingGroupMember.leftOn })
      .from(teachingGroupMember)
      .where(eq(teachingGroupMember.teachingGroupId, groupId));
    const wanted = new Set(enrolmentIds);
    const leaving = current.filter((m) => m.leftOn === null && !wanted.has(m.enrolmentId)).map((m) => m.enrolmentId);
    if (leaving.length) {
      await this.tx
        .update(teachingGroupMember)
        .set({ leftOn: onDate })
        .where(
          and(eq(teachingGroupMember.teachingGroupId, groupId), inArray(teachingGroupMember.enrolmentId, leaving)),
        );
    }
    if (enrolmentIds.length) {
      await this.tx
        .insert(teachingGroupMember)
        .values(enrolmentIds.map((enrolmentId) => ({ teachingGroupId: groupId, enrolmentId, joinedOn: onDate })))
        .onConflictDoUpdate({
          target: [teachingGroupMember.teachingGroupId, teachingGroupMember.enrolmentId],
          set: { leftOn: null },
        });
    }
    return enrolmentIds.length;
  }

  async timetable(id: string) {
    const [row] = await this.tx
      .select({ id: timetable.id, status: timetable.status, campusId: timetable.campusId })
      .from(timetable)
      .where(eq(timetable.id, id))
      .for('update');
    return row ?? null;
  }

  async replaceSlots(timetableId: string, slots: SlotInput[]) {
    await this.tx.delete(timetableSlot).where(eq(timetableSlot.timetableId, timetableId));
    if (!slots.length) return 0;
    const rows = await this.tx
      .insert(timetableSlot)
      .values(slots.map((s) => ({ ...s, roomId: s.roomId ?? null, timetableId })))
      .returning({ id: timetableSlot.id });
    return rows.length;
  }

  async publishTimetable(id: string) {
    await this.tx.update(timetable).set({ status: 'published' }).where(eq(timetable.id, id));
  }

  async slots(
    timetableId: string,
    f: { classSectionId?: string; staffId?: string; roomId?: string },
  ): Promise<TimetableSlotView[]> {
    const where = [eq(timetableSlot.timetableId, timetableId)];
    if (f.staffId) where.push(eq(timetableSlot.staffId, f.staffId));
    if (f.roomId) where.push(eq(timetableSlot.roomId, f.roomId));
    // section view = the section's whole-section groups; elective sets (spanning sections) appear in teacher/room
    // views and per-student timetables (ADR-008: ACA does not query sis.enrolment)
    if (f.classSectionId) where.push(eq(teachingGroup.classSectionId, f.classSectionId));
    return this.tx
      .select({
        id: timetableSlot.id,
        dayOfWeek: timetableSlot.dayOfWeek,
        periodDefinitionId: timetableSlot.periodDefinitionId,
        teachingGroupId: timetableSlot.teachingGroupId,
        staffId: timetableSlot.staffId,
        roomId: timetableSlot.roomId,
        periodNo: periodDefinition.periodNo,
        periodLabel: periodDefinition.label,
        startsAt: periodDefinition.startsAt,
        endsAt: periodDefinition.endsAt,
        groupName: teachingGroup.name,
        subjectId: teachingGroup.subjectId,
      })
      .from(timetableSlot)
      .innerJoin(periodDefinition, eq(periodDefinition.id, timetableSlot.periodDefinitionId))
      .innerJoin(teachingGroup, eq(teachingGroup.id, timetableSlot.teachingGroupId))
      .where(and(...where))
      .orderBy(asc(timetableSlot.dayOfWeek), asc(periodDefinition.periodNo));
  }

  async teacherLoad(academicYearId: string, campusId?: string) {
    const groupWhere = [eq(teachingGroup.academicYearId, academicYearId), isNull(teachingGroupTeacher.validTo)];
    if (campusId) groupWhere.push(eq(teachingGroup.campusId, campusId));
    const planned = await this.tx
      .select({
        staffId: teachingGroupTeacher.staffId,
        groups: count(teachingGroupTeacher.teachingGroupId),
        periodsPerWeek: sql<number>`coalesce(sum(${teachingGroupTeacher.periodsPerWeek}), 0)::int`,
      })
      .from(teachingGroupTeacher)
      .innerJoin(teachingGroup, eq(teachingGroup.id, teachingGroupTeacher.teachingGroupId))
      .where(and(...groupWhere))
      .groupBy(teachingGroupTeacher.staffId);
    const scheduled = await this.tx
      .select({ staffId: timetableSlot.staffId, n: count(timetableSlot.id) })
      .from(timetableSlot)
      .innerJoin(timetable, eq(timetable.id, timetableSlot.timetableId))
      .where(
        and(
          eq(timetable.academicYearId, academicYearId),
          eq(timetable.status, 'published'),
          isNotNull(timetableSlot.staffId),
        ),
      )
      .groupBy(timetableSlot.staffId);
    const sched = new Map(scheduled.map((s) => [s.staffId, Number(s.n)]));
    return planned.map((p) => ({
      staffId: p.staffId,
      groups: Number(p.groups),
      periodsPerWeek: p.periodsPerWeek,
      scheduledPeriods: sched.get(p.staffId) ?? 0,
    }));
  }
}
