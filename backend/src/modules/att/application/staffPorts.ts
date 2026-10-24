import type { LeaveBalance, StaffDayStatus, StaffMonthCounts } from '../domain/staffAttendance.js';

export interface LeaveTypeRow {
  id: string;
  code: string;
  nameEn: string;
  annualQuotaDays: number;
  maxCarryForward: number;
  isPaid: boolean;
  genderRestriction: 'male' | 'female' | null;
  requiresDocumentAfterDays: number | null;
  countsHolidays: boolean;
}

export interface LeaveRequestRow {
  id: string;
  campusId: string;
  staffId: string;
  leaveTypeId: string;
  leaveCode: string;
  isPaid: boolean;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: number;
  reason: string | null;
  attachmentFileId: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  createdBy: string | null;
}

export interface StaffDayRow {
  staffId: string;
  attendanceDate: string;
  status: StaffDayStatus;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  source: 'device' | 'mobile_geo' | 'manual' | 'leave_auto';
}

export interface StaffAttRepository {
  leaveTypes(): Promise<LeaveTypeRow[]>;
  leaveType(id: string): Promise<LeaveTypeRow | null>;
  /** creates missing balances for the year (quota + capped carry-forward from the previous year) */
  ensureBalances(staffId: string, year: number, types: LeaveTypeRow[]): Promise<void>;
  balances(
    staffId: string,
    year: number,
  ): Promise<Array<LeaveBalance & { leaveTypeId: string; code: string; nameEn: string; isPaid: boolean }>>;
  lockBalance(staffId: string, leaveTypeId: string, year: number): Promise<LeaveBalance | null>;
  adjustBalance(
    staffId: string,
    leaveTypeId: string,
    year: number,
    delta: { pending?: number; taken?: number },
  ): Promise<void>;
  overlappingLeave(staffId: string, from: string, to: string): Promise<boolean>;
  insertLeave(values: Record<string, unknown>): Promise<string>;
  leave(id: string, forUpdate: boolean): Promise<LeaveRequestRow | null>;
  setLeaveStatus(id: string, status: LeaveRequestRow['status']): Promise<void>;
  leaves(f: {
    staffId?: string;
    campusId?: string;
    status?: string;
    from?: string;
    to?: string;
    limit: number;
  }): Promise<LeaveRequestRow[]>;
  // daily attendance
  upsertDays(rows: Array<Record<string, unknown>>): Promise<void>;
  deleteLeaveDays(staffId: string, dates: string[]): Promise<void>;
  day(staffId: string, date: string): Promise<StaffDayRow | null>;
  daysOn(campusId: string, date: string): Promise<StaffDayRow[]>;
  days(staffId: string, from: string, to: string): Promise<StaffDayRow[]>;
  monthCounts(staffIds: string[], from: string, to: string): Promise<Map<string, StaffMonthCounts>>;
}
