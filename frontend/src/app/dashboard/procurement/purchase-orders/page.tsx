"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  PO_STATUSES,
  ProcStatus,
  vendorsRef,
} from "@/components/acc/procurement";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { PoRow, PoStatus } from "@/lib/api/services/acc-procurement";
import { humanize } from "@/lib/format";

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [status, setStatus] = useState<PoStatus | "">("");
  const [vendorId, setVendorId] = useState("");

  const query = {
    ...(status ? { status } : {}),
    ...(vendorId ? { vendorId } : {}),
  };
  const list = useQuery({
    queryKey: ["acc.purchaseOrders", query],
    queryFn: () => api.acc.purchaseOrders.list(query),
  });

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Orders of the active campus, issued from approved requisitions at the selected quotation. Open one to receive goods or record the bill."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              className="select select-sm h-8 sm:w-48"
              value={status}
              onChange={(e) => setStatus(e.target.value as PoStatus | "")}
            >
              <option value="">All statuses</option>
              {PO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
            <div className="sm:w-64">
              <RefSelect
                source={vendorsRef}
                value={vendorId}
                placeholder="All vendors"
                onChange={setVendorId}
              />
            </div>
          </div>
          <DataTable<PoRow>
            rows={list.data?.data}
            isPending={list.isPending}
            error={list.error}
            onRowClick={(r) =>
              router.push(`/dashboard/procurement/purchase-orders/${r.id}`)
            }
            empty="No purchase orders. They are issued from an approved requisition once a quotation is selected."
            columns={[
              { key: "poNo", label: "PO no", type: "mono" },
              {
                key: "vendorName",
                label: "Vendor",
                render: (r) => (
                  <span className="font-medium">{r.vendorName}</span>
                ),
              },
              { key: "orderDate", label: "Ordered", type: "date" },
              { key: "expectedOn", label: "Expected", type: "date" },
              {
                key: "totalPaisa",
                label: "Total",
                className: "text-right",
                type: "money",
              },
              {
                key: "status",
                label: "Status",
                render: (r) => <ProcStatus status={r.status} />,
              },
            ]}
          />
        </CardContent>
      </Card>
    </>
  );
}
