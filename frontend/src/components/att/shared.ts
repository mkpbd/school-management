import type { DailyStatus, RegisterSheet } from "@/components/sis/shared";
import { api, isApiError, type Row } from "@/lib/api";
import type { RefSource } from "@/lib/refs";

// ---- response shapes (backend/src/modules/att/application/*.ts, att/domain/*.ts) ----

/** GET /att/sections/:id/daily with the edit window and the period-wise flag. */
export type DailySheet = RegisterSheet & {
  /** marks of this date can still be changed directly (else: correction request) */
  editable: boolean;
  editableUntil: string;
  /** the year group also takes period-wise attendance */
  periodWise: boolean;
};

export type MarkResult = {
  date: string;
  present: number;
  absent: number;
  late: number;
  changed: number;
  alerts: number;
};

export type PeriodStatus = "present" | "absent" | "late" | "excused";
export const PERIOD_STATUSES: PeriodStatus[] = [
  "present",
  "absent",
  "late",
  "excused",
];

export type PeriodRegister = {
  date: string;
  teachingGroupId: string;
  groupName: string;
  period: { id: string; label: string; startsAt: string; endsAt: string };
  periodWise: boolean;
  editable: boolean;
  editableUntil: string;
  marked: boolean;
  entries: Array<{
    studentId: string;
    enrolmentId: string;
    rollNo: number | null;
    fullNameEn: string;
    fullNameBn: string | null;
    daily: DailyStatus | null;
    status: PeriodStatus | null;
    suggested: PeriodStatus;
  }>;
};

export type MyRegisters = {
  date: string;
  daily: Array<{
    classSectionId: string;
    name: string;
    students: number;
    marked: number;
    editable: boolean;
  }>;
  periods: Array<{
    teachingGroupId: string;
    groupName: string;
    periodDefinitionId: string;
    label: string;
    startsAt: string;
    endsAt: string;
    cover: boolean;
    students: number;
    marked: number;
    editable: boolean;
  }>;
};

export type SectionDay = {
  date: string;
  classSectionId: string;
  sectionName: string;
  periods: Array<{
    periodDefinitionId: string;
    label: string;
    startsAt: string;
  }>;
  students: Array<{
    studentId: string;
    rollNo: number | null;
    fullNameEn: string;
    daily: DailyStatus | null;
    periods: Record<string, { status: PeriodStatus; teachingGroupId: string }>;
    missedPeriods: number;
  }>;
};

export type CorrectionStatus =
  "pending" | "approved" | "rejected" | "cancelled";
export const CORRECTION_STATUSES: CorrectionStatus[] = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
];

