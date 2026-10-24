"use client";

import { useQuery } from "@tanstack/react-query";
import { BanIcon, PackageCheckIcon, ReceiptTextIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BackLink,
  costCentresRef,
  expenseAccountsRef,
  formatQty,
  lineAmount,
  ProcStatus,
  Rating,
} from "@/components/acc/procurement";
import {
  BillDialog,
  PO_INVALIDATE,
  ReceiveDialog,
} from "@/components/acc/procurement-orders";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { invStoresRef, invVariantsRef } from "@/components/inv/shared";
import { DetailList, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { FileButton } from "@/components/payroll/runs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type {
  BillRow,
  PoLine,
  ReceiptRow,
} from "@/lib/api/services/acc-procurement";
import { formatDate, formatMoney } from "@/lib/format";

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: me } = useMe();
  const [receiving, setReceiving] = useState(false);
  const [billing, setBilling] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const po = useQuery({
    queryKey: ["acc.purchaseOrder", id],
    queryFn: () => api.acc.purchaseOrders.get(id),
  });
  const cancel = useAction(
    (reason: string) => api.acc.purchaseOrders.cancel(id, { reason }),
    {
      invalidate: [...PO_INVALIDATE, ["acc.requisition"], ["acc.requisitions"]],
      toastError: false,
    },
  );

  if (po.isPending) return <Loading />;
  if (po.isError) return <ErrorAlert error={po.error} />;
  const o = po.data.data;
  const canBuy = can(me, "acc.procurement.create");
  const canApprove = can(me, "acc.procurement.approve");
  const receivable = o.status === "issued" || o.status === "partially_received";
  const unbilled = o.lines.some((l) => l.receivedQty - l.billedQty > 0.0005);
  const billable =
    o.status !== "cancelled" && o.status !== "issued" && unbilled;
  const cancellable =
    o.status === "issued" && o.lines.every((l) => l.receivedQty === 0);
  const lineNo = new Map(o.lines.map((l, i) => [l.id, l.lineNo ?? i + 1]));
  const sum = (k: "receivedQty" | "billedQty") =>
    o.lines.reduce((s, l) => s + lineAmount(l[k], l.unitPaisa), 0);

  return (
    <>
      <BackLink href="/dashboard/procurement/purchase-orders">
        Purchase orders
      </BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{o.poNo}</span> {o.vendorName}{" "}
            <ProcStatus status={o.status} />
          </span>
        }
        description={`Ordered ${formatDate(o.orderDate)}${o.expectedOn ? ` · expected ${formatDate(o.expectedOn)}` : ""}`}
        actions={
          <>
            <FileButton mode="open" load={() => api.acc.purchaseOrders.pdf(id)}>
              PDF
            </FileButton>
            {receivable && canBuy && (
              <Button size="sm" onClick={() => setReceiving(true)}>
                <PackageCheckIcon /> Receive goods
              </Button>
            )}
            {billable && canBuy && (
              <Button
                size="sm"
                variant={receivable ? "outline" : "default"}
                onClick={() => setBilling(true)}
              >
                <ReceiptTextIcon /> Record bill
              </Button>
            )}
            {cancellable && canApprove && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCancelling(true)}
              >
                <BanIcon /> Cancel order
              </Button>
            )}
          </>
        }
      />

      <div className="stats stats-vertical mb-4 w-full border bg-card shadow-sm lg:stats-horizontal">
        <div className="stat">
          <div className="stat-title">Ordered</div>
          <div className="stat-value text-xl tabular-nums">
            {formatMoney(o.totalPaisa)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Received</div>
          <div className="stat-value text-xl tabular-nums">
            {formatMoney(sum("receivedQty"))}
          </div>
          <div className="stat-desc">{o.receipts.length} receipt(s)</div>
        </div>
        <div className="stat">
          <div className="stat-title">Billed</div>
          <div className="stat-value text-xl tabular-nums">
            {formatMoney(sum("billedQty"))}
          </div>
          <div className="stat-desc">{o.bills.length} bill(s)</div>
        </div>
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
                  href={`/dashboard/procurement/vendors/${o.vendorId}`}
                >
                  {o.vendorName}
                </Link>,
              ],
              [
                "Requisition",
                o.requisitionId ? (
                  <Link
                    key="r"
                    className="link"
                    href={`/dashboard/procurement/requisitions/${o.requisitionId}`}
                  >
                    Open requisition
                  </Link>
                ) : (
                  "—"
                ),
              ],
              [
                "Cost centre",
                <RefLabel
                  key="cc"
                  source={costCentresRef}
                  id={o.costCentreId}
                />,
              ],
              [
                "Terms",
                o.terms ? (
                  <span className="whitespace-pre-line">{o.terms}</span>
                ) : (
                  "—"
                ),
              ],
              ["Cancelled because", o.cancelledReason],
            ]}
          />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<PoLine>
            rows={o.lines}
            columns={[
              { key: "lineNo", label: "#" },
              { key: "description", label: "Description" },
              {
                key: "itemVariantId",
                label: "Stock item",
                ref: invVariantsRef,
              },
              { key: "accountId", label: "Account", ref: expenseAccountsRef },
              {
                key: "unitPaisa",
                label: "Unit",
                className: "text-right",
                type: "money",
              },
              {
                key: "quantity",
                label: "Ordered",
                className: "text-right",
                render: (l) => (
                  <span className="tabular-nums">{formatQty(l.quantity)}</span>
                ),
              },
              {
                key: "receivedQty",
                label: "Received",
                className: "text-right",
                render: (l) => (
                  <span
                    className={`tabular-nums ${l.receivedQty >= l.quantity ? "text-success" : ""}`}
                  >
                    {formatQty(l.receivedQty)}
                  </span>
                ),
              },
              {
                key: "billedQty",
                label: "Billed",
                className: "text-right",
                render: (l) => (
                  <span
                    className={`tabular-nums ${l.billedQty >= l.quantity ? "text-success" : ""}`}
                  >
                    {formatQty(l.billedQty)}
                  </span>
                ),
              },
              {
                key: "amount",
                label: "Amount",
                className: "text-right",
                render: (l) => (
                  <span className="tabular-nums">
                    {formatMoney(lineAmount(l.quantity, l.unitPaisa))}
                  </span>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Goods receipts</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<ReceiptRow>
            rows={o.receipts}
            empty="Nothing received yet."
            columns={[
              { key: "grnNo", label: "GRN no", type: "mono" },
              { key: "receivedOn", label: "Received", type: "date" },
              {
                key: "onTime",
                label: "Delivery",
                render: (r) =>
                  r.onTime ? (
                    <span className="badge badge-success badge-soft badge-sm">
                      On time
                    </span>
                  ) : (
                    <span className="badge badge-warning badge-soft badge-sm">
                      Late
                    </span>
                  ),
              },
              {
                key: "rating",
                label: "Rating",
                render: (r) => <Rating value={r.rating} />,
              },
              { key: "storeId", label: "Store", ref: invStoresRef },
              {
                key: "lines",
                label: "Quantities",
                render: (r) => (
                  <span className="text-xs">
                    {r.lines
                      .map(
                        (l) =>
                          `#${lineNo.get(l.poLineId) ?? "?"}: ${formatQty(l.quantity)}`,
                      )
                      .join(" · ")}
                  </span>
                ),
              },
              { key: "note", label: "Note" },
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
            rows={o.bills}
            empty="No bills yet."
            onRowClick={(b) =>
              router.push(`/dashboard/procurement/bills/${b.id}`)
            }
            columns={[
              { key: "billNo", label: "Bill no", type: "mono" },
              { key: "billDate", label: "Date", type: "date" },
              { key: "dueDate", label: "Due", type: "date" },
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
                key: "paidPaisa",
                label: "Paid",
                className: "text-right",
                type: "money",
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

      <ReceiveDialog po={o} open={receiving} onOpenChange={setReceiving} />
      <BillDialog po={o} open={billing} onOpenChange={setBilling} />
      <FormDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${o.poNo}?`}
        description="Only an issued order with nothing received can be cancelled. The requisition reopens so another quotation can be chosen."
        submitLabel="Cancel order"
        successMessage="Purchase order cancelled"
        fields={[
          {
            name: "reason",
            label: "Reason",
            type: "textarea",
            required: true,
            help: "At least 3 characters",
          },
        ]}
        onSubmit={(body) => cancel.mutateAsync(String(body.reason))}
      />
    </>
  );
}
