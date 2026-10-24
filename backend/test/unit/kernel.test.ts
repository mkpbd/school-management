import { describe, expect, it } from 'vitest';
import type { ZodError } from 'zod';
import { z } from 'zod';
import { ScopePolicy, type ScopeResolver } from '../../src/shared/application/ScopePolicy.js';
import { decodeCursor, encodeCursor, toPage } from '../../src/shared/application/pagination.js';
import type { RequestContext } from '../../src/shared/application/RequestContext.js';
import { FixedClock } from '../../src/shared/domain/Clock.js';
import {
  ConflictError,
  ForbiddenError,
  InvariantError,
  NotFoundError,
  ValidationError,
} from '../../src/shared/domain/errors.js';
import { LocalDate } from '../../src/shared/domain/LocalDate.js';
import { Money } from '../../src/shared/domain/Money.js';
import { AesGcmFieldCipher, HmacBlindIndexer } from '../../src/shared/infrastructure/crypto/FieldCipher.js';
import { renderNumber } from '../../src/shared/infrastructure/db/NumberAllocator.js';
import { mapPgError } from '../../src/shared/infrastructure/db/pg-errors.js';
import { canonicalJson } from '../../src/shared/infrastructure/idempotency/IdempotencyStore.js';
import { formatHijri, formatMoney, toBanglaDigits } from '../../src/shared/infrastructure/i18n/format.js';
import { toProblem } from '../../src/shared/http/problem.js';
import { smsSegments } from '../../src/modules/com/domain/smsSegments.js';
import { quietHoursEnd } from '../../src/modules/com/infrastructure/NotificationService.js';
import { lockedUntilAfterFailure } from '../../src/modules/iam/domain/model.js';

describe('Money (integer paisa)', () => {
  it('parses taka strings without floating point', () => {
    expect(Money.fromTaka('1250.5').paisa).toBe(125050);
    expect(Money.fromTaka('0.07').paisa).toBe(7);
    expect(Money.fromTaka('-30.25').paisa).toBe(-3025);
    expect(() => Money.fromTaka('1.234')).toThrow(InvariantError);
  });
  it('percent rounds half up on basis points', () => {
    expect(Money.ofPaisa(1001).percent('12.5').paisa).toBe(125); // 125.125 -> 125
    expect(Money.ofPaisa(1004).percent(12.5).paisa).toBe(126); // 125.5 -> 126
    expect(Money.ofPaisa(1_000_000).percent('10').paisa).toBe(100_000);
  });
  it('arithmetic and formatting', () => {
    const total = Money.sum([Money.fromTaka('100'), Money.fromTaka('0.10')]);
    expect(total.toTakaString()).toBe('100.10');
    expect(formatMoney(Money.ofPaisa(66_000_000))).toBe('৳6,60,000.00');
    expect(formatMoney(Money.ofPaisa(66_000_000), 'bn')).toBe('৳৬,৬০,০০০.০০');
    expect(() => Money.ofPaisa(0.5)).toThrow();
  });
});

describe('LocalDate (Asia/Dhaka)', () => {
  it('today uses Dhaka time, not UTC', () => {
    // 2026-11-02T19:30Z is 01:30 on 3 Nov in Dhaka (UTC+6)
    expect(LocalDate.today(new FixedClock(new Date('2026-11-02T19:30:00Z'))).iso).toBe('2026-11-03');
  });
  it('validates and does arithmetic', () => {
    expect(LocalDate.parse('2026-12-31').addDays(1).iso).toBe('2027-01-01');
    expect(() => LocalDate.parse('2026-02-30')).toThrow(InvariantError);
    expect(LocalDate.parse('2026-11-07').dayOfWeek()).toBe(6); // Saturday
    expect(LocalDate.parse('2026-11-01').daysUntil(LocalDate.parse('2026-11-10'))).toBe(9);
  });
});

describe('i18n', () => {
  it('Bangla digits and Hijri calendar', () => {
    expect(toBanglaDigits('2026-27')).toBe('২০২৬-২৭');
    expect(formatHijri(new Date('2026-11-03T06:00:00Z'))).toMatch(/AH/);
  });
});

