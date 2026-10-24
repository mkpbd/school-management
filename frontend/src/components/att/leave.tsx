"use client";

import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/crud/data-table";
import type { FieldDef } from "@/components/crud/fields";
import { api } from "@/lib/api";
import { humanize, todayISO } from "@/lib/format";
import {
  explain,
  leaveTypesRef,
  type LeaveBalance,
  type LeaveType,
} from "./shared";

/** POST /att/staff-leaves (own); HR adds `staffId`. */
export const APPLY_LEAVE_FIELDS: FieldDef[] = [
  {
    name: "leaveTypeId",
    label: "Leave type",
    type: "ref",
    ref: leaveTypesRef,
    required: true,
    wide: true,
  },
  {
    name: "fromDate",
    label: "From",
    type: "date",
    required: true,
    defaultValue: todayISO(),
  },
  {
    name: "toDate",
    label: "To",
    type: "date",
    required: true,
    defaultValue: todayISO(),
  },
  { name: "halfDay", label: "Half day (single date)", type: "boolean" },
  { name: "reason", label: "Reason", type: "textarea" },
];

const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Leave balances of a year (own without `staffId`; others with att.staff_leave.view). */
export function LeaveBalances({
  staffId,
  year,
}: {
  staffId?: string;
  year: number;
}) {
  const valid = year >= 2000 && year <= 2100;
  const q = useQuery({
    queryKey: ["att", "leaveBalances", staffId ?? "me", year],
    queryFn: () =>
      api.att.staff.leaveBalances<LeaveBalance[]>({
        year,
        ...(staffId ? { staffId } : {}),
      }),
    enabled: valid,
    retry: false,
  });
  return (
    <DataTable<LeaveBalance>
      rows={q.data?.data}
      isPending={valid && q.isPending}
      error={q.error ? new Error(explain(q.error)) : null}
      rowKey={(b) => b.leaveTypeId}
      empty="No leave types apply."
      columns={[
        {
          key: "nameEn",
          label: "Type",
          render: (b) => (
            <>
              <span className="font-medium">{b.nameEn}</span>{" "}
              <span className="text-xs text-muted-foreground">({b.code})</span>
              {!b.isPaid && (
                <span className="badge badge-ghost badge-sm ml-2">Unpaid</span>
              )}
            </>
          ),
        },
        { key: "entitled", label: "Entitled", render: (b) => days(b.entitled) },
        { key: "carried", label: "Carried", render: (b) => days(b.carried) },
        { key: "taken", label: "Taken", render: (b) => days(b.taken) },
        { key: "pending", label: "Pending", render: (b) => days(b.pending) },
        {
          key: "available",
          label: "Available",
          render: (b) => (
            <span
              className={`font-semibold tabular-nums ${b.available <= 0 ? "text-error" : ""}`}
            >
              {days(b.available)}
            </span>
          ),
        },
      ]}
    />
  );
}

/** Leave types: quota, carry-forward, paid / unpaid, eligibility. */
export function LeaveTypesTable() {
  const q = useQuery({
    queryKey: ["ref", leaveTypesRef.key],
    queryFn: leaveTypesRef.load,
    staleTime: 60_000,
  });
  return (
    <DataTable<LeaveType>
      rows={q.data as LeaveType[] | undefined}
      isPending={q.isPending}
      error={q.error}
      empty="No leave types configured."
      columns={[
        {
          key: "nameEn",
          label: "Type",
          render: (t) => `${t.nameEn} (${t.code})`,
        },
        { key: "annualQuotaDays", label: "Days / year" },
        { key: "maxCarryForward", label: "Max carry-forward" },
        { key: "isPaid", label: "Paid", type: "bool" },
        { key: "countsHolidays", label: "Counts holidays", type: "bool" },
        {
          key: "genderRestriction",
          label: "Only for",
          render: (t) => humanize(t.genderRestriction),
        },
        {
          key: "requiresDocumentAfterDays",
          label: "Document after",
          render: (t) =>
            t.requiresDocumentAfterDays === null
              ? "—"
              : `${t.requiresDocumentAfterDays} day(s)`,
        },
      ]}
    />
  );
}
