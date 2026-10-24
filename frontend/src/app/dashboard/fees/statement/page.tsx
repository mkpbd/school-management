"use client";

import { useQuery } from "@tanstack/react-query";
import { BanknoteIcon, PrinterIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel } from "@/components/crud/fields";
import { FamilyPicker } from "@/components/fee/family-picker";
import { InvoiceTable, invoiceColumns } from "@/components/fee/invoice-table";
import { ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Payment } from "@/lib/api/services/fee";
import { formatMoney } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function FamilyStatementPage() {
  return (
    <Suspense fallback={<Loading />}>
      <FamilyStatementView />
    </Suspense>
  );
}

function FamilyStatementView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const familyId = params.get("familyId");
  const { data: me } = useMe();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Family statement"
        description="All invoices and payments of a family across campuses, with outstanding, overdue and credit."
        actions={
          familyId && (
            <>
              <Button variant="outline" onClick={() => window.print()}>
                <PrinterIcon /> Print
              </Button>
              {can(me, "fee.payment.create") && (
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      href={`/dashboard/fees/payments?familyId=${familyId}`}
                    />
                  }
                >
                  <BanknoteIcon /> Collect payment
                </Button>
              )}
            </>
          )
        }
      />
      <Card className="print:hidden">
        <CardContent className="sm:max-w-md">
          <FamilyPicker
            initialFamilyId={familyId}
            onFamily={(id) =>
              router.replace(id ? `${pathname}?familyId=${id}` : pathname)
            }
          />
        </CardContent>
      </Card>
      {familyId ? <Statement familyId={familyId} /> : null}
    </div>
  );
}

function Statement({ familyId }: { familyId: string }) {
  const statement = useQuery({
    queryKey: ["fee.statement", familyId],
    queryFn: async () => (await api.fee.familyStatement(familyId)).data,
  });

  if (statement.isPending) return <Loading />;
  if (statement.isError) return <ErrorAlert error={statement.error} />;
  const { totals, invoices, payments } = statement.data;

  return (
    <>
      <div className="stats stats-vertical w-full border bg-card shadow-sm sm:stats-horizontal">
        <div className="stat">
          <div className="stat-title">Billed (net)</div>
          <div className="stat-value text-xl">
            {formatMoney(totals.netPaisa)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Paid</div>
          <div className="stat-value text-xl text-success">
            {formatMoney(totals.paidPaisa)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Outstanding</div>
          <div className="stat-value text-xl">
            {formatMoney(totals.outstandingPaisa)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Overdue</div>
          <div
            className={`stat-value text-xl ${totals.overduePaisa > 0 ? "text-error" : ""}`}
          >
            {formatMoney(totals.overduePaisa)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Credit</div>
          <div className="stat-value text-xl">
            {formatMoney(totals.creditPaisa)}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceTable
            rows={invoices}
            columns={[
              ...invoiceColumns.slice(0, 1),
              {
                key: "studentId",
                label: "Student",
                render: (r) => (
                  <RefLabel source={refs.students} id={r.studentId} />
                ),
              },
              ...invoiceColumns.slice(1),
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<Payment>
            rows={payments}
            empty="No payments."
            columns={[
              { key: "paymentNo", label: "Payment", type: "mono" },
              { key: "receiptNo", label: "Receipt", type: "mono" },
              { key: "receivedAt", label: "Received", type: "datetime" },
              { key: "channel", label: "Channel", type: "enum" },
              {
                key: "amountPaisa",
                label: "Amount",
                type: "money",
                className: "text-right",
              },
              { key: "status", label: "Status", type: "status" },
            ]}
          />
        </CardContent>
      </Card>
    </>
  );
}
