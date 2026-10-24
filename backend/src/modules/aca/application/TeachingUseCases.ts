import type { TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import { InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import type { SisModuleApi } from '../../sis/public-api/SisModuleApi.js';

export interface SlotInput {
  dayOfWeek: number;
  periodDefinitionId: string;
  teachingGroupId: string;
  staffId: string;
  roomId?: string | null;
}

export interface TimetableSlotView extends SlotInput {
  id: string;
  periodNo: number;
  periodLabel: string;
  startsAt: string;
  endsAt: string;
  groupName: string;
  subjectId: string;
}

/** A teacher allocation of a teaching group (open-ended when validTo is null). */
export interface GroupTeacherView {
  staffId: string;
  role: 'main' | 'assistant';
  periodsPerWeek: number;
  validFrom: string;
  validTo: string | null;
}

/** A member (enrolment) of an explicit teaching group. */
export interface GroupMemberView {
  enrolmentId: string;
  joinedOn: string;
  leftOn: string | null;
}

/** A member with the student's name and roll number (from SIS). */
export interface GroupMemberDetail extends GroupMemberView {
  studentId: string | null;
  rollNo: number | null;
  fullNameEn: string | null;
  fullNameBn: string | null;
}

/** Persistence port for teaching groups and timetables. */
export interface AcaRepository {
  sectionForUpdate(sectionId: string): Promise<{
    id: string;
    orgId: string;
    campusId: string;
    academicYearId: string;
    yearGroupId: string;
    displayName: string;
  } | null>;
  curriculumSubjects(
    academicYearId: string,
    yearGroupId: string,
  ): Promise<Array<{ subjectId: string; subjectName: string; compulsory: boolean }>>;
  existingSectionGroupSubjects(sectionId: string): Promise<Set<string>>;
  insertTeachingGroups(rows: Array<Record<string, unknown>>): Promise<number>;
  teachingGroup(id: string): Promise<{ id: string; membership: string; academicYearId: string } | null>;
  assignTeacher(
    groupId: string,
    staffId: string,
    role: 'main' | 'assistant',
    periodsPerWeek: number,
    validFrom: string,
  ): Promise<void>;
  endTeacher(groupId: string, staffId: string, validTo: string): Promise<number>;
  /** Allocations valid on the date (validFrom <= date, validTo null or >= date). */
  groupTeachers(groupId: string, onDate: string): Promise<GroupTeacherView[]>;
  /** Members on the date (joinedOn <= date, leftOn null or > date). */
  groupMembers(groupId: string, onDate: string): Promise<GroupMemberView[]>;
  replaceMembers(groupId: string, enrolmentIds: string[], onDate: string): Promise<number>;
  timetable(id: string): Promise<{ id: string; status: string; campusId: string } | null>;
  replaceSlots(timetableId: string, slots: SlotInput[]): Promise<number>;
  publishTimetable(id: string): Promise<void>;
  slots(
    timetableId: string,
    filter: { classSectionId?: string; staffId?: string; roomId?: string },
  ): Promise<TimetableSlotView[]>;
  teacherLoad(
    academicYearId: string,
    campusId?: string,
  ): Promise<Array<{ staffId: string; groups: number; periodsPerWeek: number; scheduledPeriods: number }>>;
}

/**
 * Creates one whole-section teaching group per curriculum subject of the section's year group (idempotent).
 * Elective sets (spanning sections) are created explicitly.
 */
export class GenerateSectionTeachingGroups extends UseCase<{ sectionId: string }, { created: number }> {
  constructor(private readonly d: { uow: TransactionRunner; acaRepo: AcaRepository }) {
    super(d.uow);
  }

  protected async handle({ sectionId }: { sectionId: string }) {
    const section = await this.d.acaRepo.sectionForUpdate(sectionId);
    if (!section) throw new NotFoundError();
    const subjects = await this.d.acaRepo.curriculumSubjects(section.academicYearId, section.yearGroupId);
    if (!subjects.length)
      throw new InvariantError('CURRICULUM_EMPTY', 'Define the curriculum subjects for this year group first');
    const existing = await this.d.acaRepo.existingSectionGroupSubjects(sectionId);
    const rows = subjects
      .filter((s) => s.compulsory && !existing.has(s.subjectId))
      .map((s) => ({
        orgId: section.orgId,
        campusId: section.campusId,
        academicYearId: section.academicYearId,
        yearGroupId: section.yearGroupId,
        subjectId: s.subjectId,
        name: `${section.displayName} ${s.subjectName}`,
        membership: 'whole_section',
        classSectionId: section.id,
      }));
    return { created: await this.d.acaRepo.insertTeachingGroups(rows) };
  }
}

export class AssignTeacher extends UseCase<
  { groupId: string; staffId: string; role: 'main' | 'assistant'; periodsPerWeek: number; validFrom: string },
  { assigned: true }
> {
  constructor(private readonly d: { uow: TransactionRunner; acaRepo: AcaRepository }) {
    super(d.uow);
  }

  protected async handle(i: {
    groupId: string;
    staffId: string;
    role: 'main' | 'assistant';
    periodsPerWeek: number;
    validFrom: string;
  }) {
    if (!(await this.d.acaRepo.teachingGroup(i.groupId))) throw new NotFoundError();
    await this.d.acaRepo.assignTeacher(i.groupId, i.staffId, i.role, i.periodsPerWeek, i.validFrom);
    return { assigned: true as const };
  }
}

/** Ends a teacher's open allocation of a group (from validTo on they no longer teach it). */
export class EndTeacher extends UseCase<{ groupId: string; staffId: string; validTo: string }, { ended: number }> {
  constructor(private readonly d: { uow: TransactionRunner; acaRepo: AcaRepository }) {
    super(d.uow);
  }

  protected async handle(i: { groupId: string; staffId: string; validTo: string }) {
    if (!(await this.d.acaRepo.teachingGroup(i.groupId))) throw new NotFoundError();
    const ended = await this.d.acaRepo.endTeacher(i.groupId, i.staffId, i.validTo);
    if (ended === 0) throw new NotFoundError('No open allocation of this teacher to the group');
    return { ended };
  }
}

export class ListGroupTeachers extends Query<{ groupId: string; onDate: string }, GroupTeacherView[]> {
  constructor(private readonly d: { uow: TransactionRunner; acaRepo: AcaRepository }) {
    super(d.uow);
  }

  protected async handle(i: { groupId: string; onDate: string }) {
    if (!(await this.d.acaRepo.teachingGroup(i.groupId))) throw new NotFoundError();
    return this.d.acaRepo.groupTeachers(i.groupId, i.onDate);
  }
}

/** Members of an explicit group; whole-section groups take their members from the section roster. */
export class ListGroupMembers extends Query<{ groupId: string; onDate: string }, GroupMemberDetail[]> {
  constructor(private readonly d: { uow: TransactionRunner; acaRepo: AcaRepository; sisApi: SisModuleApi }) {
    super(d.uow);
  }

  protected async handle(i: { groupId: string; onDate: string }) {
    const group = await this.d.acaRepo.teachingGroup(i.groupId);
    if (!group) throw new NotFoundError();
    if (group.membership !== 'explicit') {
      throw new InvariantError(
        'GROUP_IS_WHOLE_SECTION',
        'Members of a whole-section group come from the section roster',
      );
    }
    const members = await this.d.acaRepo.groupMembers(i.groupId, i.onDate);
    const roster = new Map(
      (
        await this.d.sisApi.enrolmentRoster(
          members.map((m) => m.enrolmentId),
          i.onDate,
        )
      ).map((r) => [r.enrolmentId, r]),
    );
    return members.map((m) => {
      const r = roster.get(m.enrolmentId);
      return {
        ...m,
        studentId: r?.studentId ?? null,
        rollNo: r?.rollNo ?? null,
        fullNameEn: r?.fullNameEn ?? null,
        fullNameBn: r?.fullNameBn ?? null,
      };
    });
  }
}

export class SetGroupMembers extends UseCase<
  { groupId: string; enrolmentIds: string[]; onDate: string },
  { members: number }
> {
  constructor(private readonly d: { uow: TransactionRunner; acaRepo: AcaRepository }) {
    super(d.uow);
  }

  protected async handle(i: { groupId: string; enrolmentIds: string[]; onDate: string }) {
    const group = await this.d.acaRepo.teachingGroup(i.groupId);
    if (!group) throw new NotFoundError();
    if (group.membership !== 'explicit') {
      throw new InvariantError(
        'GROUP_IS_WHOLE_SECTION',
        'Members of a whole-section group come from the section roster',
      );
    }
    return { members: await this.d.acaRepo.replaceMembers(i.groupId, [...new Set(i.enrolmentIds)], i.onDate) };
  }
}

const DAY_RANGE = (d: number) => Number.isInteger(d) && d >= 0 && d <= 6;

/** Replaces all slots of a draft timetable. Teacher / room / group clashes are rejected by DB unique constraints. */
export class SaveTimetableSlots extends UseCase<{ timetableId: string; slots: SlotInput[] }, { slots: number }> {
  constructor(private readonly d: { uow: TransactionRunner; acaRepo: AcaRepository }) {
    super(d.uow);
  }

  protected async handle(i: { timetableId: string; slots: SlotInput[] }) {
    const tt = await this.d.acaRepo.timetable(i.timetableId);
    if (!tt) throw new NotFoundError();
    if (tt.status !== 'draft') throw new InvariantError('TIMETABLE_NOT_DRAFT', 'Only draft timetables can be edited');
    if (!i.slots.every((s) => DAY_RANGE(s.dayOfWeek))) throw new InvariantError('DAY_INVALID', 'dayOfWeek must be 0-6');
    // in-memory clash check gives a friendlier error than the constraint
    const seen = new Set<string>();
    for (const s of i.slots) {
      for (const key of [`t:${s.staffId}`, `g:${s.teachingGroupId}`, ...(s.roomId ? [`r:${s.roomId}`] : [])]) {
        const k = `${s.dayOfWeek}|${s.periodDefinitionId}|${key}`;
        if (seen.has(k)) {
          throw new InvariantError(
            'TIMETABLE_CLASH',
            `Clash on day ${s.dayOfWeek}: ${key.startsWith('t') ? 'teacher' : key.startsWith('g') ? 'group' : 'room'} double-booked`,
          );
        }
        seen.add(k);
      }
    }
    return { slots: await this.d.acaRepo.replaceSlots(i.timetableId, i.slots) };
  }
}

export class PublishTimetable extends UseCase<{ timetableId: string }, { published: true }> {
  constructor(private readonly d: { uow: TransactionRunner; acaRepo: AcaRepository; ctx: RequestContext }) {
    super(d.uow);
  }

  protected async handle({ timetableId }: { timetableId: string }) {
    const tt = await this.d.acaRepo.timetable(timetableId);
    if (!tt) throw new NotFoundError();
    if (tt.status !== 'draft') throw new InvariantError('TIMETABLE_NOT_DRAFT', 'Timetable is not a draft');
    await this.d.acaRepo.publishTimetable(timetableId);
    return { published: true as const };
  }
}

export class GetTimetableView extends Query<
  { timetableId: string; classSectionId?: string; staffId?: string; roomId?: string },
  TimetableSlotView[]
> {
  constructor(private readonly d: { uow: TransactionRunner; acaRepo: AcaRepository }) {
    super(d.uow);
  }
  protected handle(i: { timetableId: string; classSectionId?: string; staffId?: string; roomId?: string }) {
    return this.d.acaRepo.slots(i.timetableId, i);
  }
}

export class TeacherLoadReport extends Query<
  { academicYearId: string; campusId?: string },
  Awaited<ReturnType<AcaRepository['teacherLoad']>>
> {
  constructor(private readonly d: { uow: TransactionRunner; acaRepo: AcaRepository }) {
    super(d.uow);
  }
  protected handle(i: { academicYearId: string; campusId?: string }) {
    return this.d.acaRepo.teacherLoad(i.academicYearId, i.campusId);
  }
}
