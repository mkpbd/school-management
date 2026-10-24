import type { AccountKind } from '../domain/journal.js';

export interface AccountRow {
  id: string;
  code: string;
  nameEn: string;
  kind: AccountKind;
  isPostable: boolean;
  isActive: boolean;
}

export interface PeriodRow {
  id: string;
  code: string;
  startsOn: string;
  endsOn: string;
  status: 'open' | 'soft_locked' | 'locked';
}

export interface JournalRow {
  id: string;
  campusId: string;
  journalNo: string;
  voucherType: 'receipt' | 'payment' | 'journal' | 'contra';
  journalDate: string;
  narration: string;
  sourceModule: string | null;
  sourceType: string | null;
  sourceId: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
  totalPaisa: number;
  lines?: Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    debitPaisa: number;
    creditPaisa: number;
    memo: string | null;
    partyType: string | null;
    partyId: string | null;
  }>;
}

export interface BalanceRow {
  accountId: string;
  code: string;
  nameEn: string;
  kind: AccountKind;
  debitPaisa: number;
  creditPaisa: number;
}

export interface AccRepository {
  accountsByCode(codes: string[]): Promise<Map<string, AccountRow>>;
  /** the open month containing the date (created on first use) */
  periodFor(orgId: string, date: string): Promise<PeriodRow>;
  periods(): Promise<PeriodRow[]>;
  setPeriodStatus(code: string, status: PeriodRow['status'], by: string, at: Date): Promise<boolean>;
  insertJournal(values: Record<string, unknown>): Promise<string>;
  insertLines(rows: Array<Record<string, unknown>>): Promise<void>;
  journal(id: string): Promise<JournalRow | null>;
  journalBySource(module: string, type: string, id: string): Promise<JournalRow | null>;
  journals(f: {
    campusId?: string;
    from?: string;
    to?: string;
    sourceModule?: string;
    limit: number;
    offset: number;
  }): Promise<JournalRow[]>;
  balances(f: { campusId?: string; from?: string; to: string }): Promise<BalanceRow[]>;
  ledger(
    accountId: string,
    f: { campusId?: string; from: string; to: string },
  ): Promise<{
    opening: { debitPaisa: number; creditPaisa: number };
    lines: Array<{
      journalId: string;
      journalNo: string;
      journalDate: string;
      narration: string;
      debitPaisa: number;
      creditPaisa: number;
      memo: string | null;
    }>;
  }>;
  account(id: string): Promise<AccountRow | null>;
}
