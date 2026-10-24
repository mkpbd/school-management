import type { FieldDef } from "@/components/crud/fields";
import { api, isApiError, type Row } from "@/lib/api";
import type { RefSource } from "@/lib/refs";
import { refs } from "@/lib/refs";

// ---- response shapes (backend/src/modules/sis/application/ports.ts, att/application/AttendanceUseCases.ts) ----

export type StudentRow = {
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
  gender: "male" | "female";
  dateOfBirth: string;
  nationality: string;
  religion: string | null;
  bloodGroup: string | null;
  houseId: string | null;
  motherTongue: string | null;
  previousSchool: string | null;
  hasSpecialNeeds: boolean;
  status: string;
  admittedOn: string;
  leftOn: string | null;
  hasBirthCert: boolean;
  rowVersion: number;
};

export type GuardianLink = {
  id: string;
  familyId: string;
  userId: string | null;
  fullNameEn: string;
  fullNameBn: string | null;
  phone: string;
  altPhone: string | null;
  email: string | null;
  occupationCode: string | null;
  preferredLocale: "en" | "bn";
  relationship: string;
  isPrimaryContact: boolean;
  isFeePayer: boolean;
  canPickup: boolean;
  portalAccess: boolean;
};

export type EnrolmentRow = {
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
};

export type StudentDocument = {
  id: string;
  docType: string;
  fileId: string;
  expiresOn: string | null;
  verificationStatus: string;
};

export type Student360 = {
  student: StudentRow;
  guardians: GuardianLink[];
  currentEnrolment: EnrolmentRow | null;
  enrolmentHistory: EnrolmentRow[];
  documents: StudentDocument[];
};

export type RosterRow = {
  enrolmentId: string;
  studentId: string;
  rollNo: number | null;
  fullNameEn: string;
  fullNameBn: string | null;
  gender: string;
};

export type AttendanceSummary = {
  from: string;
  to: string;
  present: number;
  absent: number;
  late: number;
  leave: number;
  halfDay: number;
  excused: number;
  countedDays: number;
  percent: number | null;
};

export type DailyStatus =
  "present" | "absent" | "late" | "leave" | "half_day" | "excused";
export const DAILY_STATUSES: DailyStatus[] = [
  "present",
  "absent",
  "late",
  "leave",
  "half_day",
  "excused",
];

export type RegisterSheet = {
  date: string;
  classSectionId: string;
  sectionName: string;
  schoolDay: boolean;
  holiday?: string;
  marked: boolean;
  entries: Array<{
    enrolmentId: string;
    studentId: string;
    rollNo: number | null;
    fullNameEn: string;
    fullNameBn: string | null;
    status: DailyStatus | null;
    suggested: DailyStatus;
    remarks: string | null;
  }>;
};

export type LeaveRow = {
  id: string;
  studentId: string;
  enrolmentId: string;
  campusId: string;
  fromDate: string;
  toDate: string;
  reasonCode: string;
  reasonNote: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedByUser: string;
};

// ---- lookup-backed options (value = lookup code, not id) ----

function lookupRef(listCode: string): RefSource {
  return {
    key: `lookup.${listCode}`,
    load: async () =>
      (await api.core.lookups.list({ listCode, pageSize: 500 })).data
        .filter((r) => r.isActive !== false)
        .map((r) => ({ ...r, id: r.code })),
    label: (r) => String(r.labelEn ?? r.code),
  };
}

export const lookups = {
  leaveReasons: lookupRef("leave_reason"),
  docTypes: lookupRef("student_doc_type"),
  occupations: lookupRef("occupation"),
};

// ---- field sets ----

export const RELATIONSHIPS = [
  "father",
  "mother",
  "grandfather",
  "grandmother",
  "uncle",
  "aunt",
  "sibling",
  "legal_guardian",
  "other",
] as const;
export const BLOOD_GROUPS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;

