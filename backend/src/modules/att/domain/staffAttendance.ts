import { InvariantError } from '../../../shared/domain/errors.js';

export type StaffDayStatus =
  'present' | 'absent' | 'late' | 'leave' | 'half_day' | 'holiday' | 'weekly_off' | 'on_duty';

/** Minutes since local midnight (Asia/Dhaka by default) of an instant. */
export function minutesOfDay(at: Date, timeZone = 'Asia/Dhaka'): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(at)
    .reduce<Record<string, string>>((m, p) => ({ ...m, [p.type]: p.value }), {});
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function parseHhMm(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) throw new InvariantError('TIME_INVALID', `Time must be HH:MM, got ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes late after the grace period (0 when on time). */
export function lateMinutes(checkIn: Date, startHhMm: string, graceMinutes: number): number {
  const late = minutesOfDay(checkIn) - parseHhMm(startHhMm);
  return late > graceMinutes ? late : 0;
}

/** Overtime after the end of the day; short stays below `minimum` minutes do not count. */
export function overtimeMinutes(checkOut: Date, endHhMm: string, minimum: number): number {
  const extra = minutesOfDay(checkOut) - parseHhMm(endHhMm);
  return extra >= minimum ? extra : 0;
}

export function earlyLeaveMinutes(checkOut: Date, endHhMm: string): number {
  return Math.max(0, parseHhMm(endHhMm) - minutesOfDay(checkOut));
}

export interface StaffMonthCounts {
  present: number;
  late: number;
  absent: number;
  halfDay: number;
  leave: number;
  /** leave days of unpaid leave types (half-day requests count 0.5) */
  unpaidLeave: number;
  onDuty: number;
  overtimeMinutes: number;
}

export interface PayRules {
  /** an explicit "absent" day is a day without pay */
  absentIsLwp: boolean;
  /** a "half day" (worked half, no leave) costs half a day */
  halfDayIsLwp: boolean;
  /** every N late days cost one day (0 = off) */
  latesPerLwpDay: number;
}

export interface StaffMonthSummary extends StaffMonthCounts {
  paidLeave: number;
  lwpDays: number;
  /** how lwpDays was made up, for the payroll sheet */
  lwpBreakdown: { unpaidLeave: number; absent: number; halfDay: number; late: number };
}

/** HRM-04 input from ATT: unpaid days and overtime of a staff member for a month. */
export function summariseStaffMonth(c: StaffMonthCounts, rules: PayRules): StaffMonthSummary {
  const breakdown = {
    unpaidLeave: c.unpaidLeave,
    absent: rules.absentIsLwp ? c.absent : 0,
    halfDay: rules.halfDayIsLwp ? c.halfDay * 0.5 : 0,
    late: rules.latesPerLwpDay > 0 ? Math.floor(c.late / rules.latesPerLwpDay) : 0,
  };
  return {
    ...c,
    paidLeave: Math.max(0, c.leave - c.unpaidLeave),
    lwpDays: breakdown.unpaidLeave + breakdown.absent + breakdown.halfDay + breakdown.late,
    lwpBreakdown: breakdown,
  };
}

export interface LeaveBalance {
  entitled: number;
  carried: number;
  taken: number;
  pending: number;
}

export const available = (b: LeaveBalance): number => b.entitled + b.carried - b.taken - b.pending;
