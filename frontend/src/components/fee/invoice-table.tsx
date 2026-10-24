"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { DataTable, type Column } from "@/components/crud/data-table";
import type { Invoice } from "@/lib/api/services/fee";

export const INVOICE_STATUSES = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "void",
] as const;

export const invoiceColumns: Column<Invoice>[] = [
  {
    key: "invoiceNo",
    label: "Invoice",
    render: (r) => (
      <Link
        href={`/dashboard/fees/invoices/${r.id}`}
        className="font-mono text-xs underline-offset-4 hover:underline"
      >
        {r.invoiceNo}
      </Link>
    ),
  },
  { key: "billingPeriod", label: "Period" },
  { key: "dueDate", label: "Due", type: "date" },
  { key: "netPaisa", label: "Net", type: "money", className: "text-right" },
  { key: "paidPaisa", label: "Paid", type: "money", className: "text-right" },
  {
    key: "outstandingPaisa",
    label: "Outstanding",
    type: "money",
    className: "text-right",
  },
  { key: "status", label: "Status", type: "status" },
];

export function InvoiceTable({
  rows,
  isPending,
  error,
  actions,
  columns = invoiceColumns,
}: {
  rows: Invoice[] | undefined;
  isPending?: boolean;
  error?: unknown;
  actions?: (row: Invoice) => ReactNode;
  columns?: Column<Invoice>[];
}) {
  return (
    <DataTable<Invoice>
      columns={columns}
      rows={rows}
      isPending={isPending}
      error={error}
      actions={actions}
      empty="No invoices."
    />
  );
}
