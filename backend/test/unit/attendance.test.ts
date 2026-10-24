import { describe, expect, it } from 'vitest';
import {
  assertCorrectionDecidable,
  assertWithinEditWindow,
  editWindow,
  expandQuickMark,
  isPeriodWise,
  missedPeriod,
  suggestPeriodStatus,
  type DailyStatus,
} from '../../src/modules/att/domain/attendance.js';

const dhaka = (local: string) => new Date(`${local}+06:00`);

describe('edit window', () => {
  it('today and yesterday until N hours after midnight; older is closed, future refused', () => {
    expect(editWindow('2092-03-02', dhaka('2092-03-02T09:00:00'), 12).state).toBe('open');
    expect(editWindow('2092-03-01', dhaka('2092-03-02T11:59:00'), 12).state).toBe('open');
    expect(editWindow('2092-03-01', dhaka('2092-03-02T12:01:00'), 12).state).toBe('closed');
    expect(editWindow('2092-02-28', dhaka('2092-03-02T01:00:00'), 12).state).toBe('closed');
    expect(editWindow('2092-03-03', dhaka('2092-03-02T23:00:00'), 12).state).toBe('future');
    expect(editWindow('2092-03-01', dhaka('2092-03-02T09:00:00'), 12).editableUntil.toISOString()).toBe(
      '2092-03-02T06:00:00.000Z',
    );
    expect(() => assertWithinEditWindow('2092-02-28', dhaka('2092-03-02T09:00:00'), 12)).toThrow(
      expect.objectContaining({ code: 'ATTENDANCE_EDIT_WINDOW_CLOSED' }),
    );
    expect(() => assertWithinEditWindow('2092-03-03', dhaka('2092-03-02T09:00:00'), 12)).toThrow(
      expect.objectContaining({ code: 'ATTENDANCE_FUTURE_DATE' }),
    );
  });
});

describe('quick marking', () => {
  const roster: Array<{ studentId: string; suggested: DailyStatus }> = [
    { studentId: 'a', suggested: 'present' },
    { studentId: 'b', suggested: 'leave' },
    { studentId: 'c', suggested: 'present' },
  ];

  it('fills everyone not listed with their suggested status', () => {
    const out = expandQuickMark(roster, [{ studentId: 'c', status: 'absent' as const }], true);
    expect(out).toEqual([
      { studentId: 'c', status: 'absent' },
      { studentId: 'a', status: 'present' },
      { studentId: 'b', status: 'leave' },
    ]);
  });

  it('without markRest only the entries are marked; empty or duplicate input is refused', () => {
    expect(expandQuickMark(roster, [{ studentId: 'a', status: 'late' as const }], false)).toHaveLength(1);
    expect(() => expandQuickMark(roster, [], false)).toThrow(expect.objectContaining({ code: 'NO_ENTRIES' }));
    expect(() =>
      expandQuickMark(
        roster,
        [
          { studentId: 'a', status: 'late' as const },
          { studentId: 'a', status: 'absent' as const },
        ],
        true,
      ),
    ).toThrow(expect.objectContaining({ code: 'DUPLICATE_ENTRY' }));
  });
});

describe('period-wise rules', () => {
  it('a lesson starts from the day register', () => {
    expect(suggestPeriodStatus(undefined)).toBe('present');
    expect(suggestPeriodStatus('late')).toBe('present');
    expect(suggestPeriodStatus('absent')).toBe('absent');
    expect(suggestPeriodStatus('leave')).toBe('excused');
    expect(suggestPeriodStatus('excused')).toBe('excused');
  });

  it('missing a lesson counts only when the student was at school', () => {
    expect(missedPeriod('present', 'absent')).toBe(true);
    expect(missedPeriod('late', 'absent')).toBe(true);
    expect(missedPeriod('absent', 'absent')).toBe(false);
    expect(missedPeriod(undefined, 'absent')).toBe(false);
    expect(missedPeriod('present', 'late')).toBe(false);
  });

  it('senior years from the setting, or every year with *', () => {
    expect(isPeriodWise('Y10', ['Y10', 'Y11'])).toBe(true);
    expect(isPeriodWise('Y7', ['Y10', 'Y11'])).toBe(false);
    expect(isPeriodWise('Y7', ['*'])).toBe(true);
    expect(isPeriodWise('Y10', null)).toBe(false);
  });
});

describe('corrections', () => {
  it('maker-checker: pending only, never the requester', () => {
    expect(() => assertCorrectionDecidable({ status: 'pending', requestedBy: 'u1' }, 'u1')).toThrow(
      expect.objectContaining({ code: 'SELF_APPROVAL' }),
    );
    expect(() => assertCorrectionDecidable({ status: 'approved', requestedBy: 'u1' }, 'u2')).toThrow(
      expect.objectContaining({ code: 'CORRECTION_ALREADY_DECIDED' }),
    );
    expect(() => assertCorrectionDecidable({ status: 'pending', requestedBy: 'u1' }, 'u2')).not.toThrow();
  });
});
