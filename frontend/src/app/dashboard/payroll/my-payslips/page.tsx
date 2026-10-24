"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/crud/data-table";
import { PageHeader } from "@/components/page";
import {
  FileButton,
  money,
  monthLabel,
  type MyPayslip,
} from "@/components/payroll/runs";
import { Card, CardContent } from "@/components/ui/card";
import { api, isApiError } from "@/lib/api";

export default function MyPayslipsPage() {
  const router = useRouter();
  const mine = useQuery({
    queryKey: ["hrm.myPayslips"],
    queryFn: () => api.hrm.payslips.mine<MyPayslip[]>(),
    retry: false,
  });
  const notStaff = isApiError(mine.error) && mine.error.code === "NOT_STAFF";

  return (
    <>
      <PageHeader
        title="My payslips"
        description="Your salary for every month whose payroll has been locked."
      />
      <Card>
        <CardContent>
          {notStaff ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                No staff record for this login
              </p>
              <p>
                Payslips are shown to staff members. Ask HR to link your login
                to your staff profile.
              </p>
            </div>
          ) : (
            <DataTable<MyPayslip>
              rows={mine.data?.data}
              isPending={mine.isPending}
              error={mine.error}
              onRowClick={(p) =>
                router.push(`/dashboard/payroll/payslips/${p.id}`)
              }
              empty="No payslips yet. They appear here once a month's payroll is locked."
              columns={[
                {
                  key: "periodMonth",
                  label: "Month",
                  render: (p) => (
                    <span className="font-medium">
                      {monthLabel(p.periodMonth)}
                    </span>
                  ),
                },
                {
                  key: "paidDays",
                  label: "Paid days",
                  render: (p) => `${p.paidDays} / ${p.workingDays}`,
                },
                { key: "grossPaisa", label: "Gross", type: "money" },
                { key: "deductionsPaisa", label: "Deductions", type: "money" },
                {
                  key: "netPaisa",
                  label: "Net pay",
                  render: (p) => (
                    <span className="font-medium tabular-nums">
                      {money(p.netPaisa)}
                    </span>
                  ),
                },
              ]}
              actions={(p) => (
                <FileButton
                  mode="open"
                  size="xs"
                  variant="ghost"
                  load={() => api.hrm.payslips.pdf(p.id)}
                >
                  PDF
                </FileButton>
              )}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
