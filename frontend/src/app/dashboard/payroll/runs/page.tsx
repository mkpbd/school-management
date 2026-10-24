"use client";

import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { PageHeader } from "@/components/page";
import {
  monthLabel,
  money,
  RunStatusBadge,
  type PayrollRun,
  type RunStatus,
} from "@/components/payroll/runs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type Row } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { refs, type RefSource } from "@/lib/refs";

/** Salary components keyed by code (includeComponents takes codes). */
const componentCodes: RefSource = {
  key: "payroll.componentCodes",
  load: async () =>
    (await api.hrm.salaryComponents.list({ pageSize: 500 })).data.map((r) => ({
      ...r,
      id: String(r.code),
    })),
  label: (r) => `${String(r.nameEn)} (${String(r.code)})`,
};

export default function PayrollRunsPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [campusId, setCampusId] = useState("");
  const [year, setYear] = useState("");
  const [creating, setCreating] = useState(false);

  const query = {
    ...(campusId ? { campusId } : {}),
    ...(/^\d{4}$/.test(year) ? { year: Number(year) } : {}),
  };
  const runs = useQuery({
    queryKey: ["hrm.payrollRuns", query],
    queryFn: () => api.hrm.payrollRuns.list<PayrollRun[]>(query),
  });

  const create = useAction(
    (body: Row) => api.hrm.payrollRuns.create<PayrollRun>(body as never),
    {
      invalidate: [["hrm.payrollRuns"]],
      toastError: false,
      onSuccess: (r) => router.push(`/dashboard/payroll/runs/${r.data.id}`),
    },
  );
  const canCreate = can(me, "hrm.payroll.create");

  return (
    <>
      <PageHeader
        title="Payroll runs"
        description="One run per campus and month: inputs → compute → submit → approve → lock → paid."
        actions={
          canCreate && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New payroll run
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="sm:w-56">
              <RefSelect
                source={refs.campuses}
                value={campusId}
                placeholder="All campuses"
                onChange={setCampusId}
              />
            </div>
            <Input
              type="number"
              min={2000}
              max={2100}
              placeholder="Year (e.g. 2026)"
              className="sm:w-40"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
          <DataTable<PayrollRun>
            rows={runs.data?.data}
            isPending={runs.isPending}
            error={runs.error}
            onRowClick={(r) => router.push(`/dashboard/payroll/runs/${r.id}`)}
            empty={
              <div className="space-y-1">
                <p>No payroll runs yet.</p>
                <p className="text-xs">
                  {canCreate
                    ? "Start one with “New payroll run”. Staff need a contract (Payroll → Staff pay) to get a payslip."
                    : "A user with the hrm.payroll.create permission starts the monthly payroll."}
                </p>
              </div>
            }
            columns={[
              {
                key: "periodMonth",
                label: "Month",
                render: (r) => (
                  <span className="font-medium">
                    {monthLabel(r.periodMonth)}
                  </span>
                ),
              },
              { key: "campusId", label: "Campus", ref: refs.campuses },
              {
                key: "status",
                label: "Status",
                render: (r) => (
                  <RunStatusBadge status={r.status as RunStatus} />
                ),
              },
              {
                key: "grossPaisa",
                label: "Gross",
                render: (r) => (
                  <span className="tabular-nums">{money(r.grossPaisa)}</span>
                ),
              },
              {
                key: "deductionsPaisa",
                label: "Deductions",
                render: (r) => (
                  <span className="tabular-nums">
                    {money(r.deductionsPaisa)}
                  </span>
                ),
              },
              {
                key: "netPaisa",
                label: "Net pay",
                render: (r) => (
                  <span className="font-medium tabular-nums">
                    {money(r.netPaisa)}
                  </span>
                ),
              },
              {
                key: "includedComponents",
                label: "Extras",
                render: (r) =>
                  r.includedComponents?.length
                    ? r.includedComponents.join(", ")
                    : "—",
              },
              {
                key: "computedAt",
                label: "Computed",
                render: (r) => formatDateTime(r.computedAt),
              },
            ]}
          />
        </CardContent>
      </Card>

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title="New payroll run"
        description="Creates a draft for the month. Every staff member of the campus with a contract that month is included."
        submitLabel="Create run"
        successMessage="Payroll run created"
        fields={[
          {
            name: "campusId",
            label: "Campus",
            type: "ref",
            ref: refs.campuses,
            help: "Default: active campus",
          },
          { name: "month", label: "Month", type: "month", required: true },
          {
            name: "includeComponents",
            label: "Extra components this month",
            type: "refs",
            ref: componentCodes,
            help: "Only occasional components (e.g. festival bonus FEST_BONUS, set in hrm.occasional_components).",
          },
        ]}
        onSubmit={(body) => create.mutateAsync(body)}
      />
    </>
  );
}
