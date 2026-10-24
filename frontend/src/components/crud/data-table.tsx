"use client";

import type { ReactNode } from "react";
import {
  BoolBadge,
  Empty,
  ErrorAlert,
  Loading,
  StatusBadge,
} from "@/components/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Row } from "@/lib/api";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatValue,
  humanize,
} from "@/lib/format";
import type { RefSource } from "@/lib/refs";
import { RefLabel } from "./fields";

export interface Column<R = Row> {
  key: string;
  label: string;
  /** Built-in renderers; `render` wins. */
  type?:
    | "money"
    | "date"
    | "datetime"
    | "status"
    | "bool"
    | "enum"
    | "mono"
    | "time";
  ref?: RefSource;
  render?: (row: R) => ReactNode;
  className?: string;
}

export function renderCell<R extends Row>(col: Column<R>, row: R): ReactNode {
  if (col.render) return col.render(row);
  const v = row[col.key];
  if (col.ref) return <RefLabel source={col.ref} id={v} />;
  switch (col.type) {
    case "money":
      return <span className="tabular-nums">{formatMoney(v)}</span>;
    case "date":
      return formatDate(v);
    case "datetime":
      return formatDateTime(v);
    case "status":
      return <StatusBadge status={v} />;
    case "bool":
      return <BoolBadge value={v} />;
    case "enum":
      return humanize(v);
    case "mono":
      return <span className="font-mono text-xs">{formatValue(v)}</span>;
    case "time":
      return typeof v === "string" ? v.slice(0, 5) : "—";
    default:
      return formatValue(v);
  }
}

export function DataTable<R extends Row>({
  columns,
  rows,
  isPending,
  error,
  actions,
  empty,
  onRowClick,
  rowKey = (r) => String(r.id),
}: {
  columns: Column<R>[];
  rows: R[] | undefined;
  isPending?: boolean;
  error?: unknown;
  actions?: (row: R) => ReactNode;
  empty?: ReactNode;
  onRowClick?: (row: R) => void;
  rowKey?: (row: R, index: number) => string;
}) {
  if (error) return <ErrorAlert error={error} />;
  if (isPending) return <Loading />;
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.key} className={c.className}>
              {c.label}
            </TableHead>
          ))}
          {actions && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow
            key={rowKey(row, i)}
            className={onRowClick ? "cursor-pointer" : undefined}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {columns.map((c) => (
              <TableCell key={c.key} className={c.className}>
                {renderCell(c, row)}
              </TableCell>
            ))}
            {actions && (
              <TableCell
                className="text-right"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-end gap-1">{actions(row)}</div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
