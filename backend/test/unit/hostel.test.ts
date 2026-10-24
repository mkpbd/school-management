import { describe, expect, it } from 'vitest';
import {
  assertCanCheckOut,
  assertGenderAllowed,
  defaultBeds,
  minutesLate,
} from '../../src/modules/hst/domain/hostel.js';

describe('hostel rules', () => {
  it('gender of the hostel', () => {
    expect(() => assertGenderAllowed('boys', 'male')).not.toThrow();
    expect(() => assertGenderAllowed('boys', 'female')).toThrow(/boys hostel/);
    expect(() => assertGenderAllowed('girls', 'male')).toThrow();
    expect(() => assertGenderAllowed('mixed', 'female')).not.toThrow();
  });

  it('beds per room type', () => {
    expect(defaultBeds('double')).toEqual(['A', 'B']);
    expect(defaultBeds('dormitory', 28).slice(-3)).toEqual(['Z', '27', '28']);
    expect(() => defaultBeds('dormitory')).toThrow(/number of beds/);
  });

  it('gate check-out window and lateness', () => {
    const outFrom = new Date('2091-08-12T16:00:00Z');
    const returnBy = new Date('2091-08-13T16:00:00Z');
    const pass = { status: 'approved' as const, outFrom, returnBy };
    expect(() => assertCanCheckOut(pass, new Date('2091-08-12T14:30:00Z'), 60)).toThrow(/later/);
    expect(() => assertCanCheckOut(pass, new Date('2091-08-12T15:10:00Z'), 60)).not.toThrow();
    expect(() => assertCanCheckOut(pass, returnBy, 60)).toThrow(/expired/);
    expect(() => assertCanCheckOut({ ...pass, status: 'pending' }, outFrom, 60)).toThrow(/pending/);
    expect(minutesLate(returnBy, new Date(returnBy.getTime() + 90_000))).toBe(1);
    expect(minutesLate(returnBy, outFrom)).toBe(0);
  });
});
