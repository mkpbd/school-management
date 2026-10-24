"use client";

import type { ReactNode } from "react";
import { api, type Row } from "@/lib/api";
import type {
  AccountKind,
  BudgetStatus,
  PeriodStatus,
  VoucherType,
} from "@/lib/api/services/acc-accounting";
import { formatMoney, humanize, todayISO } from "@/lib/format";
import type { RefSource } from "@/lib/refs";

export const ACCOUNT_KINDS: AccountKind[] = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
];
export const VOUCHER_TYPES: VoucherType[] = [
  "receipt",
  "payment",
  "journal",
  "contra",
];
export const BUDGET_STATUSES: BudgetStatus[] = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "superseded",
  "closed",
];
export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Backend account code rule: 3 to 8 digits. */
export const ACCOUNT_CODE_RE = /^\d{3,8}$/;

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export const accountLabel = (r: Row) => `${s(r.code)} ${s(r.nameEn)}`;

const loadAccounts = async () =>
  (await api.acc.accounts.list({ pageSize: 500 })).data;

/** Every account (parent / group selects, ledger). */
export const accountsRef: RefSource = {
  key: "acc.accounts",
  load: loadAccounts,
  label: accountLabel,
};

/** Group (non-postable) accounts: parents in the chart. */
export const groupAccountsRef: RefSource = {
  key: "acc.groupAccounts",
  load: async () =>
    (await loadAccounts()).filter((r) => r.isPostable === false),
  label: accountLabel,
};

/** Active postable accounts keyed by code (journal lines take account codes). */
export const accountCodesRef: RefSource = {
  key: "acc.accountCodes",
  load: async () =>
    (await loadAccounts())
      .filter((r) => r.isPostable && r.isActive)
      .map((r) => ({ ...r, id: String(r.code) })),
  label: accountLabel,
};

/** Active postable income / expense accounts (budget lines). */
export const budgetAccountsRef: RefSource = {
  key: "acc.budgetAccounts",
  load: async () =>
    (await loadAccounts()).filter(
      (r) =>
        r.isPostable &&
        r.isActive &&
        (r.kind === "income" || r.kind === "expense"),
    ),
  label: (r) => `${accountLabel(r)} · ${humanize(r.kind)}`,
};

export const costCentresRef: RefSource = {
  key: "acc.costCentres",
  load: async () => (await api.acc.costCentres.list()).data,
  label: (r) => `${s(r.code)} ${s(r.nameEn)}`,
};

export const activeCostCentresRef: RefSource = {
  key: "acc.activeCostCentres",
  load: async () =>
    (await api.acc.costCentres.list()).data.filter((r) => r.isActive),
  label: (r) => `${s(r.code)} ${s(r.nameEn)}`,
};

/** Money cell: Taka with 2 decimals, a dash for zero when `blankZero`. */
export function Money({
  paisa,
  blankZero,
  className = "",
}: {
  paisa: unknown;
  blankZero?: boolean;
  className?: string;
}) {
  if (blankZero && !Number(paisa))
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className={`tabular-nums ${className}`}>{formatMoney(paisa)}</span>
  );
}

const PERIOD_TONE: Record<PeriodStatus, string> = {
  open: "badge-success",
  soft_locked: "badge-warning",
  locked: "badge-error",
};

export function PeriodStatusBadge({ status }: { status: PeriodStatus }) {
  return (
    <span
      className={`badge badge-soft badge-sm ${PERIOD_TONE[status]} whitespace-nowrap`}
    >
      {humanize(status)}
    </span>
  );
}

const BUDGET_TONE: Record<BudgetStatus, string> = {
  draft: "badge-ghost",
  submitted: "badge-warning",
  approved: "badge-success",
  rejected: "badge-error",
  superseded: "badge-neutral",
  closed: "badge-info",
};

export function BudgetStatusBadge({ status }: { status: BudgetStatus }) {
  return (
    <span
      className={`badge badge-soft badge-sm ${BUDGET_TONE[status]} whitespace-nowrap`}
    >
      {humanize(status)}
    </span>
  );
}

/** daisyUI stat tile. */
export function Stat({
  title,
  value,
  tone,
  desc,
}: {
  title: string;
  value: ReactNode;
  tone?: string;
  desc?: ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-title">{title}</div>
      <div className={`stat-value text-xl tabular-nums ${tone ?? ""}`}>
        {value}
      </div>
      {desc && <div className="stat-desc">{desc}</div>}
    </div>
  );
}

/** First day of the current month (Asia/Dhaka). */
export function monthStartISO(): string {
  return `${todayISO().slice(0, 7)}-01`;
}

/** "2026-03" -> "Mar 2026" */
export function periodLabel(code: string): string {
  const [y, m] = code.split("-").map(Number);
  return m ? `${MONTHS[m - 1]} ${y}` : code;
}

/** "12.50" taka (or "") -> paisa; NaN for invalid input. */
export function takaToPaisa(v: string): number {
  if (v.trim() === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}

/** Paisa -> input value in taka ("" for zero). */
export function paisaToTaka(p: number): string {
  return p ? String(p / 100) : "";
}
