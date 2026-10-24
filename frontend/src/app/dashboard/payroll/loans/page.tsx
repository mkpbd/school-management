"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { StaffPayLink, type LoanView } from "@/components/payroll/setup";
import { api } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function LoansPage() {
  const [status, setStatus] = useState<
    "" | "active" | "closed" | "written_off"
  >("active");
  const [staffId, setStaffId] = useState("");
  const query = {
    ...(status ? { status } : {}),
    ...(staffId ? { staffId } : {}),
  };
  const loans = useQuery({
    queryKey: ["hrm.loans", query],
    queryFn: () => api.hrm.loans<LoanView[]>(query),
  });
  const rows = loans.data?.data ?? [];
  const outstanding = rows.reduce(
    (s, l) => s + (l.status === "active" ? l.outstandingPaisa : 0),
    0,
  );

  return (
    <>
      <PageHeader
        title="Loans & advances"
        description="Recovered in monthly installments by payroll when a run is locked. Grant new ones from the staff pay profile."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              aria-label="Status"
              className="select select-sm h-8 sm:w-44"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
              <option value="written_off">Written off</option>
            </select>
            <div className="sm:w-64">
              <RefSelect
                source={refs.staff}
                value={staffId}
                placeholder="All staff"
                onChange={setStaffId}
              />
            </div>
            <div className="flex-1" />
            {rows.length > 0 && (
              <span className="text-sm text-muted-foreground">
                Outstanding (active):{" "}
                <span className="font-medium text-foreground">
                  {formatMoney(outstanding)}
                </span>
              </span>
            )}
          </div>
          <DataTable<LoanView>
            rows={rows}
            isPending={loans.isPending}
            error={loans.error}
            empty="No loans or advances."
            columns={[
              {
                key: "staffId",
                label: "Staff",
                render: (l) => <StaffPayLink staffId={l.staffId} />,
              },
              { key: "kind", label: "Kind", type: "enum" },
              { key: "principalPaisa", label: "Principal", type: "money" },
              { key: "installmentPaisa", label: "Installment", type: "money" },
              { key: "outstandingPaisa", label: "Outstanding", type: "money" },
              {
                key: "startsMonth",
                label: "From",
                render: (l) => formatDate(l.startsMonth).slice(3),
              },
              { key: "status", label: "Status", type: "status" },
              { key: "reason", label: "Reason" },
            ]}
          />
        </CardContent>
      </Card>
    </>
  );
}
