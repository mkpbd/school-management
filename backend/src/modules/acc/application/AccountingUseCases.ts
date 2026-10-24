import type { NumberAllocator, TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { ConflictError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import {
  assertBalanced,
  DEFAULT_PAYROLL_ACCOUNTS,
  naturalBalance,
  payrollJournal,
  type AccountKind,
  type EntryLine,
  type PayrollAccountMap,
} from '../domain/journal.js';
import type { AccRepository, BalanceRow, JournalRow, PeriodRow } from './ports.js';

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  accRepo: AccRepository;
  scopePolicy: ScopePolicy;
  numbers: NumberAllocator;
  coreApi: CoreModuleApi;
}

export interface PostInput {
  campusId: string;
  date: string;
  voucherType: 'receipt' | 'payment' | 'journal' | 'contra';
  narration: string;
  lines: EntryLine[];
  source?: { module: string; type: string; id: string };
  reversalOfId?: string;
}

/**
 * Posts a balanced journal into the fiscal period of its date (a locked period refuses; the DB trigger checks
 * balance and lock again at commit). Auto-postings are idempotent per source.
 */
export async function postJournal(d: Pick<Deps, 'ctx' | 'accRepo' | 'numbers'>, i: PostInput): Promise<JournalRow> {
  assertBalanced(i.lines);
  if (i.source) {
    const existing = await d.accRepo.journalBySource(i.source.module, i.source.type, i.source.id);
    if (existing) return existing;
  }
  const accounts = await d.accRepo.accountsByCode([...new Set(i.lines.map((l) => l.accountCode))]);
  for (const l of i.lines) {
    const a = accounts.get(l.accountCode);
    if (!a) throw new InvariantError('ACCOUNT_UNKNOWN', `Account ${l.accountCode} does not exist`);
    if (!a.isPostable || !a.isActive)
      throw new InvariantError('ACCOUNT_NOT_POSTABLE', `Account ${l.accountCode} is a group or inactive account`);
  }
  const period = await d.accRepo.periodFor(d.ctx.orgId, i.date);
  if (period.status === 'locked') throw new ConflictError('PERIOD_LOCKED', `Fiscal period ${period.code} is locked`);
  const id = await d.accRepo.insertJournal({
    orgId: d.ctx.orgId,
    campusId: i.campusId,
    journalNo: await d.numbers.next({ campusId: i.campusId, key: 'journal', date: new Date(`${i.date}T06:00:00Z`) }),
    voucherType: i.voucherType,
    journalDate: i.date,
    fiscalPeriodId: period.id,
    narration: i.narration,
    sourceModule: i.source?.module ?? null,
    sourceType: i.source?.type ?? null,
    sourceId: i.source?.id ?? null,
    reversalOfId: i.reversalOfId ?? null,
  });
  await d.accRepo.insertLines(
    i.lines.map((l) => ({
      journalId: id,
      orgId: d.ctx.orgId,
      campusId: i.campusId,
      accountId: accounts.get(l.accountCode)!.id,
      debitPaisa: l.debitPaisa,
      creditPaisa: l.creditPaisa,
      memo: l.memo ?? null,
      costCentreId: l.costCentreId ?? null,
      partyType: l.partyType ?? null,
      partyId: l.partyId ?? null,
    })),
  );
  return (await d.accRepo.journal(id))!;
}

async function payrollAccounts(d: Deps, campusId: string): Promise<PayrollAccountMap> {
  const custom = (await d.coreApi.getSetting<Partial<PayrollAccountMap>>('acc.payroll_accounts', campusId)) ?? {};
  return { ...DEFAULT_PAYROLL_ACCOUNTS, ...custom };
}

// ---------------------------------------------------------------------------------------------------------------
// Manual journals
// ---------------------------------------------------------------------------------------------------------------

export class CreateJournal extends UseCase<
  Omit<PostInput, 'source' | 'reversalOfId' | 'campusId'> & { campusId?: string },
  JournalRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: Omit<PostInput, 'source' | 'reversalOfId' | 'campusId'> & { campusId?: string }) {
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    return postJournal(this.d, { ...i, campusId });
  }
}

/** Posted journals are never edited: a reversal swaps every line, dated today (or the given date). */
export class ReverseJournal extends UseCase<{ id: string; date?: string; reason: string }, JournalRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; date?: string; reason: string }) {
    const j = await this.d.accRepo.journal(i.id);
    if (!j) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(j.campusId);
    if (j.reversalOfId) throw new ConflictError('IS_REVERSAL', 'A reversal cannot be reversed; post a new journal');
    if (j.reversedById) throw new ConflictError('ALREADY_REVERSED', 'This journal was already reversed');
    return postJournal(this.d, {
      campusId: j.campusId,
      date: i.date ?? LocalDate.today(this.d.clock).iso,
      voucherType: 'journal',
      narration: `Reversal of ${j.journalNo}: ${i.reason}`,
      reversalOfId: j.id,
      lines: j.lines!.map((l) => ({
        accountCode: l.accountCode,
        debitPaisa: l.creditPaisa,
        creditPaisa: l.debitPaisa,
        memo: l.memo,
        partyType: l.partyType as EntryLine['partyType'],
        partyId: l.partyId,
      })),
    });
  }
}

export class GetJournal extends Query<{ id: string }, JournalRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const j = await this.d.accRepo.journal(id);
    if (!j) throw new NotFoundError();
    return j;
  }
}

