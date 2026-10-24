"use client";

import { useQuery } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BackLink,
  ProcStatus,
  Rating,
  Stat,
} from "@/components/acc/procurement";
import { vendorFields } from "@/components/acc/procurement-vendor";
import { DataTable } from "@/components/crud/data-table";
import { FormDialog } from "@/components/crud/form-dialog";
import {
  DetailList,
  ErrorAlert,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { BillRow, PoRow } from "@/lib/api/services/acc-procurement";
import { formatMoney } from "@/lib/format";

type VendorPatch = Parameters<typeof api.acc.vendors.update>[1];

export default function VendorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: me } = useMe();
  const [editing, setEditing] = useState(false);

  const vendor = useQuery({
    queryKey: ["acc.vendor", id],
    queryFn: () => api.acc.vendors.get(id),
  });
  const pos = useQuery({
    queryKey: ["acc.purchaseOrders", { vendorId: id }],
    queryFn: () => api.acc.purchaseOrders.list({ vendorId: id }),
  });
  const bills = useQuery({
    queryKey: ["acc.bills", { vendorId: id }],
    queryFn: () => api.acc.bills.list({ vendorId: id }),
  });
  const update = useAction(
    (body: VendorPatch) => api.acc.vendors.update(id, body),
    {
      invalidate: [["acc.vendor", id], ["acc.vendors"]],
      toastError: false,
    },
  );

  if (vendor.isPending) return <Loading />;
  if (vendor.isError) return <ErrorAlert error={vendor.error} />;
  const v = vendor.data.data;
  const p = v.performance;

  return (
    <>
      <BackLink href="/dashboard/procurement/vendors">Vendors</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {v.name}{" "}
            <span className="font-mono text-base text-muted-foreground">
              {v.code}
            </span>
            <StatusBadge status={v.isActive ? "active" : "inactive"} />
          </span>
        }
        description={`Payment terms ${v.paymentTermsDays} days`}
        actions={
          can(me, "acc.procurement.create") && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon /> Edit
            </Button>
          )
        }
      />

      <div className="stats stats-vertical mb-4 w-full border bg-card shadow-sm lg:stats-horizontal">
        <Stat
          title="Orders"
          value={p.orders}
          desc={formatMoney(p.orderedPaisa)}
        />
        <Stat
          title="Deliveries"
          value={p.receipts}
          desc={
            p.onTimePct === null
              ? "No deliveries yet"
              : `${Number(p.onTimePct).toFixed(0)}% on time`
          }
        />
        <Stat
          title="Average rating"
          value={p.avgRating === null ? "—" : Number(p.avgRating).toFixed(1)}
          desc={<Rating value={p.avgRating} />}
        />
        <Stat title="Billed" value={formatMoney(p.billedPaisa)} />
        <Stat
          title="Outstanding"
          value={formatMoney(p.outstandingPaisa)}
          strong
        />
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList
            items={[
              ["Phone", v.phone],
              ["Email", v.email],
              ["Address", v.address],
              ["TIN", v.tin],
              ["BIN", v.binVat],
              [
                "VAT deducted at source",
                v.vatRatePct === null ? "—" : `${Number(v.vatRatePct)}%`,
              ],
              [
                "TDS / AIT",
                v.tdsRatePct === null ? "—" : `${Number(v.tdsRatePct)}%`,
              ],
              ["Payment terms", `${v.paymentTermsDays} days`],
              [
                "Performance note",
                v.performanceNote ? (
                  <span className="whitespace-pre-line">
                    {v.performanceNote}
                  </span>
                ) : (
                  "—"
                ),
              ],
            ]}
          />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Purchase orders</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<PoRow>
            rows={pos.data?.data}
            isPending={pos.isPending}
            error={pos.error}
            empty="No purchase orders with this vendor."
            onRowClick={(r) =>
              router.push(`/dashboard/procurement/purchase-orders/${r.id}`)
            }
            columns={[
              { key: "poNo", label: "PO no", type: "mono" },
              { key: "orderDate", label: "Ordered", type: "date" },
              { key: "expectedOn", label: "Expected", type: "date" },
              { key: "totalPaisa", label: "Total", type: "money" },
              {
                key: "status",
                label: "Status",
                render: (r) => <ProcStatus status={r.status} />,
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bills</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<BillRow>
            rows={bills.data?.data}
            isPending={bills.isPending}
            error={bills.error}
            empty="No bills from this vendor."
            onRowClick={(r) =>
              router.push(`/dashboard/procurement/bills/${r.id}`)
            }
            columns={[
              { key: "billNo", label: "Bill no", type: "mono" },
              { key: "billDate", label: "Date", type: "date" },
              { key: "dueDate", label: "Due", type: "date" },
              { key: "netPayablePaisa", label: "Net payable", type: "money" },
              {
                key: "duePaisa",
                label: "Outstanding",
                render: (b) => (
                  <span className="tabular-nums">
                    {formatMoney(b.netPayablePaisa - b.paidPaisa)}
                  </span>
                ),
              },
              {
                key: "status",
                label: "Status",
                render: (b) => <ProcStatus status={b.status} />,
              },
            ]}
          />
        </CardContent>
      </Card>

      <FormDialog
        open={editing}
        onOpenChange={setEditing}
        title={`Edit ${v.code}`}
        description="The code cannot change. New rates apply to bills recorded from now on."
        row={v}
        fields={vendorFields}
        onSubmit={(body) => update.mutateAsync(body as VendorPatch)}
      />
    </>
  );
}