export const STUDENT_FIELDS: FieldDef[] = [
  { name: "firstNameEn", label: "First name (English)", required: true },
  { name: "lastNameEn", label: "Last name (English)" },
  { name: "fullNameBn", label: "Full name (Bangla)" },
  { name: "preferredName", label: "Preferred name" },
  {
    name: "gender",
    label: "Gender",
    type: "select",
    options: ["male", "female"],
    required: true,
  },
  { name: "dateOfBirth", label: "Date of birth", type: "date", required: true },
  {
    name: "birthCertNo",
    label: "Birth certificate no",
    help: "Stored encrypted; duplicates are rejected",
  },
  {
    name: "nationality",
    label: "Nationality",
    placeholder: "BD",
    help: "2-letter country code",
  },
  { name: "religion", label: "Religion" },
  {
    name: "bloodGroup",
    label: "Blood group",
    type: "select",
    options: BLOOD_GROUPS,
  },
  {
    name: "houseId",
    label: "House",
    type: "ref",
    ref: refs.houses,
    nullable: true,
  },
  { name: "motherTongue", label: "Mother tongue" },
  { name: "previousSchool", label: "Previous school" },
];

/** PATCH /sis/students/:id (status limited to active / on hold). */
export const STUDENT_EDIT_FIELDS: FieldDef[] = [
  ...STUDENT_FIELDS,
  {
    name: "status",
    label: "Status",
    type: "select",
    options: ["active", "on_hold"],
  },
];

export const GUARDIAN_FIELDS: FieldDef[] = [
  { name: "fullNameEn", label: "Full name (English)", required: true },
  { name: "fullNameBn", label: "Full name (Bangla)" },
  {
    name: "relationship",
    label: "Relationship",
    type: "select",
    options: RELATIONSHIPS,
    required: true,
  },
  {
    name: "phone",
    label: "Phone",
    type: "phone",
    required: true,
    help: "Same phone links the existing family",
  },
  { name: "altPhone", label: "Alternative phone", type: "phone" },
  { name: "email", label: "Email", type: "email" },
  { name: "nid", label: "NID" },
  {
    name: "occupationCode",
    label: "Occupation",
    type: "ref",
    ref: lookups.occupations,
  },
  {
    name: "preferredLocale",
    label: "Language",
    type: "select",
    options: ["bn", "en"],
  },
  {
    name: "isPrimaryContact",
    label: "Primary contact (gets alerts)",
    type: "boolean",
  },
  { name: "isFeePayer", label: "Fee payer", type: "boolean" },
  { name: "canPickup", label: "Can pick up", type: "boolean" },
  { name: "portalAccess", label: "Parent portal access", type: "boolean" },
];

export const sectionRef = refs.sections;

// ---- file upload (presigned PUT) ----

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 1. POST /files/uploads -> presigned PUT, 2. PUT the bytes to storage, 3. POST /files/:id/complete (queues the
 * virus scan). Returns the file id; it is usable once the scan is clean (see `retryWhileScanning`).
 */
export async function uploadFile(file: File, purpose: string): Promise<string> {
  const { data } = await api.files.startUpload<{
    fileId: string;
    upload: { url: string; method: "PUT"; headers: Record<string, string> };
  }>({
    purpose,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  });
  const put = await fetch(data.upload.url, {
    method: "PUT",
    headers: data.upload.headers,
    body: file,
  });
  if (!put.ok) throw new Error(`Upload to storage failed (${put.status})`);
  await api.files.complete(data.fileId);
  return data.fileId;
}

/** Re-runs `fn` while the backend says the file is still being scanned (FILE_NOT_AVAILABLE). */
export async function retryWhileScanning<T>(
  fn: () => Promise<T>,
  attempts = 10,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (
        !(isApiError(err) && err.code === "FILE_NOT_AVAILABLE") ||
        i >= attempts - 1
      )
        throw err;
      await sleep(1500);
    }
  }
}

export async function openFile(fileId: string): Promise<void> {
  const { data } = await api.files.downloadUrl<{ url: string }>(fileId);
  window.open(data.url, "_blank", "noopener");
}

/** Typed-body escape hatch: bodies built from FieldDefs are plain rows. */
export const asBody = <T>(row: Row) => row as T;
