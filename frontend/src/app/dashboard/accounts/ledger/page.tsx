"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  accountsRef,
  Money,
  monthStartISO,
  Stat,
} from "@/components/acc/accounting";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { Empty, Loading, PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { LedgerLine } from "@/lib/api/services/acc-accounting";
import { formatDate, formatMoney, humanize, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function AccountLedgerPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LedgerView />
    </Suspense>
  );
}

function LedgerView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const accountId = params.get("accountId") ?? "";
  const [from, setFrom] = useState(() => params.get("from") ?? monthStartISO());
  const [to, setTo] = useState(() => params.get("to") ?? todayISO());
  const [campusId, setCampusId] = useState("");

  const valid =
    Boolean(accountId) && DATE_RE.test(from) && DATE_RE.test(to) && from <= to;
  const query = { from, to, ...(campusId ? { campusId } : {}) };
  const ledger = useQuery({
    queryKey: ["acc.ledger", accountId, query],
    enabled: valid,
    queryFn: () => api.acc.ledger(accountId, query),
  });
  const data = ledger.data?.data;
  const debit = data?.lines.reduce((s, l) => s + l.debitPaisa, 0) ?? 0;
  const credit = data?.lines.reduce((s, l) => s + l.creditPaisa, 0) ?? 0;

  return (
    <>
      <PageHeader
        title={
          data
            ? `Ledger — ${data.account.code} ${data.account.nameEn}`
            : "Account ledger"
        }
        description="Every posting to one account in a date range with the running balance (in the account's natural direction: debit for assets and expenses, credit for liabilities, equity and income)."
      />
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="sm:w-72">
            <RefSelect
              source={accountsRef}
              value={accountId}
              placeholder="Choose an account"
              onChange={(id) =>
                router.replace(id ? `${pathname}?accountId=${id}` : pathname)
              }
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            From
            <Input
              type="date"
              className="w-40"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            To
            <Input
              type="date"
              className="w-40"
              value={to}
              onChange={(e) => setTo(e.target.value)}
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

      {!accountId ? (
        <Empty>Choose an account to see its ledger.</Empty>
      ) : !valid ? (
        <Empty>Choose a valid date range.</Empty>
      ) : (
        <>
          {data && (
            <div className="stats stats-vertical mb-4 w-full border bg-card shadow-sm sm:stats-horizontal">
              <Stat
                title="Opening balance"
                value={formatMoney(data.openingPaisa)}
                desc={formatDate(data.from)}
              />
              <Stat title="Debits" value={formatMoney(debit)} />
              <Stat title="Credits" value={formatMoney(credit)} />
              <Stat
                title="Closing balance"
                value={formatMoney(data.closingPaisa)}
                tone="text-primary"
                desc={`${humanize(data.account.kind)} · ${formatDate(data.to)}`}
              />
            </div>
          )}
          <Card>
            <CardContent>
              <DataTable<LedgerLine>
                rows={data?.lines}
                isPending={ledger.isPending}
                error={ledger.error}
                rowKey={(l, i) => `${l.journalId}-${i}`}
                empty="No postings in this period."
                columns={[
                  {
                    key: "journalDate",
                    label: "Date",
                    render: (l) => formatDate(l.journalDate),
                  },
                  {
                    key: "journalNo",
                    label: "Journal",
                    render: (l) => (
                      <Link
                        className="link font-mono text-xs"
                        href={`/dashboard/accounts/journals/${l.journalId}`}
                      >
                        {l.journalNo}
                      </Link>
                    ),
                  },
                  {
                    key: "narration",
                    label: "Narration",
                    render: (l) => (
                      <div className="max-w-md">
                        <div className="truncate">{l.narration}</div>
                        {l.memo && (
                          <div className="truncate text-xs text-muted-foreground">
                            {l.memo}
                          </div>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: "debitPaisa",
                    label: "Debit",
                    className: "text-right",
                    render: (l) => <Money paisa={l.debitPaisa} blankZero />,
                  },
                  {
                    key: "creditPaisa",
                    label: "Credit",
                    className: "text-right",
                    render: (l) => <Money paisa={l.creditPaisa} blankZero />,
                  },
                  {
                    key: "balancePaisa",
                    label: "Balance",
                    className: "text-right",
                    render: (l) => (
                      <Money
                        paisa={l.balancePaisa}
                        className={
                          l.balancePaisa < 0 ? "text-error" : "font-medium"
                        }
                      />
                    ),
                  },
                ]}
              />
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
