"use client";

import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  costCentresRef,
  ProcStatus,
  REQUISITION_STATUSES,
} from "@/components/acc/procurement";
import { RequisitionCreateDialog } from "@/components/acc/procurement-requisition";
import { DataTable } from "@/components/crud/data-table";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type {
  RequisitionRow,
  RequisitionStatus,
} from "@/lib/api/services/acc-procurement";
import { humanize } from "@/lib/format";

export default function RequisitionsPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const manage = can(me, "acc.procurement.view");
  const [scope, setScope] = useState<"mine" | "campus">("mine");
  const [status, setStatus] = useState<RequisitionStatus | "">("");
  const [creating, setCreating] = useState(false);

  const mine = !manage || scope === "mine";
  const query = {
    ...(mine ? { mine: "true" as const } : {}),
    ...(status ? { status } : {}),
  };
  const list = useQuery({
    queryKey: ["acc.requisitions", query],
    queryFn: () => api.acc.requisitions.list(query),
    enabled: Boolean(me),
  });
  const open = (r: RequisitionRow) =>
    router.push(`/dashboard/procurement/requisitions/${r.id}`);

  return (
    <>
      <PageHeader
        title="Requisitions"
        description="Purchase requests: draft → submitted → approved (budget check) → quotations → purchase order."
        actions={
          can(me, "acc.requisition.create") && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New requisition
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {manage && (
              <div role="tablist" className="tabs tabs-box tabs-sm w-fit">
                <button
                  type="button"
                  role="tab"
                  className={`tab ${scope === "mine" ? "tab-active" : ""}`}
                  onClick={() => setScope("mine")}
                >
                  Mine
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`tab ${scope === "campus" ? "tab-active" : ""}`}
                  onClick={() => setScope("campus")}
                >
                  Campus
                </button>
              </div>
            )}
            <select
              className="select select-sm h-8 sm:w-48"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as RequisitionStatus | "")
              }
            >
              <option value="">All statuses</option>
              {REQUISITION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </div>
          <DataTable<RequisitionRow>
            rows={list.data?.data}
            isPending={list.isPending}
            error={list.error}
            onRowClick={open}
            empty={
              mine
                ? "You have no requisitions."
                : "No requisitions on this campus."
            }
            columns={[
              { key: "prNo", label: "PR no", type: "mono" },
              {
                key: "title",
                label: "Title",
                render: (r) => (
                  <span className="font-medium">{r.title ?? "—"}</span>
                ),
              },
              {
                key: "costCentreId",
                label: "Cost centre",
                ref: costCentresRef,
              },
              { key: "neededBy", label: "Needed by", type: "date" },
              {
                key: "status",
                label: "Status",
                render: (r) => (
                  <span className="flex items-center gap-1">
                    <ProcStatus status={r.status} />
                    {r.overBudget && (
                      <span className="badge badge-error badge-outline badge-sm">
                        Over budget
                      </span>
                    )}
                  </span>
                ),
              },
              { key: "createdAt", label: "Raised", type: "datetime" },
            ]}
          />
        </CardContent>
      </Card>
      <RequisitionCreateDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={open}
      />
    </>
  );
}