describe('number formats', () => {
  it('renders tokens in Asia/Dhaka', () => {
    const date = new Date('2026-10-31T19:00:00Z'); // 1 Nov 01:00 in Dhaka
    expect(renderNumber('RCP-{CAMPUS}-{YY}-{SEQ:6}', { seq: 42, campusCode: 'DHN', period: '', date })).toBe(
      'RCP-DHN-26-000042',
    );
    expect(renderNumber('INV-{CAMPUS}-{YYMM}-{SEQ:5}', { seq: 7, campusCode: 'GUL', period: '', date })).toBe(
      'INV-GUL-2611-00007',
    );
    expect(renderNumber('{CAMPUS}-{PERIOD}-{SEQ}', { seq: 3, campusCode: 'LAL', period: '2026-27', date })).toBe(
      'LAL-2026-27-3',
    );
  });
});

describe('field encryption & blind index', () => {
  const key = Buffer.alloc(32, 7);
  it('round-trips and is non-deterministic', () => {
    const cipher = new AesGcmFieldCipher({ v1: key }, 'v1');
    const a = cipher.encrypt('1990123456789');
    const b = cipher.encrypt('1990123456789');
    expect(a.equals(b)).toBe(false);
    expect(cipher.decrypt(a)).toBe('1990123456789');
    expect(cipher.versionOf(a)).toBe('v1');
  });
  it('detects tampering and supports key rotation', () => {
    const v1 = new AesGcmFieldCipher({ v1: key }, 'v1');
    const enc = v1.encrypt('secret');
    const tampered = Buffer.from(enc);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => v1.decrypt(tampered)).toThrow();
    const v2 = new AesGcmFieldCipher({ v1: key, v2: Buffer.alloc(32, 9) }, 'v2');
    expect(v2.decrypt(enc)).toBe('secret');
    expect(v2.versionOf(v2.encrypt('x'))).toBe('v2');
  });
  it('blind index normalises identifiers', () => {
    const bidx = new HmacBlindIndexer(Buffer.alloc(32, 1));
    expect(bidx.of('1990-1234 5678').equals(bidx.of('199012345678'))).toBe(true);
    expect(bidx.of('A1').equals(bidx.of('a1'))).toBe(true);
  });
});

describe('SMS segments', () => {
  it('GSM-7 vs UCS-2 (Bangla)', () => {
    expect(smsSegments('Hello').encoding).toBe('gsm7');
    expect(smsSegments('a'.repeat(160)).segments).toBe(1);
    expect(smsSegments('a'.repeat(161)).segments).toBe(2);
    const bn = smsSegments('প্রিয় অভিভাবক, আপনার সন্তান আজ অনুপস্থিত।');
    expect(bn.encoding).toBe('ucs2');
    expect(smsSegments('অ'.repeat(70)).segments).toBe(1);
    expect(smsSegments('অ'.repeat(71)).segments).toBe(2);
    expect(smsSegments('{}').length).toBe(4); // extended chars count double
  });
});

describe('quiet hours (Asia/Dhaka)', () => {
  it('delays inside the window, not outside', () => {
    const at2230 = new Date('2026-11-03T16:30:00Z'); // 22:30 Dhaka
    const end = quietHoursEnd(at2230, '21:30', '07:00');
    expect(end?.toISOString()).toBe('2026-11-04T01:00:00.000Z'); // 07:00 Dhaka
    expect(quietHoursEnd(new Date('2026-11-03T06:00:00Z'), '21:30', '07:00')).toBeNull(); // 12:00 Dhaka
  });
});

describe('pagination cursor', () => {
  it('round-trips and rejects garbage', () => {
    const c = encodeCursor({ k: ['2026-11-01', 5], id: 'abc' });
    expect(decodeCursor(c)).toEqual({ k: ['2026-11-01', 5], id: 'abc' });
    expect(() => decodeCursor('not-a-cursor')).toThrow(ValidationError);
    const page = toPage([{ id: '1' }, { id: '2' }, { id: '3' }], 2, (r) => ({ k: [], id: r.id }));
    expect(page.items).toHaveLength(2);
    expect(decodeCursor(page.nextCursor!)!.id).toBe('2');
  });
});

