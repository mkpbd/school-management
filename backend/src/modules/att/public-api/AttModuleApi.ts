import type { StaffMonthSummary } from '../domain/staffAttendance.js';

export type { StaffMonthSummary };

/** Public API of ATT (HRM payroll reads monthly staff attendance through it). */
export interface AttModuleApi {
  /** unpaid days (lwpDays with breakdown) and overtime per staff member for a month, rules of the campus */
  staffMonthSummaries(campusId: string, staffIds: string[], month: string): Promise<Map<string, StaffMonthSummary>>;
}
