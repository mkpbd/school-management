import { describe, expect, it } from 'vitest';
import { LocalDate } from '../../src/shared/domain/LocalDate.js';
import { assessFine, copyStatusAfterReturn, memberTypeOf, overdueDays } from '../../src/modules/lib/domain/library.js';

describe('library rules', () => {
  it('member type from year group order and staff type', () => {
    expect(memberTypeOf({ type: 'student', yearGroupSeq: 9 }, 10)).toBe('student_junior');
    expect(memberTypeOf({ type: 'student', yearGroupSeq: 10 }, 10)).toBe('student_senior');
    expect(memberTypeOf({ type: 'student', yearGroupSeq: null }, 10)).toBe('student_junior');
    expect(memberTypeOf({ type: 'staff', staffType: 'teaching' }, 10)).toBe('teacher');
    expect(memberTypeOf({ type: 'staff', staffType: 'support' }, 10)).toBe('staff');
  });

  it('overdue days are calendar days, never negative', () => {
    const due = LocalDate.parse('2091-03-10');
    expect(overdueDays(due, LocalDate.parse('2091-03-09'))).toBe(0);
    expect(overdueDays(due, LocalDate.parse('2091-03-10'))).toBe(0);
    expect(overdueDays(due, LocalDate.parse('2091-03-13'))).toBe(3);
  });

  it('fine = capped overdue part + replacement (lost) or damage', () => {
    const base = { finePerDayPaisa: 500, overdueCapPaisa: null, replacementPaisa: 80_000, damagePaisa: 0 };
    expect(assessFine({ ...base, overdueDays: 4, condition: 'good' })).toEqual({
      overduePaisa: 2_000,
      replacementPaisa: 0,
      damagePaisa: 0,
      totalPaisa: 2_000,
    });
    expect(assessFine({ ...base, overdueDays: 100, overdueCapPaisa: 10_000, condition: 'good' }).totalPaisa).toBe(
      10_000,
    );
    expect(assessFine({ ...base, overdueDays: 2, condition: 'lost' }).totalPaisa).toBe(81_000);
    expect(assessFine({ ...base, overdueDays: 0, condition: 'damaged', damagePaisa: 15_000 }).totalPaisa).toBe(15_000);
    // damage is only charged for a damaged copy
    expect(assessFine({ ...base, overdueDays: 0, condition: 'good', damagePaisa: 15_000 }).totalPaisa).toBe(0);
    expect(() => assessFine({ ...base, overdueDays: 0, condition: 'damaged', damagePaisa: -1 })).toThrow();
  });

  it('copy status after return', () => {
    expect(copyStatusAfterReturn('good')).toBe('available');
    expect(copyStatusAfterReturn('damaged')).toBe('damaged');
    expect(copyStatusAfterReturn('lost')).toBe('lost');
  });
});
