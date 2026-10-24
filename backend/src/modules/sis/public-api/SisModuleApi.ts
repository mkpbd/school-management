export interface EnrolmentSummary {
  id: string;
  studentId: string;
  campusId: string;
  academicYearId: string;
  classSectionId: string;
  yearGroupId: string;
  rollNo: number | null;
  startsOn: string;
  endsOn: string | null;
}

export interface RosterEntry {
  enrolmentId: string;
  studentId: string;
  rollNo: number | null;
  fullNameEn: string;
  fullNameBn: string | null;
  gender: string;
}

export interface StudentBrief {
  id: string;
  admissionNo: string;
  fullNameEn: string;
  fullNameBn: string | null;
  campusId: string;
  familyId: string;
  status: string;
  gender: string;
}

export interface ContactPerson {
  guardianId: string;
  userId: string | null;
  fullNameEn: string;
  phone: string;
  email: string | null;
  locale: 'en' | 'bn';
}

/** Public API of SIS (docs/backend/modules.md#sis). */
export interface SisModuleApi {
  activeEnrolment(studentId: string, onDate?: string): Promise<EnrolmentSummary | null>;
  sectionRoster(sectionId: string, onDate: string): Promise<RosterEntry[]>;
  /** students of the given enrolments that are active on the date (elective teaching groups) */
  enrolmentRoster(enrolmentIds: string[], onDate: string): Promise<RosterEntry[]>;
  activeEnrolments(f: {
    campusId: string;
    academicYearId: string;
    yearGroupIds?: string[];
    onDate: string;
  }): Promise<EnrolmentSummary[]>;
  studentBriefs(studentIds: string[]): Promise<Map<string, StudentBrief>>;
  primaryContacts(studentIds: string[]): Promise<Map<string, ContactPerson>>;
  feePayers(familyId: string): Promise<ContactPerson[]>;
  isGuardianOf(guardianId: string, studentId: string): Promise<boolean>;
  childrenOfGuardian(guardianId: string): Promise<string[]>;
  /**
   * Accounts reached through students enrolled on a date (filters are AND-ed; omitted = any):
   * the students' own portal accounts and / or their guardians' accounts.
   */
  audienceUsers(f: {
    onDate: string;
    campusId?: string | null;
    yearGroupIds?: string[];
    sectionIds?: string[];
    houseIds?: string[];
    studentIds?: string[];
    students: boolean;
    guardians: boolean;
  }): Promise<{ studentUserIds: string[]; guardianUserIds: string[] }>;
}
