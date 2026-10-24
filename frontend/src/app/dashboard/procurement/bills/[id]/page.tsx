"use client";

import { useQuery } from "@tanstack/react-query";
import { WalletIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { BackLink, ProcStatus, Stat } from "@/components/acc/procurement";
import { PayDialog } from "@/components/acc/procurement-orders";
import { DataTable } from "@/components/crud/data-table";
import { DetailList, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { BillRow, PaymentRow } from "@/lib/api/services/acc-procurement";
import { formatDate, formatMoney, todayISO } from "@/lib/format";

export default function SupplierBillPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const [paying, setPaying] = useState<BillRow | null>(null);
  const bill = useQuery({
    queryKey: ["acc.bill", id],
    queryFn: () => api.acc.bills.get(id),
  });

  if (bill.isPending) return <Loading />;
  if (bill.isError) return <ErrorAlert error={bill.error} />;
  const b = bill.data.data;
  const due = b.netPayablePaisa - b.paidPaisa;
  const payable = b.status === "open" || b.status === "partially_paid";
  const overdue = payable && b.dueDate < todayISO();

  return (
    <>
      <BackLink href="/dashboard/procurement/bills">Supplier bills</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Bill <span className="font-mono">{b.billNo}</span> {b.vendorName}{" "}
            <ProcStatus status={b.status} />
            {overdue && (
              <span className="badge badge-error badge-soft badge-sm">
                Overdue
              </span>
            )}
          </span>
        }
        description={`Dated ${formatDate(b.billDate)} · due ${formatDate(b.dueDate)}`}
        actions={
          payable &&
          can(me, "acc.procurement.approve") && (
            <Button onClick={() => setPaying(b)}>
              <WalletIcon /> Pay
            </Button>
          )
        }
      />

      <div className="stats stats-vertical mb-4 w-full border bg-card shadow-sm lg:stats-horizontal">
        <Stat title="Gross" value={formatMoney(b.grossPaisa)} />
        <Stat title="VAT withheld" value={formatMoney(b.vatPaisa)} />
        <Stat title="TDS withheld" value={formatMoney(b.tdsPaisa)} />
        <Stat title="Net payable" value={formatMoney(b.netPayablePaisa)} />
        <Stat title="Paid" value={formatMoney(b.paidPaisa)} />
        <Stat title="Outstanding" value={formatMoney(due)} strong />
      </div>

      <Card className="mb-4">
        <CardContent>
          <DetailList
            items={[
              [
                "Vendor",
                <Link
                  key="v"
                  className="link"
                  href={`/dashboard/procurement/vendors/${b.vendorId}`}
                >
                  {b.vendorName}
                </Link>,
              ],
              [
                "Purchase order",
                b.purchaseOrderId ? (
                  <Link
                    key="po"
                    className="link"
                    href={`/dashboard/procurement/purchase-orders/${b.purchaseOrderId}`}
                  >
                    Open purchase order
                  </Link>
                ) : (
                  "—"
                ),
              ],
              [
                "Journal",
                b.journalId ? (
                  <span className="font-mono text-xs">
                    {b.journalId.slice(0, 8)}…
                  </span>
                ) : (
                  "—"
                ),
              ],
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<PaymentRow>
            rows={b.payments}
            empty="No payments yet."
            columns={[
              { key: "paymentNo", label: "Payment no", type: "mono" },
              { key: "paidOn", label: "Paid on", type: "date" },
              { key: "method", label: "Method", type: "enum" },
              { key: "reference", label: "Reference" },
              {
                key: "amountPaisa",
                label: "Amount",
                className: "text-right",
                type: "money",
              },
            ]}
          />
        </CardContent>
      </Card>
      <PayDialog bill={paying} onOpenChange={(o) => !o && setPaying(null)} />
    </>
  );
}