describe('IAM lockout policy', () => {
  it('locks from the 10th failure with growing duration', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(lockedUntilAfterFailure(9, now)).toBeNull();
    expect(lockedUntilAfterFailure(10, now)!.getTime() - now.getTime()).toBe(15 * 60_000);
    expect(lockedUntilAfterFailure(11, now)!.getTime() - now.getTime()).toBe(30 * 60_000);
    expect(lockedUntilAfterFailure(30, now)!.getTime() - now.getTime()).toBe(24 * 3600_000);
  });
});

describe('ScopePolicy', () => {
  const ctx = (over: Partial<RequestContext>): RequestContext => ({
    requestId: 'r',
    orgId: 'org',
    userId: 'u1',
    userType: 'staff',
    locale: 'en',
    campusIds: ['dhn'],
    grants: { campusIds: ['dhn'], byPermission: {} },
    ...over,
  });

  it('campus grants cover only their campus', async () => {
    const policy = new ScopePolicy({
      ctx: ctx({
        grants: { campusIds: ['dhn'], byPermission: { 'fee.payment.create': [{ scope: 'campus', campusId: 'dhn' }] } },
      }),
      scopeResolvers: [],
    });
    expect(await policy.allows('fee.payment.create', { campusId: 'dhn' })).toBe(true);
    expect(await policy.allows('fee.payment.create', { campusId: 'gul' })).toBe(false);
    await expect(policy.assert('fee.payment.create', { campusId: 'gul' })).rejects.toBeInstanceOf(ForbiddenError);
    expect(() => policy.requireCampus('gul')).toThrow(ForbiddenError);
    expect(policy.requireCampus('dhn')).toBe('dhn');
  });

  it('relational scopes are delegated to resolvers; guardians get 404 (no IDOR leak)', async () => {
    const ownChildren: ScopeResolver = { scope: 'own_children', includes: async (_c, t) => t.studentId === 'kid-1' };
    const policy = new ScopePolicy({
      ctx: ctx({
        userType: 'guardian',
        campusIds: '*',
        grants: { campusIds: '*', byPermission: { 'prt.portal.view': [{ scope: 'own_children', campusId: null }] } },
      }),
      scopeResolvers: [ownChildren],
    });
    expect(await policy.allows('prt.portal.view', { studentId: 'kid-1' })).toBe(true);
    await expect(policy.assert('prt.portal.view', { studentId: 'kid-2' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('error mapping', () => {
  const pgErr = (code: string, extra: Record<string, unknown> = {}) => ({
    code,
    severity: 'ERROR',
    message: 'x',
    ...extra,
  });

  it('maps PostgreSQL errors (also when wrapped) to stable API codes', () => {
    expect(mapPgError(pgErr('23505'))).toBeInstanceOf(ConflictError);
    expect(mapPgError(pgErr('23P01'))?.code).toBe('OVERLAP');
    expect(
      mapPgError({ message: 'drizzle', cause: pgErr('P0001', { message: 'paper 1 is locked, marks are locked' }) })
        ?.code,
    ).toBe('PAPER_LOCKED');
    expect(
      mapPgError(pgErr('23514', { table: 'stock_balance', constraint: 'stock_balance_qty_on_hand_check' }))?.code,
    ).toBe('INSUFFICIENT_STOCK');
    expect(mapPgError(new Error('not pg'))).toBeUndefined();
  });

  it('problem+json never leaks internals', () => {
    const internal = toProblem(new Error('SELECT * FROM secrets'), 'req-1', 'en');
    expect(internal.body).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', requestId: 'req-1' });
    expect(JSON.stringify(internal.body)).not.toContain('secrets');
    let zerr: ZodError | undefined;
    try {
      z.object({ a: z.number() }).parse({ a: 'x' });
    } catch (e) {
      zerr = e as ZodError;
    }
    const validation = toProblem(zerr, 'req-2', 'bn');
    expect(validation.body.status).toBe(422);
    expect(validation.body.title).toBe('তথ্য সঠিক নয়');
    expect(validation.body.errors?.[0]?.path).toBe('a');
  });

  it('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [1, { y: 1, x: 2 }] } })).toBe(
      canonicalJson({ a: { c: [1, { x: 2, y: 1 }], d: 2 }, b: 1 }),
    );
  });
});