export type CorrectionRow = {
  [key: string]: unknown;
  id: string;
  campusId: string;
  kind: "daily" | "period";
  studentId: string;
  studentName?: string | null;
  attendanceDate: string;
  classSectionId: string | null;
  teachingGroupId: string | null;
  periodDefinitionId: string | null;
  oldStatus: string | null;
  newStatus: string;
  reason: string;
  status: CorrectionStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

export type MarkHistory = {
  studentId: string;
  date: string;
  daily: { status: DailyStatus; remarks: string | null } | null;
  periods: Array<{
    studentId: string;
    periodDefinitionId: string;
    teachingGroupId: string;
    status: PeriodStatus;
    source: string;
    markedBy: string | null;
    markedAt: string;
  }>;
  changes: Array<{
    at: string;
    by: string | null;
    register: "daily" | "period";
    periodDefinitionId: string | null;
    action: string;
    from: string | null;
    to: string | null;
    source: string | null;
    changed: string[];
  }>;
  corrections: CorrectionRow[];
};

// ---- staff ----

export type StaffDayStatus =
  | "present"
  | "absent"
  | "late"
  | "leave"
  | "half_day"
  | "holiday"
  | "weekly_off"
  | "on_duty";
export const STAFF_STATUSES: StaffDayStatus[] = [
  "present",
  "absent",
  "late",
  "leave",
  "half_day",
  "holiday",
  "weekly_off",
  "on_duty",
];

export type StaffDayRow = {
  [key: string]: unknown;
  staffId: string;
  attendanceDate: string;
  status: StaffDayStatus;
  checkInAt: string | null;
  checkOutAt: string | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  source: "device" | "mobile_geo" | "manual" | "leave_auto";
};

export type StaffSheet = {
  campusId: string;
  date: string;
  schoolDay: boolean;
  rows: Array<{
    staffId: string;
    staffNo: string;
    name: string;
    day: StaffDayRow | null;
  }>;
};

export type StaffMonth = {
  staffId: string;
  month: string;
  days: StaffDayRow[];
  summary: {
    present: number;
    late: number;
    absent: number;
    halfDay: number;
    leave: number;
    unpaidLeave: number;
    onDuty: number;
    overtimeMinutes: number;
    paidLeave: number;
    lwpDays: number;
    lwpBreakdown: {
      unpaidLeave: number;
      absent: number;
      halfDay: number;
      late: number;
    };
  };
};

export type LeaveType = {
  [key: string]: unknown;
  id: string;
  code: string;
  nameEn: string;
  annualQuotaDays: number;
  maxCarryForward: number;
  isPaid: boolean;
  genderRestriction: "male" | "female" | null;
  requiresDocumentAfterDays: number | null;
  countsHolidays: boolean;
};

export type LeaveBalance = {
  [key: string]: unknown;
  leaveTypeId: string;
  code: string;
  nameEn: string;
  isPaid: boolean;
  entitled: number;
  carried: number;
  taken: number;
  pending: number;
  available: number;
};

export type StaffLeaveRow = {
  [key: string]: unknown;
  id: string;
  campusId: string;
  staffId: string;
  leaveTypeId: string;
  leaveCode: string;
  isPaid: boolean;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: number | string;
  reason: string | null;
  attachmentFileId: string | null;
  status: CorrectionStatus;
  createdBy: string | null;
};

/** Leave types as select options (`leaveTypeId`). */
export const leaveTypesRef: RefSource = {
  key: "att.leaveTypes",
  load: async () => (await api.att.staff.leaveTypes<Row[]>()).data,
  label: (r) =>
    `${String(r.nameEn ?? "")} (${String(r.code ?? "")})${r.isPaid === false ? " · unpaid" : ""}`,
};

// ---- helpers ----

/** Problems the backend raises on registers, corrections and staff attendance, in words for the user. */
const EXPLAIN: Record<string, string> = {
  NOT_A_SCHOOL_DAY:
    "This date is not a school day (weekend or holiday); attendance is not taken.",
  ATTENDANCE_FUTURE_DATE: "Attendance cannot be marked for a future date.",
  ATTENDANCE_EDIT_WINDOW_CLOSED:
    "The edit window for this date has closed. Ask for an attendance correction instead.",
  PERIOD_NOT_STARTED:
    "This lesson has not started yet; mark it once it begins.",
  NOT_SCHEDULED:
    "The group has no lesson in this period on that date (check the timetable).",
  PERIOD_WISE_NOT_ENABLED:
    "This year group takes daily attendance only (setting attendance.period_wise_year_groups).",
  NOT_A_LESSON: "This period is not a teaching period.",
  PERIOD_MARKED_IN_OTHER_GROUP:
    "Some students are already marked in another group for this period.",
  EDIT_WINDOW_OPEN:
    "The register is still editable; change the mark directly instead of asking for a correction.",
  NO_CHANGE: "The mark already has that status.",
  PERIOD_MARK_NOT_FOUND:
    "There is no lesson mark to correct for that student, date and period.",
  MARK_CHANGED: "The mark changed after the request; reject it and ask again.",
  LOCATION_REQUIRED:
    "This campus checks your location. Allow location access in the browser and try again.",
  ALREADY_CHECKED_IN: "You have already checked in today.",
  NOT_CHECKED_IN: "Check in first.",
  ON_LEAVE: "You are on approved leave today.",
  NOT_STAFF: "No staff record is linked to this login.",
  STAFF_REQUIRED: "No staff record is linked to this login.",
};

/** User-facing text of an API error (known codes explained, else the server's message). */
export function explain(
  err: unknown,
  fallback = "Something went wrong.",
): string {
  if (!isApiError(err)) return err instanceof Error ? err.message : fallback;
  return EXPLAIN[err.code] ?? err.message;
}

const dhakaTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** ISO instant -> "HH:MM" in Asia/Dhaka ("" when empty). */
export function toDhakaTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : dhakaTime.format(d);
}

/** "YYYY-MM-DD" + "HH:MM" (Asia/Dhaka) -> ISO with offset. */
export function dhakaInstant(date: string, time: string): string {
  return `${date}T${time}:00+06:00`;
}

/** "08:00:00" -> "08:00" */
export const hhmm = (v: string | null | undefined) => (v ? v.slice(0, 5) : "—");

/** Short codes and daisyUI tones of the register buttons. */
export const SHORT: Record<string, string> = {
  present: "P",
  absent: "A",
  late: "L",
  leave: "LV",
  half_day: "H",
  excused: "E",
};
export const TONE: Record<string, string> = {
  present: "btn-success",
  absent: "btn-error",
  late: "btn-warning",
  leave: "btn-info",
  half_day: "btn-secondary",
  excused: "btn-accent",
};
export const BADGE_TONE: Record<string, string> = {
  present: "badge-success",
  absent: "badge-error",
  late: "badge-warning",
  leave: "badge-info",
  half_day: "badge-secondary",
  excused: "badge-accent",
};
