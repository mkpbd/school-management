import { client, idempotencyKey, unwrap } from "../client";
import { resource } from "../resource";
import type { Body, IdempotencyOptions, Query } from "../types";

// Response shapes (backend/src/modules/acc/application/AccountingUseCases.ts, BudgetUseCases.ts, ports.ts,
// procurementPorts.ts). Type aliases, so they are assignable to Row. Amounts are integer paisa.

export type AccountKind =
  "asset" | "liability" | "equity" | "income" | "expense";
export type VoucherType = "receipt" | "payment" | "journal" | "contra";
export type PeriodStatus = "open" | "soft_locked" | "locked";
export type BudgetStatus =
  "draft" | "submitted" | "approved" | "rejected" | "superseded" | "closed";

export type AccountRow = {
  id: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  kind: AccountKind;
  parentId: string | null;
  isPostable: boolean;
  isBank: boolean;
  isCash: boolean;
  isActive: boolean;
  rowVersion: number;
};

export type JournalLine = {
  accountId: string;
  accountCode: string;
  accountName: string;
  debitPaisa: number;
  creditPaisa: number;
  memo: string | null;
  partyType: string | null;
  partyId: string | null;
};

export type JournalRow = {
  id: string;
  campusId: string;
  journalNo: string;
  voucherType: VoucherType;
  journalDate: string;
  narration: string;
  sourceModule: string | null;
  sourceType: string | null;
  sourceId: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
  totalPaisa: number;
  lines?: JournalLine[];
};

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  nameEn: string;
  kind: AccountKind;
  debitPaisa: number;
  creditPaisa: number;
  balancePaisa: number;
  side: "debit" | "credit";
};

export type TrialBalance = {
  asOf: string;
  rows: TrialBalanceRow[];
  totals: { debitPaisa: number; creditPaisa: number; balanced: boolean };
};

export type LedgerLine = {
  journalId: string;
  journalNo: string;
  journalDate: string;
  narration: string;
  debitPaisa: number;
  creditPaisa: number;
  memo: string | null;
  balancePaisa: number;
};

export type Ledger = {
  account: { id: string; code: string; nameEn: string; kind: AccountKind };
  from: string;
  to: string;
  openingPaisa: number;
  lines: LedgerLine[];
  closingPaisa: number;
};

export type PeriodRow = {
  id: string;
  code: string;
  startsOn: string;
  endsOn: string;
  status: PeriodStatus;
};

export type CostCentreRow = {
  id: string;
  code: string;
  nameEn: string;
  campusId: string | null;
  departmentId: string | null;
  isActive: boolean;
};

