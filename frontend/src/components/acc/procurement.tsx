"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { client, isApiError, type Row } from "@/lib/api";
import { unwrap } from "@/lib/api/client";
import type {
  BillStatus,
  BudgetOverrun,
  PaymentMethod,
  PoStatus,
  RequisitionStatus,
} from "@/lib/api/services/acc-procurement";
import { formatMoney, humanize } from "@/lib/format";
import type { RefSource } from "@/lib/refs";

export { formatQty } from "@/components/inv/shared";

export const REQUISITION_STATUSES: RequisitionStatus[] = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "ordered",
  "closed",
  "cancelled",
];
export const PO_STATUSES: PoStatus[] = [
  "issued",
  "partially_received",
  "received",
  "billed",
  "closed",
  "cancelled",
];
export const BILL_STATUSES: BillStatus[] = [
  "open",
  "partially_paid",
  "paid",
  "cancelled",
];
export const PAYMENT_METHODS: PaymentMethod[] = ["bank", "cash", "mobile"];

const TONE: Record<string, string> = {
  draft: "badge-ghost",
  submitted: "badge-info",
  approved: "badge-success",
  rejected: "badge-error",
  ordered: "badge-primary",
  closed: "badge-neutral",
  cancelled: "badge-error",
  issued: "badge-info",
  partially_received: "badge-warning",
  received: "badge-primary",
  billed: "badge-success",
  open: "badge-warning",
  partially_paid: "badge-warning",
  paid: "badge-success",
};

/** Requisition / purchase order / bill status pill. */
export function ProcStatus({ status }: { status: string }) {
  return (
    <span
      className={`badge badge-soft badge-sm whitespace-nowrap ${TONE[status] ?? "badge-ghost"}`}
    >
      {humanize(status)}
    </span>
  );
}

// ---- select sources (read-only, cached under ["ref", key]) ----

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Suppliers (inactive ones marked) — ["ref", "acc.vendors"]. */
export const vendorsRef: RefSource = {
  key: "acc.vendors",
  load: async () =>
    (
      await unwrap<Row[]>(
        client.GET("/api/v1/acc/vendors", { params: { query: {} } }),
      )
    ).data,
  label: (r) =>
    `${s(r.name)} (${s(r.code)})${r.isActive === false ? " — inactive" : ""}`,
};

/** Cost centres (budget departments) — needs acc.budget.view. */
export const costCentresRef: RefSource = {
  key: "acc.costCentres",
  load: async () =>
    (await unwrap<Row[]>(client.GET("/api/v1/acc/cost-centres"))).data,
  label: (r) =>
    `${s(r.nameEn)} (${s(r.code)})${r.isActive === false ? " — inactive" : ""}`,
};

/** Active postable expense accounts — needs acc.journal.view. */
export const expenseAccountsRef: RefSource = {
  key: "acc.expenseAccounts",
  load: async () =>
    (
      await unwrap<Row[]>(
        client.GET("/api/v1/acc/accounts", {
          params: {
            query: {
              kind: "expense",
              isPostable: "true",
              isActive: "true",
              pageSize: 500,
            },
          },
        }),
      )
    ).data,
  label: (r) => `${s(r.code)} ${s(r.nameEn)}`,
};

// ---- budget overruns ----

/** Overruns from a 422 BUDGET_EXCEEDED problem (`details.overruns`), else null. */
export function overrunsOf(err: unknown): BudgetOverrun[] | null {
  if (!isApiError(err) || err.code !== "BUDGET_EXCEEDED") return null;
  return (err.problem?.details?.overruns as BudgetOverrun[] | undefined) ?? [];
}

/** Per budget line: requested vs what is left; a line with no budget at all is over by its full amount. */
export function OverrunTable({ overruns }: { overruns: BudgetOverrun[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Account</TableHead>
          <TableHead className="text-right">Requested</TableHead>
          <TableHead className="text-right">Available</TableHead>
          <TableHead className="text-right">Over by</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {overruns.map((o) => (
          <TableRow key={o.key}>
            <TableCell className="font-mono text-xs">
              {o.accountCode || o.key.split("|")[0]?.slice(0, 8)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatMoney(o.requestedPaisa)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatMoney(o.availablePaisa)}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums text-destructive">
              {formatMoney(o.overPaisa)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---- small layout helpers ----

export function BackLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Button
      nativeButton={false}
      variant="link"
      size="sm"
      className="mb-2 px-0"
      render={<Link href={href} />}
    >
      <ArrowLeftIcon /> {children}
    </Button>
  );
}

export function Stat({
  title,
  value,
  desc,
  strong,
}: {
  title: string;
  value: ReactNode;
  desc?: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-title">{title}</div>
      <div
        className={`stat-value text-xl tabular-nums ${strong ? "text-primary" : ""}`}
      >
        {value}
      </div>
      {desc && <div className="stat-desc">{desc}</div>}
    </div>
  );
}

export function Field({
  label,
  required,
  help,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label>
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

/** Rating 1-5 as stars. */
export function Rating({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>;
  const n = Math.round(value);
  return (
    <span className="whitespace-nowrap text-warning" title={`${value} / 5`}>
      {"★".repeat(n)}
      <span className="text-muted-foreground/40">
        {"★".repeat(Math.max(0, 5 - n))}
      </span>
    </span>
  );
}

/** Line value as the backend computes it: quantity x unit price rounded to whole paisa. */
export const lineAmount = (quantity: number, unitPaisa: number) =>
  Math.round(quantity * unitPaisa);

/** 3-decimal rounding for quantities. */
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** YYYY-MM-DD + days. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
