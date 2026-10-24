"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ACCOUNT_KINDS, Money, Stat } from "@/components/acc/accounting";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { TrialBalanceRow } from "@/lib/api/services/acc-accounting";
import { formatDate, formatMoney, humanize, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function TrialBalancePage() {
  const router = useRouter();
  const [asOf, setAsOf] = useState(todayISO);
  const [campusId, setCampusId] = useState("");

  const query = { asOf, ...(campusId ? { campusId } : {}) };
  const tb = useQuery({
    queryKey: ["acc.trialBalance", query],
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(asOf),
    queryFn: () => api.acc.trialBalance(query),
  });
  const data = tb.data?.data;
  const rows = [...(data?.rows ?? [])]
    .filter((r) => r.balancePaisa !== 0)
    .sort(
      (a, b) =>
        ACCOUNT_KINDS.indexOf(a.kind) - ACCOUNT_KINDS.indexOf(b.kind) ||
        a.code.localeCompare(b.code),
    );

  return (
    <>
      <PageHeader
        title="Trial balance"
        description="Closing balance of every account up to the date, on its debit or credit side. Debit and credit totals must agree."
      />
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex items-center gap-2 text-sm">
            As of
            <Input
              type="date"
              className="w-40"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
            />
          </label>
          <div className="sm:w-56">
            <RefSelect
              source={refs.campuses}
              value={campusId}
              placeholder="All campuses"
              onChange={setCampusId}
            />
          </div>
        </CardContent>
      </Card>

      {data && (
        <div className="stats stats-vertical mb-4 w-full border bg-card shadow-sm sm:stats-horizontal">
          <Stat
            title="Total debit"
            value={formatMoney(data.totals.debitPaisa)}
          />
          <Stat
            title="Total credit"
            value={formatMoney(data.totals.creditPaisa)}
          />
          <Stat
            title="Status"
            value={data.totals.balanced ? "Balanced" : "Out of balance"}
            tone={data.totals.balanced ? "text-success" : "text-error"}
            desc={
              data.totals.balanced
                ? `As of ${formatDate(data.asOf)}`
                : `Difference ${formatMoney(Math.abs(data.totals.debitPaisa - data.totals.creditPaisa))}`
            }
          />
        </div>
      )}

      <Card>
        <CardContent className="space-y-3">
          <DataTable<TrialBalanceRow>
            rows={rows}
            isPending={tb.isPending}
            error={tb.error}
            rowKey={(r) => r.accountId}
            onRowClick={(r) =>
              router.push(
                `/dashboard/accounts/ledger?accountId=${r.accountId}&to=${asOf}`,
              )
            }
            empty="No postings up to this date."
            columns={[
              {
                key: "code",
                label: "Code",
                render: (r) => (
                  <span className="font-mono text-xs">{r.code}</span>
                ),
              },
              { key: "nameEn", label: "Account" },
              { key: "kind", label: "Kind", render: (r) => humanize(r.kind) },
              {
                key: "debit",
                label: "Debit",
                className: "text-right",
                render: (r) => (
                  <Money
                    paisa={r.side === "debit" ? r.balancePaisa : 0}
                    blankZero
                  />
                ),
              },
              {
                key: "credit",
                label: "Credit",
                className: "text-right",
                render: (r) => (
                  <Money
                    paisa={r.side === "credit" ? r.balancePaisa : 0}
                    blankZero
                  />
                ),
              },
            ]}
          />
          {data && rows.length > 0 && (
            <div className="flex justify-end gap-6 border-t pt-3 text-sm font-medium">
              <span>
                Debit{" "}
                <span className="tabular-nums">
                  {formatMoney(data.totals.debitPaisa)}
                </span>
              </span>
              <span>
                Credit{" "}
                <span className="tabular-nums">
                  {formatMoney(data.totals.creditPaisa)}
                </span>
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