export type BudgetRow = {
  id: string;
  campusId: string;
  academicYearId: string;
  name: string;
  status: BudgetStatus;
  revisionOfId: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

export type BudgetLineView = {
  accountId: string;
  accountCode: string;
  accountName: string;
  costCentreId: string | null;
  costCentreCode: string | null;
  /** calendar months, January = index 0 */
  months: number[];
  annualPaisa: number;
};

export type BudgetDetail = BudgetRow & {
  lines: BudgetLineView[];
  totalPaisa: number;
};

export type VarianceRow = {
  accountCode: string;
  accountName: string;
  kind: "income" | "expense";
  costCentreCode: string | null;
  annualBudgetPaisa: number;
  budgetToDatePaisa: number;
  actualPaisa: number;
  committedPaisa: number;
  availablePaisa: number;
  /** favourable when positive: under budget for expenses, above budget for income */
  variancePaisa: number;
  usedPct: number | null;
  overBudget: boolean;
};

export type BudgetVsActual = {
  budget: BudgetRow;
  asOf: string;
  rows: VarianceRow[];
  unbudgeted: VarianceRow[];
};

/**
 * Accounting (backend/src/modules/acc/presentation/AccController.ts): chart of accounts, journals (manual and
 * auto-posted), trial balance, ledger and fiscal periods; budgets and cost centres (ProcurementController).
 */
export const accounting = {
  /** Chart of accounts (filter kind / isActive / isPostable; search code or name). The code and kind never change. */
  accounts: resource("/api/v1/acc/accounts", "/api/v1/acc/accounts/{id}"),
  journals: {
    /** Posted journals, newest first (offset paging with limit up to 500). */
    list: <T = JournalRow[]>(query?: Query<"/api/v1/acc/journals", "get">) =>
      unwrap<T>(client.GET("/api/v1/acc/journals", { params: { query } })),
    /** Journal with its lines. */
    get: <T = JournalRow>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/acc/journals/{id}", { params: { path: { id } } }),
      ),
    /** Manual voucher: balanced lines by account code; the fiscal period of the date must not be locked. */
    create: <T = JournalRow>(
      body: Body<"/api/v1/acc/journals", "post">,
      opts?: IdempotencyOptions,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/acc/journals", {
          body,
          headers: idempotencyKey(opts?.idempotencyKey),
        }),
      ),
    /** Posts the mirror journal (dated today unless given); posted journals are never edited. */
    reverse: <T = JournalRow>(
      id: string,
      body: Body<"/api/v1/acc/journals/{id}/reverse", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/acc/journals/{id}/reverse", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  /** Closing balance per account as of a date (optionally one campus); debit total equals credit total. */
  trialBalance: <T = TrialBalance>(
    query: Query<"/api/v1/acc/trial-balance", "get">,
  ) =>
    unwrap<T>(client.GET("/api/v1/acc/trial-balance", { params: { query } })),
  /** Account ledger with opening, running (natural direction) and closing balance. */
  ledger: <T = Ledger>(
    accountId: string,
    query: Query<"/api/v1/acc/ledger/{id}", "get">,
  ) =>
    unwrap<T>(
      client.GET("/api/v1/acc/ledger/{id}", {
        params: { path: { id: accountId }, query },
      }),
    ),
  periods: {
    /** Monthly fiscal periods (created on the first posting of the month). */
    list: <T = PeriodRow[]>() => unwrap<T>(client.GET("/api/v1/acc/periods")),
    /** Open, soft-lock or lock a period (locked: no postings). Code is YYYY-MM. */
    setStatus: <T = { code: string; status: PeriodStatus }>(
      code: string,
      body: Body<"/api/v1/acc/periods/{code}/status", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/acc/periods/{code}/status", {
          params: { path: { code } },
          body,
        }),
      ),
  },
  costCentres: {
    list: <T = CostCentreRow[]>() =>
      unwrap<T>(client.GET("/api/v1/acc/cost-centres")),
    /** Optionally for one campus or HR department; the code is stored upper-case. */
    create: <T = CostCentreRow>(
      body: Body<"/api/v1/acc/cost-centres", "post">,
    ) => unwrap<T>(client.POST("/api/v1/acc/cost-centres", { body })),
  },
  budgets: {
    /** Budgets of the active campus. */
    list: <T = BudgetRow[]>(query?: Query<"/api/v1/acc/budgets", "get">) =>
      unwrap<T>(client.GET("/api/v1/acc/budgets", { params: { query } })),
    /** Annual budget (lines: annualPaisa spread evenly, or 12 months) or a revision of the approved one. */
    create: <T = BudgetRow>(body: Body<"/api/v1/acc/budgets", "post">) =>
      unwrap<T>(client.POST("/api/v1/acc/budgets", { body })),
    /** Budget with lines per account x cost centre (12 months) and total. */
    get: <T = BudgetDetail>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/acc/budgets/{id}", { params: { path: { id } } }),
      ),
    /** Replace the lines of a draft or rejected budget (a rejected one goes back to draft). */
    setLines: <T = { lines: number }>(
      id: string,
      body: Body<"/api/v1/acc/budgets/{id}/lines", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/acc/budgets/{id}/lines", {
          params: { path: { id } },
          body,
        }),
      ),
    submit: <T = BudgetRow>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/acc/budgets/{id}/submit", {
          params: { path: { id } },
        }),
      ),
    /** Approve (a revision supersedes the approved budget) or reject; not by the submitter. */
    decide: <T = BudgetRow>(
      id: string,
      body: Body<"/api/v1/acc/budgets/{id}/decide", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/acc/budgets/{id}/decide", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Year-to-date budget vs posted actuals, open commitments, available and variance (asOf default today). */
    vsActual: <T = BudgetVsActual>(
      id: string,
      query?: Query<"/api/v1/acc/budgets/{id}/vs-actual", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/acc/budgets/{id}/vs-actual", {
          params: { path: { id }, query },
        }),
      ),
  },
};
