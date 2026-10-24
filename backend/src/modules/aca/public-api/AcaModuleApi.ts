export interface SectionInfo {
  id: string;
  campusId: string;
  academicYearId: string;
  yearGroupId: string;
  displayName: string;
  classTeacherStaffId: string | null;
  headOfSectionStaffId: string | null;
  capacity: number;
}

export interface TeachingGroupRef {
  id: string;
  subjectId: string;
  classSectionId: string | null;
  membership: 'whole_section' | 'explicit';
}

export interface TeachingGroupInfo extends TeachingGroupRef {
  campusId: string;
  academicYearId: string;
  yearGroupId: string;
  name: string;
}

/** A timetable cell in effect on a date (latest published timetable of the campus), with any cover teacher. */
export interface ScheduledSlot {
  slotId: string;
  campusId: string;
  periodDefinitionId: string;
  periodNo: number;
  label: string;
  kind: 'teaching' | 'break' | 'prayer' | 'assembly' | 'registration';
  startsAt: string;
  endsAt: string;
  teachingGroupId: string;
  groupName: string;
  yearGroupId: string;
  classSectionId: string | null;
  membership: 'whole_section' | 'explicit';
  staffId: string;
  coverStaffId: string | null;
}

export interface YearGroupInfo {
  id: string;
  code: string;
  nameEn: string;
  /** order across programmes (EY < primary < lower secondary < ...) */
  seq: number;
}

/** Public API of ACA (docs/backend/modules.md#aca). */
export interface AcaModuleApi {
  sectionInfo(sectionId: string): Promise<SectionInfo | null>;
  yearGroup(yearGroupId: string): Promise<YearGroupInfo | null>;
  /** every year group in promotion order */
  yearGroups(): Promise<YearGroupInfo[]>;
  sectionsOfClassTeacher(staffId: string): Promise<string[]>;
  sectionsOfHeadOfSection(staffId: string): Promise<string[]>;
  teachingGroupsOfTeacher(staffId: string, onDate?: string): Promise<TeachingGroupRef[]>;
  /** enrolment ids of explicit members (elective sets) for the given groups */
  explicitMemberEnrolments(groupIds: string[]): Promise<string[]>;
  teachingGroup(groupId: string): Promise<TeachingGroupInfo | null>;
  /** enrolment ids of an explicit group's members on a date */
  groupMembersOn(groupId: string, onDate: string): Promise<string[]>;
  /** slots taught on a date; `staffId` matches the timetabled or the cover teacher */
  scheduledSlots(f: {
    date: string;
    campusId?: string;
    staffId?: string;
    teachingGroupId?: string;
    periodDefinitionId?: string;
    classSectionId?: string;
  }): Promise<ScheduledSlot[]>;
}
