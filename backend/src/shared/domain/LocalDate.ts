import { InvariantError } from './errors.js';
import type { Clock } from './Clock.js';

export const SCHOOL_TIME_ZONE = 'Asia/Dhaka';

/**
 * A calendar date without time (school days, due dates). Stored as 'YYYY-MM-DD' (Postgres `date`, mode 'string').
 * "Today" is always computed in Asia/Dhaka, never in UTC (a late-fee job at 00:30 Dhaka is still the previous UTC day).
 */
export class LocalDate {
  private constructor(readonly iso: string) {}

  static parse(value: string): LocalDate {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InvariantError('DATE_INVALID', `Invalid date: ${value}`);
    const d = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
      throw new InvariantError('DATE_INVALID', `Invalid date: ${value}`);
    }
    return new LocalDate(value);
  }

  static today(clock: Clock, timeZone = SCHOOL_TIME_ZONE): LocalDate {
    return LocalDate.fromInstant(clock.now(), timeZone);
  }

  static fromInstant(instant: Date, timeZone = SCHOOL_TIME_ZONE): LocalDate {
    // en-CA formats as YYYY-MM-DD
    const iso = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
    return new LocalDate(iso);
  }

  private toUtc(): Date {
    return new Date(`${this.iso}T00:00:00Z`);
  }

  addDays(days: number): LocalDate {
    const d = this.toUtc();
    d.setUTCDate(d.getUTCDate() + days);
    return new LocalDate(d.toISOString().slice(0, 10));
  }

  /** 0 = Sunday ... 6 = Saturday (Bangladesh school week is Saturday-Thursday). */
  dayOfWeek(): number {
    return this.toUtc().getUTCDay();
  }

  daysUntil(other: LocalDate): number {
    return Math.round((other.toUtc().getTime() - this.toUtc().getTime()) / 86_400_000);
  }

  isBefore(other: LocalDate): boolean {
    return this.iso < other.iso;
  }

  isAfter(other: LocalDate): boolean {
    return this.iso > other.iso;
  }

  equals(other: LocalDate): boolean {
    return this.iso === other.iso;
  }

  toString(): string {
    return this.iso;
  }

  toJSON(): string {
    return this.iso;
  }
}
