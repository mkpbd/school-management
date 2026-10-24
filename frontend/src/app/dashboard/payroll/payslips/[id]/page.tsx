"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel } from "@/components/crud/fields";
import { DetailList, ErrorAlert, Loading, PageHeader } from "@/components/page";
import {
  FileButton,
  money,
  monthLabel,
  RunStatusBadge,
  type PayslipDetail,
  type PayslipLine,
} from "@/components/payroll/runs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can, useMe } from "@/hooks/use-me";
import { api, isApiError } from "@/lib/api";
import { refs } from "@/lib/refs";

const SECTIONS: Array<{ kind: string; title: string }> = [
  { kind: "earning", title: "Earnings" },
  { kind: "deduction", title: "Deductions" },
  {
    kind: "employer_contribution",
    title: "Employer contributions (not paid to the employee)",
  },
];

export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const slip = useQuery({
    queryKey: ["hrm.payslip", id],
    queryFn: () => api.hrm.payslips.get<PayslipDetail>(id),
    retry: false,
  });
  const isPayroll = can(me, "hrm.payroll.view");
  const back =
    isPayroll && slip.data
      ? `/dashboard/payroll/runs/${slip.data.data.payrollRunId}`
      : "/dashboard/payroll/my-payslips";

  if (slip.isPending) return <Loading />;
  if (slip.isError) {
    return isApiError(slip.error) && slip.error.status === 404 ? (
      <ErrorAlert
        error={
          new Error(
            "Payslip not found, or not available to you yet (staff see their payslip once the payroll is locked).",
          )
        }
      />
    ) : (
      <ErrorAlert error={slip.error} />
    );
  }

  const p = slip.data.data;
  const lines = p.lines ?? [];
  const known = new Set(SECTIONS.map((s) => s.kind));
  const other = lines.filter((l) => !known.has(l.kind));

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href={back} />}
      >
        <ArrowLeftIcon /> {isPayroll ? "Payroll run" : "My payslips"}
      </Button>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p.name} · {monthLabel(p.periodMonth)}{" "}
            <RunStatusBadge status={p.runStatus} />
          </span>
        }
        description={
          <>
            <span className="font-mono">{p.staffNo}</span> ·{" "}
            <RefLabel source={refs.campuses} id={p.campusId} />
          </>
        }
        actions={
          <FileButton mode="open" load={() => api.hrm.payslips.pdf(id)}>
            Open PDF
          </FileButton>
        }
      />
      {!["locked", "paid"].includes(p.runStatus) && (
        <div className="alert alert-info alert-soft mb-4 text-sm">
          Draft: the payroll is not locked yet, so amounts can still change (the
          PDF carries a DRAFT watermark).
        </div>
      )}
      {p.warnings?.length > 0 && (
        <div className="alert alert-warning alert-soft mb-4 block text-sm">
          <ul className="list-disc pl-5">
            {p.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="stats stats-vertical mb-4 w-full border bg-card shadow-sm sm:stats-horizontal">
        <div className="stat">
          <div className="stat-title">Gross</div>
          <div className="stat-value text-xl tabular-nums">
            {money(p.grossPaisa)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Deductions</div>
          <div className="stat-value text-xl tabular-nums">
            {money(p.deductionsPaisa)}
          </div>
          <div className="stat-desc">incl. income tax {money(p.taxPaisa)}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Net pay</div>
          <div className="stat-value text-xl text-primary tabular-nums">
            {money(p.netPaisa)}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {SECTIONS.map((s) => (
          <LinesCard
            key={s.kind}
            title={s.title}
            lines={lines.filter((l) => l.kind === s.kind)}
          />
        ))}
        {other.length > 0 && <LinesCard title="Other" lines={other} />}
        <Card>
          <CardHeader>
            <CardTitle>Attendance basis</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                ["Working days", p.workingDays],
                ["Paid days", p.paidDays],
                ["Unpaid leave days", p.lwpDays],
                ["Overtime (minutes)", p.overtimeMinutes],
                ["Cover periods", p.coverPeriods],
                ["Employer contribution", money(p.employerContributionPaisa)],
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function LinesCard({ title, lines }: { title: string; lines: PayslipLine[] }) {
  const total = lines.reduce((a, l) => a + l.amountPaisa, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          rows={lines.map((l, i) => ({ ...l, id: `${l.code}-${i}` }))}
          empty="None."
          columns={[
            {
              key: "name",
              label: "Component",
              render: (l) => (
                <div>
                  <div>{l.name}</div>
                  {l.note && (
                    <div className="text-xs text-muted-foreground">
                      {l.note}
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: "quantity",
              label: "Qty",
              render: (l) => (l.quantity === null ? "" : l.quantity),
            },
            {
              key: "amountPaisa",
              label: "Amount",
              type: "money",
              className: "text-right",
            },
          ]}
        />
        {lines.length > 0 && (
          <div className="mt-2 flex justify-between border-t pt-2 text-sm font-medium">
            <span>Total</span>
            <span className="tabular-nums">{money(total)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
