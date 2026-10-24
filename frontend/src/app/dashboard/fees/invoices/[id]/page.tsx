"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  BanIcon,
  BanknoteIcon,
  ScrollTextIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel } from "@/components/crud/fields";
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
import type { InvoiceLine } from "@/lib/api/services/fee";
import { formatDate, formatMoney, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const [voiding, setVoiding] = useState(false);
  const invoice = useQuery({
    queryKey: ["fee.invoices", "get", id],
    queryFn: async () => (await api.fee.invoices.get(id)).data,
  });
  const voidInvoice = useAction(
    (reason: string) => api.fee.invoices.void(id, { reason }),
    {
      invalidate: [["fee.invoices"]],
      toastError: false,
    },
  );

  if (invoice.isPending) return <Loading />;
  if (invoice.isError) return <ErrorAlert error={invoice.error} />;
  const inv = invoice.data;
  const statementHref = `/dashboard/fees/statement?familyId=${inv.familyId}`;
  const open = inv.status === "issued" || inv.status === "partially_paid";

  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="font-mono">{inv.invoiceNo}</span>}
        description={
          inv.billingPeriod
            ? `Billing period ${inv.billingPeriod}`
            : "Ad-hoc invoice"
        }
        actions={
          <>
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/dashboard/fees/invoices" />}
            >
              <ArrowLeftIcon /> All invoices
            </Button>
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href={statementHref} />}
            >
              <ScrollTextIcon /> Family statement
            </Button>
            {open && can(me, "fee.payment.create") && (
              <Button
                nativeButton={false}
                render={
                  <Link
                    href={`/dashboard/fees/payments?familyId=${inv.familyId}&invoiceId=${inv.id}`}
                  />
                }
              >
                <BanknoteIcon /> Collect payment
              </Button>
            )}
            {inv.status !== "void" &&
              inv.paidPaisa === 0 &&
              can(me, "fee.invoice.delete") && (
                <Button variant="destructive" onClick={() => setVoiding(true)}>
                  <BanIcon /> Void
                </Button>
              )}
          </>
        }
      />

      <div className="stats stats-vertical w-full border bg-card shadow-sm sm:stats-horizontal">
        <div className="stat">
          <div className="stat-title">Gross</div>
          <div className="stat-value text-xl">
            {formatMoney(inv.grossPaisa)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Discount</div>
          <div className="stat-value text-xl">
            {formatMoney(inv.discountPaisa)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Net</div>
          <div className="stat-value text-xl">{formatMoney(inv.netPaisa)}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Paid</div>
          <div className="stat-value text-xl text-success">
            {formatMoney(inv.paidPaisa)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Outstanding</div>
          <div
            className={`stat-value text-xl ${inv.outstandingPaisa > 0 ? "text-error" : ""}`}
          >
            {formatMoney(inv.outstandingPaisa)}
          </div>
        </div>
      </div>

      <Card>
        <CardContent>
          <DetailList
            items={[
              ["Status", <StatusBadge key="s" status={inv.status} />],
              [
                "Student",
                <RefLabel key="st" source={refs.students} id={inv.studentId} />,
              ],
              [
                "Campus",
                <RefLabel key="c" source={refs.campuses} id={inv.campusId} />,
              ],
              ["Issued", formatDate(inv.issueDate)],
              ["Due", formatDate(inv.dueDate)],
              [
                "Family",
                <Link
                  key="f"
                  href={statementHref}
                  className="font-mono text-xs underline-offset-4 hover:underline"
                >
                  {inv.familyId}
                </Link>,
              ],
              [
                "Pay token",
                inv.payToken ? (
                  <span key="p" className="font-mono text-xs">
                    {inv.payToken}
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
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<InvoiceLine>
            rows={inv.lines ?? []}
            empty="No lines."
            columns={[
              { key: "feeHeadId", label: "Fee head", ref: refs.feeHeads },
              { key: "description", label: "Description" },
              {
                key: "source",
                label: "Source",
                render: (l) => humanize(l.source),
              },
              {
                key: "amountPaisa",
                label: "Amount",
                type: "money",
                className: "text-right",
              },
              {
                key: "discountPaisa",
                label: "Discount",
                type: "money",
                className: "text-right",
              },
              {
                key: "netPaisa",
                label: "Net",
                type: "money",
                className: "text-right",
              },
              {
                key: "paidPaisa",
                label: "Paid",
                type: "money",
                className: "text-right",
              },
            ]}
          />
        </CardContent>
      </Card>

      <FormDialog
        open={voiding}
        onOpenChange={setVoiding}
        title={`Void ${inv.invoiceNo}?`}
        description="Only invoices with no payments can be voided. This cannot be undone."
        fields={[
          {
            name: "reason",
            label: "Reason",
            type: "textarea",
            required: true,
            help: "3–300 characters",
          },
        ]}
        submitLabel="Void invoice"
        successMessage="Invoice voided"
        onSubmit={(body) => voidInvoice.mutateAsync(String(body.reason))}
      />
    </div>
  );
}