export class ListJournals extends Query<
  { campusId?: string; from?: string; to?: string; sourceModule?: string; limit: number; offset: number },
  JournalRow[]
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: {
    campusId?: string;
    from?: string;
    to?: string;
    sourceModule?: string;
    limit: number;
    offset: number;
  }) {
    return this.d.accRepo.journals(i);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------------------------

export interface TrialBalance {
  asOf: string;
  rows: Array<BalanceRow & { balancePaisa: number; side: 'debit' | 'credit' }>;
  totals: { debitPaisa: number; creditPaisa: number; balanced: boolean };
}

/** Closing balances up to a date (optionally one campus); debit total equals credit total. */
export class GetTrialBalance extends Query<{ campusId?: string; asOf: string }, TrialBalance> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { campusId?: string; asOf: string }) {
    const rows = (await this.d.accRepo.balances({ campusId: i.campusId, to: i.asOf })).map((r) => {
      const net = r.debitPaisa - r.creditPaisa;
      return { ...r, balancePaisa: Math.abs(net), side: net >= 0 ? ('debit' as const) : ('credit' as const) };
    });
    const debit = rows.filter((r) => r.side === 'debit').reduce((s, r) => s + r.balancePaisa, 0);
    const credit = rows.filter((r) => r.side === 'credit').reduce((s, r) => s + r.balancePaisa, 0);
    return { asOf: i.asOf, rows, totals: { debitPaisa: debit, creditPaisa: credit, balanced: debit === credit } };
  }
}

export interface Ledger {
  account: { id: string; code: string; nameEn: string; kind: AccountKind };
  from: string;
  to: string;
  openingPaisa: number;
  lines: Array<{
    journalId: string;
    journalNo: string;
    journalDate: string;
    narration: string;
    debitPaisa: number;
    creditPaisa: number;
    memo: string | null;
    balancePaisa: number;
  }>;
  closingPaisa: number;
}

/** Account ledger with a running balance in the account's natural direction. */
export class GetLedger extends Query<{ accountId: string; campusId?: string; from: string; to: string }, Ledger> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { accountId: string; campusId?: string; from: string; to: string }) {
    const a = await this.d.accRepo.account(i.accountId);
    if (!a) throw new NotFoundError();
    const { opening, lines } = await this.d.accRepo.ledger(a.id, i);
    let balance = naturalBalance(a.kind, opening.debitPaisa, opening.creditPaisa);
    const openingPaisa = balance;
    const out = lines.map((l) => {
      balance += naturalBalance(a.kind, l.debitPaisa, l.creditPaisa);
      return { ...l, balancePaisa: balance };
    });
    return {
      account: { id: a.id, code: a.code, nameEn: a.nameEn, kind: a.kind },
      from: i.from,
      to: i.to,
      openingPaisa,
      lines: out,
      closingPaisa: balance,
    };
  }
}

export class ListPeriods extends Query<Record<string, never>, PeriodRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle() {
    return this.d.accRepo.periods();
  }
}

export class SetPeriodStatus extends UseCase<
  { code: string; status: PeriodRow['status'] },
  { code: string; status: string }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { code: string; status: PeriodRow['status'] }) {
    if (!(await this.d.accRepo.setPeriodStatus(i.code, i.status, this.d.ctx.userId!, this.d.clock.now())))
      throw new NotFoundError();
    return i;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Auto-postings (event subscribers run these in the system context)
// ---------------------------------------------------------------------------------------------------------------

/** hrm.payroll_locked: salary journal on the last day of the payroll month. */
export class PostPayrollJournal extends UseCase<
  {
    runId: string;
    campusId: string;
    month: string;
    components: Array<{ code: string; kind: string; amountPaisa: number }>;
  },
  JournalRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    runId: string;
    campusId: string;
    month: string;
    components: Array<{ code: string; kind: string; amountPaisa: number }>;
  }) {
    const [y, m] = i.month.split('-').map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return postJournal(this.d, {
      campusId: i.campusId,
      date: `${i.month}-${String(last).padStart(2, '0')}`,
      voucherType: 'journal',
      narration: `Salaries for ${i.month}`,
      source: { module: 'hrm', type: 'payroll_run', id: i.runId },
      lines: payrollJournal(i.components, await payrollAccounts(this.d, i.campusId)),
    });
  }
}

/** hrm.payroll_paid: Dr salaries payable, Cr bank, on the payment date. */
export class PostPayrollPayment extends UseCase<
  { runId: string; campusId: string; month: string; netPaisa: number; paymentReference: string; paidOn: string },
  JournalRow | null
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    runId: string;
    campusId: string;
    month: string;
    netPaisa: number;
    paymentReference: string;
    paidOn: string;
  }) {
    if (i.netPaisa <= 0) return null;
    const map = await payrollAccounts(this.d, i.campusId);
    return postJournal(this.d, {
      campusId: i.campusId,
      date: i.paidOn,
      voucherType: 'payment',
      narration: `Salaries ${i.month} paid (${i.paymentReference})`,
      source: { module: 'hrm', type: 'payroll_payment', id: i.runId },
      lines: [
        { accountCode: map.payable, debitPaisa: i.netPaisa, creditPaisa: 0, memo: i.paymentReference },
        { accountCode: map.bank, debitPaisa: 0, creditPaisa: i.netPaisa, memo: i.paymentReference },
      ],
    });
  }
}
