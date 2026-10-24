import { InvariantError } from './errors.js';

/**
 * Money in integer paisa (1 BDT = 100 paisa). Never floating point (spec §5.4).
 * Paisa values are JS safe integers (up to ~90 trillion taka), matching the `core.paisa` bigint domain.
 */
export class Money {
  private constructor(readonly paisa: number) {
    if (!Number.isSafeInteger(paisa))
      throw new InvariantError('MONEY_INVALID', `Money must be integer paisa: ${paisa}`);
  }

  static zero(): Money {
    return new Money(0);
  }

  static ofPaisa(paisa: number): Money {
    return new Money(paisa);
  }

  /** Parses a taka string such as "1250.5" or "-30.25" without floating-point arithmetic. */
  static fromTaka(text: string): Money {
    const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
    if (!m) throw new InvariantError('MONEY_INVALID', `Invalid amount: ${text}`);
    const paisa = Number(m[2]) * 100 + Number((m[3] ?? '0').padEnd(2, '0'));
    return new Money(m[1] ? -paisa : paisa);
  }

  static sum(values: Money[]): Money {
    return values.reduce((acc, v) => acc.add(v), Money.zero());
  }

  add(other: Money): Money {
    return new Money(this.paisa + other.paisa);
  }

  subtract(other: Money): Money {
    return new Money(this.paisa - other.paisa);
  }

  negate(): Money {
    return new Money(-this.paisa);
  }

  min(other: Money): Money {
    return this.paisa <= other.paisa ? this : other;
  }

  /** Percentage with round-half-up on integer basis points: 12.5% of 1001 paisa = 125 paisa. */
  percent(pct: string | number): Money {
    const bp = Math.round(Number(pct) * 100); // basis points
    if (!Number.isFinite(bp) || bp < 0) throw new InvariantError('PERCENT_INVALID', `Invalid percent: ${pct}`);
    const raw = this.paisa * bp;
    const result = Math.sign(raw) * Math.floor((Math.abs(raw) + 5_000) / 10_000);
    return new Money(result);
  }

  isZero(): boolean {
    return this.paisa === 0;
  }

  isPositive(): boolean {
    return this.paisa > 0;
  }

  isNegative(): boolean {
    return this.paisa < 0;
  }

  gt(other: Money): boolean {
    return this.paisa > other.paisa;
  }

  gte(other: Money): boolean {
    return this.paisa >= other.paisa;
  }

  equals(other: Money): boolean {
    return this.paisa === other.paisa;
  }

  /** "1250.50" (no grouping) for APIs and CSV. */
  toTakaString(): string {
    const abs = Math.abs(this.paisa);
    return `${this.paisa < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  }

  toJSON(): number {
    return this.paisa;
  }
}
