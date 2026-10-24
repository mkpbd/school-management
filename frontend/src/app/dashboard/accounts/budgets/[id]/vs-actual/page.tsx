"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { BudgetStatusBadge, Money, Stat } from "@/components/acc/accounting";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import type { VarianceRow } from "@/lib/api/services/acc-accounting";
import { formatDate, formatMoney, humanize, todayISO } from "@/lib/format";

const sum = (rows: VarianceRow[], k: keyof VarianceRow) =>
  rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);

export default function BudgetVsActualPage() {
  const { id } = useParams<{ id: string }>();
  const [asOf, setAsOf] = useState(todayISO);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(asOf);
  const report = useQuery({
    queryKey: ["acc.budgetVsActual", id, asOf],
    enabled: valid,
    queryFn: () => api.acc.budgets.vsActual(id, { asOf }),
  });
  const data = report.data?.data;
  const expenses = data?.rows.filter((r) => r.kind === "expense") ?? [];
  const income = data?.rows.filter((r) => r.kind === "income") ?? [];
  const over = data?.rows.filter((r) => r.overBudget).length ?? 0;

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href={`/dashboard/accounts/budgets/${id}`} />}
      >
        <ArrowLeftIcon /> Budget
      </Button>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Budget vs actual{data && <> · {data.budget.name}</>}
            {data && <BudgetStatusBadge status={data.budget.status} />}
          </span>
        }
        description="Year-to-date budget (months started by the date) against posted actuals, with open purchase-order commitments and what is left of the annual budget. Variance is favourable when positive."
        actions={
          <label className="flex items-center gap-2 text-sm">
            As of
            <Input
              type="date"
              className="w-40"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
            />
          </label>
        }
      />

      {!valid ? (
        <Empty>Choose a date.</Empty>
      ) : report.isPending ? (
        <Loading />
      ) : report.isError ? (
        <ErrorAlert error={report.error} />
      ) : (
        data && (
          <>
            <div className="stats stats-vertical mb-4 w-full border bg-card shadow-sm lg:stats-horizontal">
              <Stat
                title="Expense budget (year)"
                value={formatMoney(sum(expenses, "annualBudgetPaisa"))}
              />
              <Stat
                title="Budget to date"
                value={formatMoney(sum(expenses, "budgetToDatePaisa"))}
                desc={formatDate(data.asOf)}
              />
              <Stat
                title="Actual"
                value={formatMoney(sum(expenses, "actualPaisa"))}
              />
              <Stat
                title="Committed"
                value={formatMoney(sum(expenses, "committedPaisa"))}
                desc="Open purchase orders"
              />
              <Stat
                title="Available"
                value={formatMoney(sum(expenses, "availablePaisa"))}
                tone={
                  sum(expenses, "availablePaisa") < 0
                    ? "text-error"
                    : "text-primary"
                }
              />
              <Stat
                title="Over budget"
                value={String(over)}
                tone={over ? "text-error" : undefined}
                desc="lines"
              />
            </div>

            <VarianceTable title="Expenses" rows={expenses} showAvailable />
            {income.length > 0 && (
              <VarianceTable title="Income" rows={income} />
            )}

            <Card>
              <CardHeader>
                <CardTitle>Unbudgeted</CardTitle>
                <CardDescription>
                  Income or expense posted to an account × cost centre with no
                  budget line.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.unbudgeted.length === 0 ? (
                  <Empty>Nothing posted outside the budget.</Empty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Cost centre</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead className="text-right">Actual</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.unbudgeted.map((r) => (
                        <TableRow
                          key={`${r.accountCode}|${r.costCentreCode ?? ""}`}
                          className={
                            r.kind === "expense" ? "bg-warning/10" : undefined
                          }
                        >
                          <TableCell>
                            <span className="font-mono text-xs">
                              {r.accountCode}
                            </span>{" "}
                            {r.accountName}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {r.costCentreCode ?? "—"}
                          </TableCell>
                          <TableCell>{humanize(r.kind)}</TableCell>
                          <TableCell className="text-right">
                            <Money paisa={r.actualPaisa} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )
      )}
    </>
  );
}

function VarianceTable({
  title,
  rows,
  showAvailable,
}: {
  title: string;
  rows: VarianceRow[];
  showAvailable?: boolean;
}) {
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <Empty>No {title.toLowerCase()} lines in this budget.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Cost centre</TableHead>
                  <TableHead className="text-right">Annual budget</TableHead>
                  <TableHead className="text-right">Budget to date</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  {showAvailable && (
                    <TableHead className="text-right">Committed</TableHead>
                  )}
                  {showAvailable && (
                    <TableHead className="text-right">Available</TableHead>
                  )}
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="w-36">Used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={`${r.accountCode}|${r.costCentreCode ?? ""}`}
                    className={r.overBudget ? "bg-error/10" : undefined}
                  >
                    <TableCell className="whitespace-nowrap">
                      <span className="font-mono text-xs">{r.accountCode}</span>{" "}
                      {r.accountName}
                      {r.overBudget && (
                        <span className="badge badge-soft badge-error badge-xs ml-2">
                          Over budget
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.costCentreCode ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money paisa={r.annualBudgetPaisa} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money paisa={r.budgetToDatePaisa} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money paisa={r.actualPaisa} />
                    </TableCell>
                    {showAvailable && (
                      <TableCell className="text-right">
                        <Money paisa={r.committedPaisa} blankZero />
                      </TableCell>
                    )}
                    {showAvailable && (
                      <TableCell className="text-right">
                        <Money
                          paisa={r.availablePaisa}
                          className={
                            r.availablePaisa < 0 ? "font-medium text-error" : ""
                          }
                        />
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <Money
                        paisa={r.variancePaisa}
                        className={
                          r.variancePaisa < 0
                            ? "text-error"
                            : r.variancePaisa > 0
                              ? "text-success"
                              : ""
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <UsedBar pct={r.usedPct} over={r.overBudget} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right">
                    <Money paisa={sum(rows, "annualBudgetPaisa")} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money paisa={sum(rows, "budgetToDatePaisa")} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money paisa={sum(rows, "actualPaisa")} />
                  </TableCell>
                  {showAvailable && (
                    <TableCell className="text-right">
                      <Money paisa={sum(rows, "committedPaisa")} />
                    </TableCell>
                  )}
                  {showAvailable && (
                    <TableCell className="text-right">
                      <Money paisa={sum(rows, "availablePaisa")} />
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <Money paisa={sum(rows, "variancePaisa")} />
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Actual + committed as a share of the annual budget. */
function UsedBar({ pct, over }: { pct: number | null; over: boolean }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  const tone = over
    ? "progress-error"
    : pct >= 90
      ? "progress-warning"
      : "progress-success";
  return (
    <div className="flex items-center gap-2">
      <progress
        className={`progress ${tone} w-20`}
        value={Math.min(pct, 100)}
        max={100}
      />
      <span className="text-xs tabular-nums">
        {pct.toFixed(pct >= 100 ? 0 : 1)}%
      </span>
    </div>
  );
}
