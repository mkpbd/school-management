import type { Page } from '../../../shared/application/pagination.js';

export interface StudentRow {
  id: string;
  campusId: string;
  familyId: string;
  userId: string | null;
  admissionNo: string;
  firstNameEn: string;
  lastNameEn: string | null;
  fullNameEn: string;
  fullNameBn: string | null;
  preferredName: string | null;
  gender: 'male' | 'female';
  dateOfBirth: string;
  nationality: string;
  religion: string | null;
  bloodGroup: string | null;
  motherTongue: string | null;
  previousSchool: string | null;
  hasSpecialNeeds: boolean;
  houseId: string | null;
  photoFileId: string | null;
  status: string;
  admittedOn: string;
  leftOn: string | null;
  hasBirthCert: boolean;
  rowVersion: number;
}

export interface GuardianRow {
  id: string;
  familyId: string;
  userId: string | null;
  fullNameEn: string;
  fullNameBn: string | null;
  phone: string;
  altPhone: string | null;
  email: string | null;
  occupationCode: string | null;
  preferredLocale: 'en' | 'bn';
  rowVersion: number;
}

export interface GuardianLink extends GuardianRow {
  relationship: string;
  isPrimaryContact: boolean;
  isFeePayer: boolean;
  canPickup: boolean;
  portalAccess: boolean;
}

export interface EnrolmentRow {
  id: string;
  studentId: string;
  campusId: string;
  academicYearId: string;
  classSectionId: string;
  yearGroupId: string;
  rollNo: number | null;
  status: string;
  startsOn: string;
  endsOn: string | null;
}

export interface StudentListItem {
  id: string;
  admissionNo: string;
  fullNameEn: string;
  fullNameBn: string | null;
  gender: string;
  status: string;
  campusId: string;
  classSectionId: string | null;
  rollNo: number | null;
}

export interface StudentSearch {
  campusId?: string;
  classSectionIds?: string[];
  studentIds?: string[];
  status?: string;
  q?: string;
  birthCertBidx?: Buffer;
  guardianPhone?: string;
  limit: number;
  cursor?: string;
}

/** Persistence port of SIS. */
export interface SisRepository {
  // family & guardians
  findGuardianByPhone(phone: string): Promise<GuardianRow | null>;
  insertFamily(values: { orgId: string; familyCode: string }): Promise<string>;
  setBillingGuardian(familyId: string, guardianId: string): Promise<void>;
  insertGuardian(values: Record<string, unknown>): Promise<GuardianRow>;
  updateGuardian(
    id: string,
    values: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<GuardianRow | 'stale' | null>;
  linkGuardian(
    studentId: string,
    guardianId: string,
    flags: { relationship: string; isPrimaryContact: boolean; isFeePayer: boolean; canPickup: boolean },
  ): Promise<void>;
  clearPrimaryContact(studentId: string): Promise<void>;
  guardiansOf(studentIds: string[]): Promise<Map<string, GuardianLink[]>>;
  // students
  findStudentByBirthCertBidx(bidx: Buffer): Promise<{ id: string; admissionNo: string } | null>;
  insertStudent(values: Record<string, unknown>): Promise<StudentRow>;
  updateStudent(
    id: string,
    values: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<StudentRow | 'stale' | null>;
  findStudent(id: string): Promise<StudentRow | null>;
  searchStudents(f: StudentSearch): Promise<Page<StudentListItem>>;
  // enrolment
  activeEnrolment(studentId: string, onDate?: string): Promise<EnrolmentRow | null>;
  enrolments(studentId: string): Promise<EnrolmentRow[]>;
  lockSectionEnrolments(sectionId: string): Promise<Array<{ rollNo: number | null; status: string }>>;
  insertEnrolment(values: Record<string, unknown>): Promise<EnrolmentRow>;
  endEnrolment(id: string, endsOn: string, status: string, reason: string): Promise<void>;
  sectionRoster(
    sectionId: string,
    onDate: string,
  ): Promise<
    Array<{
      enrolmentId: string;
      studentId: string;
      rollNo: number | null;
      fullNameEn: string;
      fullNameBn: string | null;
      gender: string;
    }>
  >;
  enrolmentRoster(
    enrolmentIds: string[],
    onDate: string,
  ): Promise<
    Array<{
      enrolmentId: string;
      studentId: string;
      rollNo: number | null;
      fullNameEn: string;
      fullNameBn: string | null;
      gender: string;
    }>
  >;
  enrolmentsByIds(ids: string[]): Promise<EnrolmentRow[]>;
  // documents
  insertDocument(values: Record<string, unknown>): Promise<{ id: string }>;
  documents(
    studentId: string,
  ): Promise<
    Array<{ id: string; docType: string; fileId: string; expiresOn: string | null; verificationStatus: string }>
  >;
  verifyDocument(id: string, status: 'verified' | 'rejected', by: string): Promise<boolean>;
  // guardian scope
  childrenOfGuardian(guardianId: string): Promise<string[]>;
  studentsInSections(sectionIds: string[], onDate: string): Promise<string[]>;
  studentsInEnrolments(enrolmentIds: string[]): Promise<string[]>;
}
