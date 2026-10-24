"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import {
  CpdProgress,
  currentYear,
  hours,
  YearSelect,
  type CpdSummaryRow,
  type CpdSummaryView,
} from "@/components/hrm/cpd";
import { PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

export default function CpdSummaryPage() {
  const router = useRouter();
  const [year, setYear] = useState(currentYear);
  const [campusId, setCampusId] = useState("");
  const [show, setShow] = useState<"" | "met" | "behind">("");
  const query = { year, ...(campusId ? { campusId } : {}) };
  const summary = useQuery({
    queryKey: ["hrm.cpdSummary", query],
    queryFn: async () =>
      (await api.hrm.cpd.summary<CpdSummaryView>(query)).data,
  });
  const all = summary.data?.rows ?? [];
  const target = summary.data?.targetHours ?? 0;
  const met = all.filter((r) => r.met).length;
  const rows = all.filter((r) => !show || (show === "met" ? r.met : !r.met));

  return (
    <>
      <PageHeader
        title="CPD summary"
        description="Verified CPD hours per staff member against the yearly target. Open a row for the records."
        actions={<YearSelect value={year} onChange={setYear} />}
      />
      <div className="space-y-4">
        {summary.data && (
          <div className="stats stats-vertical w-full border bg-card shadow-sm sm:stats-horizontal">
            <div className="stat">
              <div className="stat-title">Target per staff</div>
              <div className="stat-value text-xl">{hours(target)}</div>
            </div>
            <div className="stat">
              <div className="stat-title">Target met</div>
              <div className="stat-value text-xl text-success">
                {met} / {all.length}
              </div>
            </div>
            <div className="stat">
              <div className="stat-title">Behind target</div>
              <div
                className={`stat-value text-xl ${all.length - met > 0 ? "text-warning" : ""}`}
              >
                {all.length - met}
              </div>
            </div>
          </div>
        )}
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="sm:w-56">
                <RefSelect
                  source={refs.campuses}
                  value={campusId}
                  placeholder="All campuses"
                  onChange={setCampusId}
                />
              </div>
              <select
                aria-label="Show"
                className="select select-sm h-8 sm:w-44"
                value={show}
                onChange={(e) => setShow(e.target.value as typeof show)}
              >
                <option value="">All staff</option>
                <option value="met">Target met</option>
                <option value="behind">Behind target</option>
              </select>
            </div>
            <DataTable<CpdSummaryRow>
              rows={rows}
              isPending={summary.isPending}
              error={summary.error}
              rowKey={(r) => r.staffId}
              onRowClick={(r) =>
                router.push(`/dashboard/hr/cpd/staff/${r.staffId}?year=${year}`)
              }
              empty="No staff found."
              columns={[
                { key: "staffNo", label: "Staff no", type: "mono" },
                {
                  key: "name",
                  label: "Name",
                  render: (r) => <span className="font-medium">{r.name}</span>,
                },
                {
                  key: "verifiedHours",
                  label: "Verified",
                  render: (r) => (
                    <span className="tabular-nums">
                      {hours(r.verifiedHours)}
                    </span>
                  ),
                },
                {
                  key: "pendingHours",
                  label: "Pending",
                  render: (r) => (
                    <span className="tabular-nums">
                      {hours(r.pendingHours)}
                    </span>
                  ),
                },
                {
                  key: "progress",
                  label: "Progress",
                  render: (r) => (
                    <CpdProgress
                      verified={r.verifiedHours}
                      pending={r.pendingHours}
                      target={target}
                    />
                  ),
                },
                {
                  key: "met",
                  label: "Target",
                  render: (r) => (
                    <span
                      className={`badge badge-soft badge-sm ${r.met ? "badge-success" : "badge-warning"}`}
                    >
                      {r.met ? "Met" : "Behind"}
                    </span>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
