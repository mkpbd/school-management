"use client";

import { useQuery } from "@tanstack/react-query";
import { WalletIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  BILL_STATUSES,
  ProcStatus,
  vendorsRef,
} from "@/components/acc/procurement";
import { PayDialog } from "@/components/acc/procurement-orders";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { BillRow, BillStatus } from "@/lib/api/services/acc-procurement";
import { formatDate, formatMoney, humanize, todayISO } from "@/lib/format";

export default function SupplierBillsPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [status, setStatus] = useState<BillStatus | "">("");
  const [vendorId, setVendorId] = useState("");
  const [paying, setPaying] = useState<BillRow | null>(null);

  const query = {
    ...(status ? { status } : {}),
    ...(vendorId ? { vendorId } : {}),
  };
  const list = useQuery({
    queryKey: ["acc.bills", query],
    queryFn: () => api.acc.bills.list(query),
  });
  const canPay = can(me, "acc.procurement.approve");
  const today = todayISO();
  const outstanding = (list.data?.data ?? []).reduce(
    (s, b) =>
      s +
      (b.status === "open" || b.status === "partially_paid"
        ? b.netPayablePaisa - b.paidPaisa
        : 0),
    0,
  );

  return (
    <>
      <PageHeader
        title="Supplier bills"
        description="Bills recorded against received goods, with VAT / TDS withheld. Pay in full or in part."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              className="select select-sm h-8 sm:w-48"
              value={status}
              onChange={(e) => setStatus(e.target.value as BillStatus | "")}
            >
              <option value="">All statuses</option>
              {BILL_STATUSES.map((s) => (
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
            <span className="text-sm text-muted-foreground sm:ml-auto">
              Outstanding{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatMoney(outstanding)}
              </span>
            </span>
          </div>
          <DataTable<BillRow>
            rows={list.data?.data}
            isPending={list.isPending}
            error={list.error}
            onRowClick={(b) =>
              router.push(`/dashboard/procurement/bills/${b.id}`)
            }
            empty="No supplier bills. They are recorded on a purchase order after goods are received."
            columns={[
              { key: "billNo", label: "Bill no", type: "mono" },
              {
                key: "vendorName",
                label: "Vendor",
                render: (b) => (
                  <span className="font-medium">{b.vendorName}</span>
                ),
              },
              { key: "billDate", label: "Date", type: "date" },
              {
                key: "dueDate",
                label: "Due",
                type: "date",
                render: (b) => {
                  const overdue =
                    b.dueDate < today &&
                    (b.status === "open" || b.status === "partially_paid");
                  return (
                    <span
                      className={overdue ? "font-medium text-destructive" : ""}
                    >
                      {formatDate(b.dueDate)}
                    </span>
                  );
                },
              },
              {
                key: "grossPaisa",
                label: "Gross",
                className: "text-right",
                type: "money",
              },
              {
                key: "vatPaisa",
                label: "VAT",
                className: "text-right",
                type: "money",
              },
              {
                key: "tdsPaisa",
                label: "TDS",
                className: "text-right",
                type: "money",
              },
              {
                key: "netPayablePaisa",
                label: "Net",
                className: "text-right",
                type: "money",
              },
              {
                key: "duePaisa",
                label: "Outstanding",
                className: "text-right",
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
            actions={
              canPay
                ? (b) =>
                    b.status === "open" || b.status === "partially_paid" ? (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => setPaying(b)}
                      >
                        <WalletIcon /> Pay
                      </Button>
                    ) : null
                : undefined
            }
          />
        </CardContent>
      </Card>
      <PayDialog bill={paying} onOpenChange={(o) => !o && setPaying(null)} />
    </>
  );
}
