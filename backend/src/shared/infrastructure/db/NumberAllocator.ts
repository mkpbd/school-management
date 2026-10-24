import { sql } from 'drizzle-orm';
import { InvariantError } from '../../domain/errors.js';
import { SCHOOL_TIME_ZONE } from '../../domain/LocalDate.js';
import type { RequestContext } from '../../application/RequestContext.js';
import type { NumberAllocator } from '../../application/ports.js';
import type { Clock } from '../../domain/Clock.js';
import type { UnitOfWork } from './UnitOfWork.js';

/**
 * Gap-free numbering from core.number_sequence (docs/backend/cross-cutting.md §6.4).
 * The UPDATE ... RETURNING holds a row lock until commit; on rollback the number is not consumed.
 * A row with period_key '' is the template; per-period rows (e.g. '2026-27') are created lazily from it.
 */
export class PgNumberAllocator implements NumberAllocator {
  private readonly uow: UnitOfWork;
  private readonly ctx: RequestContext;
  private readonly clock: Clock;

  constructor(deps: { uow: UnitOfWork; ctx: RequestContext; clock: Clock }) {
    this.uow = deps.uow;
    this.ctx = deps.ctx;
    this.clock = deps.clock;
  }

  async next(input: { campusId: string | null; key: string; periodKey?: string; date?: Date }): Promise<string> {
    const tx = this.uow.tx();
    const period = input.periodKey ?? '';
    if (period !== '') {
      await tx.execute(sql`
        INSERT INTO core.number_sequence (org_id, campus_id, seq_key, period_key, format)
        SELECT org_id, campus_id, seq_key, ${period}, format FROM core.number_sequence
         WHERE org_id = ${this.ctx.orgId} AND campus_id IS NOT DISTINCT FROM ${input.campusId}
           AND seq_key = ${input.key} AND period_key = ''
        ON CONFLICT DO NOTHING`);
    }
    const take = () =>
      tx.execute<{ value: number; format: string; campus_code: string | null }>(sql`
        UPDATE core.number_sequence ns SET next_value = next_value + 1
         WHERE ns.org_id = ${this.ctx.orgId} AND ns.campus_id IS NOT DISTINCT FROM ${input.campusId}
           AND ns.seq_key = ${input.key} AND ns.period_key = ${period}
        RETURNING ns.next_value - 1 AS value, ns.format,
                  (SELECT code FROM core.campus c WHERE c.id = ns.campus_id) AS campus_code`);
    let result = await take();
    if (!result.rows[0] && input.campusId && period === '') {
      // a campus opened after seeding: start its sequence from another campus's format (numbering starts at 1)
      await tx.execute(sql`
        INSERT INTO core.number_sequence (org_id, campus_id, seq_key, period_key, format)
        SELECT org_id, ${input.campusId}::uuid, seq_key, '', format FROM core.number_sequence
         WHERE org_id = ${this.ctx.orgId} AND seq_key = ${input.key} AND period_key = '' AND campus_id IS NOT NULL
         ORDER BY campus_id LIMIT 1
        ON CONFLICT DO NOTHING`);
      result = await take();
    }
    const row = result.rows[0];
    if (!row) {
      throw new InvariantError('NUMBER_SEQUENCE_MISSING', `No number sequence '${input.key}' for this campus`);
    }
    return renderNumber(row.format, {
      seq: Number(row.value),
      campusCode: row.campus_code ?? '',
      period,
      date: input.date ?? this.clock.now(),
    });
  }
}

/** Renders tokens {CAMPUS} {PERIOD} {YYYY} {YY} {MM} {YYMM} {SEQ:n} (dates in Asia/Dhaka). */
export function renderNumber(
  format: string,
  v: { seq: number; campusCode: string; period: string; date: Date },
): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit' })
      .formatToParts(v.date)
      .map((p) => [p.type, p.value]),
  );
  const yyyy = parts.year ?? '0000';
  const mm = parts.month ?? '00';
  return format
    .replaceAll('{CAMPUS}', v.campusCode)
    .replaceAll('{PERIOD}', v.period)
    .replaceAll('{YYYY}', yyyy)
    .replaceAll('{YYMM}', `${yyyy.slice(2)}${mm}`)
    .replaceAll('{YY}', yyyy.slice(2))
    .replaceAll('{MM}', mm)
    .replace(/\{SEQ:(\d+)\}/g, (_, width: string) => String(v.seq).padStart(Number(width), '0'))
    .replaceAll('{SEQ}', String(v.seq));
}
