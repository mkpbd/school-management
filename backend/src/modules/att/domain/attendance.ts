import { InvariantError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';

export type DailyStatus = 'present' | 'absent' | 'late' | 'leave' | 'half_day' | 'excused' | 'holiday';

/** Statuses that alert the primary guardian (ATT-03). */
export const ALERT_STATUSES: ReadonlySet<DailyStatus> = new Set(['absent', 'late']);

/**
 * Edit window (ATT-01): teachers may mark today, or yesterday until `hours` after midnight (Asia/Dhaka).
 * Older dates need a correction request; future dates are never accepted.
 */
export function assertWithinEditWindow(date: string, now: Date, hours: number): void {
  const state = editWindow(date, now, hours).state;
  if (state === 'future')
    throw new InvariantError('ATTENDANCE_FUTURE_DATE', 'Attendance cannot be marked for a future date');
  if (state === 'closed')
    throw new InvariantError(
      'ATTENDANCE_EDIT_WINDOW_CLOSED',
      'The edit window has closed; submit an attendance correction instead',
    );
}

/** Marks of `date` are editable until `hours` after the following midnight (Asia/Dhaka). */
export function editWindow(
  date: string,
  now: Date,
  hours: number,
): { state: 'open' | 'closed' | 'future'; editableUntil: Date } {
  const target = LocalDate.parse(date);
  const editableUntil = new Date(new Date(`${target.addDays(1).iso}T00:00:00+06:00`).getTime() + hours * 3_600_000);
  if (target.isAfter(LocalDate.fromInstant(now))) return { state: 'future', editableUntil };
  return { state: now.getTime() <= editableUntil.getTime() ? 'open' : 'closed', editableUntil };
}

export type PeriodStatus = 'present' | 'absent' | 'late' | 'excused';

/**
 * Quick marking ("under a minute per class"): the teacher sends only the exceptions; with `restDefault` every other
 * student on the roster gets their suggested status (present, or leave / excused where that is already known).
 */
export function expandQuickMark<S extends string, E extends { studentId: string; status: S }>(
  roster: Array<{ studentId: string; suggested: S }>,
  exceptions: E[],
  markRest: boolean,
): Array<E | { studentId: string; status: S }> {
  if (new Set(exceptions.map((e) => e.studentId)).size !== exceptions.length)
    throw new InvariantError('DUPLICATE_ENTRY', 'A student appears twice');
  if (!markRest) {
    if (!exceptions.length) throw new InvariantError('NO_ENTRIES', 'Send entries or markRest');
    return exceptions;
  }
  const given = new Set(exceptions.map((e) => e.studentId));
  return [
    ...exceptions,
    ...roster.filter((r) => !given.has(r.studentId)).map((r) => ({ studentId: r.studentId, status: r.suggested })),
  ];
}

/** A period starts as the day says: absent all day -> absent; leave / excused / holiday -> excused; else present. */
export function suggestPeriodStatus(daily: DailyStatus | undefined): PeriodStatus {
  if (daily === 'absent') return 'absent';
  if (daily === 'leave' || daily === 'excused' || daily === 'holiday') return 'excused';
  return 'present';
}

/** Absent from a lesson while marked in school that day: the guardian is told (possible truancy). */
export function missedPeriod(daily: DailyStatus | undefined, period: PeriodStatus): boolean {
  return period === 'absent' && (daily === 'present' || daily === 'late' || daily === 'half_day');
}

/** Setting `attendance.period_wise_year_groups`: year-group codes taking period-wise attendance, or ["*"]. */
export function isPeriodWise(yearGroupCode: string | undefined, configured: string[] | null | undefined): boolean {
  const list = configured ?? [];
  return list.includes('*') || (yearGroupCode !== undefined && list.includes(yearGroupCode));
}

export interface CorrectionState {
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string;
}

/** Maker-checker: only a pending request, and never by the person who asked for it. */
export function assertCorrectionDecidable(c: CorrectionState, deciderUserId: string): void {
  if (c.status !== 'pending')
    throw new InvariantError('CORRECTION_ALREADY_DECIDED', `The correction is already ${c.status}`);
  if (c.requestedBy === deciderUserId)
    throw new InvariantError('SELF_APPROVAL', 'A correction must be approved by someone other than the requester');
}

export interface AttendanceSummary {
  present: number;
  absent: number;
  late: number;
  leave: number;
  halfDay: number;
  excused: number;
  countedDays: number;
  percent: number | null;
}

/**
 * Attendance % (data dictionary KPI): (present + late + 0.5 x half_day) / days counted,
 * where approved leave, excused and holidays are not counted.
 */
export function summarise(counts: Partial<Record<DailyStatus, number>>): AttendanceSummary {
  const c = (k: DailyStatus) => counts[k] ?? 0;
  const counted = c('present') + c('absent') + c('late') + c('half_day');
  const attended = c('present') + c('late') + 0.5 * c('half_day');
  return {
    present: c('present'),
    absent: c('absent'),
    late: c('late'),
    leave: c('leave'),
    halfDay: c('half_day'),
    excused: c('excused'),
    countedDays: counted,
    percent: counted ? Math.round((attended / counted) * 10_000) / 100 : null,
  };
}
