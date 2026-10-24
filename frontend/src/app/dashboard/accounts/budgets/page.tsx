"use client";

import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  BUDGET_STATUSES,
  BudgetStatusBadge,
} from "@/components/acc/accounting";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type {
  BudgetRow,
  BudgetStatus,
} from "@/lib/api/services/acc-accounting";
import { formatDateTime, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function BudgetsPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [academicYearId, setAcademicYearId] = useState("");
  const [status, setStatus] = useState<BudgetStatus | "">("");

  const query = {
    ...(academicYearId ? { academicYearId } : {}),
    ...(status ? { status } : {}),
  };
  const budgets = useQuery({
    queryKey: ["acc.budgets", query],
    queryFn: () => api.acc.budgets.list(query),
  });

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Annual budget of the active campus per academic year: draft → submitted → approved (or rejected). Change an approved budget with a revision; approving it supersedes the old one."
        actions={
          can(me, "acc.budget.create") && (
            <Button
              nativeButton={false}
              render={<Link href="/dashboard/accounts/budgets/new" />}
            >
              <PlusIcon /> New budget
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="sm:w-56">
              <RefSelect
                source={refs.academicYears}
                value={academicYearId}
                placeholder="All years"
                onChange={setAcademicYearId}
              />
            </div>
            <select
              aria-label="Status"
              className="select select-sm h-8 sm:w-44"
              value={status}
              onChange={(e) => setStatus(e.target.value as BudgetStatus | "")}
            >
              <option value="">All statuses</option>
              {BUDGET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </div>
          <DataTable<BudgetRow>
            rows={budgets.data?.data}
            isPending={budgets.isPending}
            error={budgets.error}
            onRowClick={(b) =>
              router.push(`/dashboard/accounts/budgets/${b.id}`)
            }
            empty="No budgets yet."
            columns={[
              {
                key: "name",
                label: "Name",
                render: (b) => (
                  <div>
                    <div className="font-medium">{b.name}</div>
                    {b.revisionOfId && (
                      <div className="text-xs text-muted-foreground">
                        Revision
                      </div>
                    )}
                  </div>
                ),
              },
              { key: "academicYearId", label: "Year", ref: refs.academicYears },
              { key: "campusId", label: "Campus", ref: refs.campuses },
              {
                key: "status",
                label: "Status",
                render: (b) => <BudgetStatusBadge status={b.status} />,
              },
              {
                key: "submittedAt",
                label: "Submitted",
                render: (b) => formatDateTime(b.submittedAt),
              },
              {
                key: "decidedAt",
                label: "Decided",
                render: (b) => formatDateTime(b.decidedAt),
              },
            ]}
          />
        </CardContent>
      </Card>
    </>
  );
}
