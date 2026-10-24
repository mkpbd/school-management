import { InvariantError } from '../../../shared/domain/errors.js';

export type AccountKind = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface EntryLine {
  accountCode: string;
  debitPaisa: number;
  creditPaisa: number;
  memo?: string | null;
  partyType?: 'family' | 'vendor' | 'staff' | null;
  partyId?: string | null;
  costCentreId?: string | null;
}

/** Double entry: every line one side, positive whole paisa; debits equal credits; never empty. */
export function assertBalanced(lines: EntryLine[]): { totalPaisa: number } {
  if (lines.length < 2) throw new InvariantError('JOURNAL_TOO_SHORT', 'A journal needs at least two lines');
  let dr = 0;
  let cr = 0;
  for (const [n, l] of lines.entries()) {
    const ok = (v: number) => Number.isSafeInteger(v) && v >= 0;
    if (!ok(l.debitPaisa) || !ok(l.creditPaisa) || l.debitPaisa > 0 === l.creditPaisa > 0)
      throw new InvariantError('JOURNAL_LINE_INVALID', `Line ${n + 1}: exactly one of debit / credit, in whole paisa`);
    dr += l.debitPaisa;
    cr += l.creditPaisa;
  }
  if (dr !== cr) throw new InvariantError('JOURNAL_NOT_BALANCED', `Debits ${dr} and credits ${cr} differ`);
  return { totalPaisa: dr };
}

/** Collapses amounts per account (debit positive) into one line per account on its net side. */
export function netByAccount(entries: Array<{ accountCode: string; amountPaisa: number; memo: string }>): EntryLine[] {
  const net = new Map<string, { amount: number; memos: string[] }>();
  for (const e of entries) {
    const cur = net.get(e.accountCode) ?? { amount: 0, memos: [] };
    cur.amount += e.amountPaisa;
    if (!cur.memos.includes(e.memo)) cur.memos.push(e.memo);
    net.set(e.accountCode, cur);
  }
  return [...net.entries()]
    .filter(([, v]) => v.amount !== 0)
    .map(([accountCode, v]) => ({
      accountCode,
      debitPaisa: v.amount > 0 ? v.amount : 0,
      creditPaisa: v.amount < 0 ? -v.amount : 0,
      memo: v.memos.join(', '),
    }));
}

export interface PayrollAccountMap {
  earningDefault: string;
  earnings: Record<string, string>;
  deductionDefault: string;
  deductions: Record<string, string>;
  employerExpenseDefault: string;
  employerExpense: Record<string, string>;
  employerLiabilityDefault: string;
  employerLiability: Record<string, string>;
  payable: string;
  bank: string;
}

/** Defaults matching the seeded chart of accounts (core.setting acc.payroll_accounts overrides any key). */
export const DEFAULT_PAYROLL_ACCOUNTS: PayrollAccountMap = {
  earningDefault: '5100',
  earnings: { FEST_BONUS: '5120', OT: '5130', COVER_PAY: '5130' },
  deductionDefault: '2190',
  // unpaid leave reduces the salary expense; loans / advances reduce the staff receivable
  deductions: { PF: '2110', TAX: '2120', LOAN: '1210', ADVANCE: '1210', LWP: '5100' },
  employerExpenseDefault: '5110',
  employerExpense: { PF_EMPLOYER: '5110' },
  employerLiabilityDefault: '2190',
  employerLiability: { PF_EMPLOYER: '2110' },
  payable: '2100',
  bank: '1110',
};

/**
 * Salary journal of a locked payroll: Dr expense per earning, Cr liability / receivable per deduction,
 * Dr expense + Cr liability per employer contribution, Cr salaries payable for the net pay. Netted per account.
 */
export function payrollJournal(
  components: Array<{ code: string; kind: string; amountPaisa: number }>,
  map: PayrollAccountMap,
): EntryLine[] {
  const entries: Array<{ accountCode: string; amountPaisa: number; memo: string }> = [];
  let net = 0;
  for (const c of components) {
    if (c.kind === 'earning') {
      entries.push({
        accountCode: map.earnings[c.code] ?? map.earningDefault,
        amountPaisa: c.amountPaisa,
        memo: c.code,
      });
      net += c.amountPaisa;
    } else if (c.kind === 'deduction') {
      entries.push({
        accountCode: map.deductions[c.code] ?? map.deductionDefault,
        amountPaisa: -c.amountPaisa,
        memo: c.code,
      });
      net -= c.amountPaisa;
    } else {
      entries.push(
        {
          accountCode: map.employerExpense[c.code] ?? map.employerExpenseDefault,
          amountPaisa: c.amountPaisa,
          memo: c.code,
        },
        {
          accountCode: map.employerLiability[c.code] ?? map.employerLiabilityDefault,
          amountPaisa: -c.amountPaisa,
          memo: c.code,
        },
      );
    }
  }
  entries.push({ accountCode: map.payable, amountPaisa: -net, memo: 'Net pay' });
  return netByAccount(entries);
}

/** Natural balance sign: assets / expenses are debit accounts, the rest credit accounts. */
export const naturalBalance = (kind: AccountKind, debit: number, credit: number): number =>
  kind === 'asset' || kind === 'expense' ? debit - credit : credit - debit;
