"use client";

import { useQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { DataTable } from "@/components/crud/data-table";
import { HostelSelect, useUrlState } from "@/components/hst/shared";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { ServiceRow } from "@/lib/api/services/hst";
import { currentPeriod, humanize } from "@/lib/format";

export default function MessReportPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ReportView />
    </Suspense>
  );
}

function ReportView() {
  const [{ hostelId, month }, setUrl] = useUrlState({
    hostelId: "",
    month: currentPeriod(),
  });
  const report = useQuery({
    queryKey: ["hst.messReport", hostelId, month],
    queryFn: async () => (await api.hst.mess.report(hostelId, { month })).data,
    enabled: Boolean(hostelId),
  });
  const r = report.data;
  const diff = r ? r.totals.served - r.totals.expected : 0;

  return (
    <>
      <PageHeader
        title="Mess month report"
        description="Meals skipped per resident (for meal-fee adjustments) and plates expected vs served per meal."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <HostelSelect
              value={hostelId}
              onChange={(id) => setUrl({ hostelId: id })}
            />
            <Input
              type="month"
              aria-label="Month"
              className="sm:w-44"
              value={month}
              onChange={(e) =>
                e.target.value && setUrl({ month: e.target.value })
              }
            />
          </div>
          {!hostelId ? (
            <Empty>Choose a hostel.</Empty>
          ) : report.isPending ? (
            <Loading />
          ) : report.isError ? (
            <ErrorAlert error={report.error} />
          ) : (
            r && (
              <>
                <div className="stats stats-vertical w-full border bg-card sm:stats-horizontal">
                  <div className="stat">
                    <div className="stat-title">Plates expected</div>
                    <div className="stat-value text-2xl tabular-nums">
                      {r.totals.expected}
                    </div>
                    <div className="stat-desc">
                      {r.services.length} meals recorded
                    </div>
                  </div>
                  <div className="stat">
                    <div className="stat-title">Plates served</div>
                    <div className="stat-value text-2xl tabular-nums">
                      {r.totals.served}
                    </div>
                    <div
                      className={`stat-desc ${diff > 0 ? "text-warning" : ""}`}
                    >
                      {diff === 0
                        ? "as expected"
                        : `${diff > 0 ? "+" : ""}${diff} vs expected`}
                    </div>
                  </div>
                  <div className="stat">
                    <div className="stat-title">Meals skipped</div>
                    <div className="stat-value text-2xl tabular-nums">
                      {r.skippedByStudent.reduce((s, x) => s + x.skipped, 0)}
                    </div>
                    <div className="stat-desc">
                      {r.skippedByStudent.length} residents
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>Skipped meals per resident</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <DataTable
                        rowKey={(x) => String(x.studentId)}
                        columns={[
                          { key: "studentName", label: "Resident" },
                          {
                            key: "skipped",
                            label: "Meals skipped",
                            className: "text-right tabular-nums",
                          },
                        ]}
                        rows={r.skippedByStudent}
                        empty="No meals skipped this month."
                      />
                    </CardContent>
                  </Card>
                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>Expected vs served</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <DataTable<ServiceRow>
                        rowKey={(x) => `${x.date}|${x.meal}`}
                        columns={[
                          { key: "date", label: "Date", type: "date" },
                          {
                            key: "meal",
                            label: "Meal",
                            render: (x) => humanize(x.meal),
                          },
                          {
                            key: "expected",
                            label: "Expected",
                            className: "text-right tabular-nums",
                          },
                          {
                            key: "served",
                            label: "Served",
                            className: "text-right tabular-nums",
                          },
                          {
                            key: "diff",
                            label: "Diff",
                            className: "text-right tabular-nums",
                            render: (x) => {
                              const d = x.served - x.expected;
                              return (
                                <span
                                  className={
                                    d > 0
                                      ? "text-warning"
                                      : d < 0
                                        ? "text-info"
                                        : ""
                                  }
                                >
                                  {d > 0 ? `+${d}` : d}
                                </span>
                              );
                            },
                          },
                          { key: "note", label: "Note" },
                        ]}
                        rows={r.services}
                        empty="No servings recorded this month."
                      />
                    </CardContent>
                  </Card>
                </div>
              </>
            )
          )}
        </CardContent>
      </Card>
    </>
  );
}
