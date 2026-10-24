"use client";

import { useQuery } from "@tanstack/react-query";
import { PrinterIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { DataTable } from "@/components/crud/data-table";
import { FamilyPicker } from "@/components/fee/family-picker";
import { invoiceColumns } from "@/components/fee/invoice-table";
import type { Student360 } from "@/components/fee/student-picker";
import { DetailList, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { api } from "@/lib/api";
import type { CounterPaymentResult, Invoice } from "@/lib/api/services/fee";
import { formatMoney, humanize, toPaisa } from "@/lib/format";

const CHANNELS = ["cash", "cheque", "pos_card", "bank_deposit"] as const;
type Channel = (typeof CHANNELS)[number];

/** Instrument details recorded for non-cash payments (free-form JSON on the payment). */
const INSTRUMENT_FIELDS: Record<
  Exclude<Channel, "cash">,
  Array<{ name: string; label: string; type?: string }>
> = {
  cheque: [
    { name: "bank", label: "Bank" },
    { name: "chequeNo", label: "Cheque no" },
    { name: "chequeDate", label: "Cheque date", type: "date" },
  ],
  pos_card: [
    { name: "cardLast4", label: "Card last 4 digits" },
    { name: "approvalCode", label: "Approval code" },
  ],
  bank_deposit: [
    { name: "bank", label: "Bank" },
    { name: "reference", label: "Deposit reference" },
    { name: "depositDate", label: "Deposit date", type: "date" },
  ],
};

export default function CounterPaymentPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CounterPayment />
    </Suspense>
  );
}

function CounterPayment() {
  const params = useSearchParams();
  const linkFamily = params.get("familyId");
  const linkInvoice = params.get("invoiceId");
  const [familyId, setFamilyId] = useState<string | null>(linkFamily);
  const [student, setStudent] = useState<Student360 | undefined>();
  const [receipt, setReceipt] = useState<CounterPaymentResult | null>(null);
  const [formKey, setFormKey] = useState(0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Counter payment"
        description="Collect a payment at the fee counter. Oldest dues are paid first; any surplus becomes family credit. Cash needs an open cash session."
        actions={
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href="/dashboard/fees/cash-sessions" />}
          >
            Cash sessions
          </Button>
        }
      />
      {receipt ? (
        <Receipt
          receipt={receipt}
          familyId={familyId}
          onNew={() => {
            setReceipt(null);
            setFormKey((k) => k + 1);
          }}
        />
      ) : (
        <>
          <Card>
            <CardContent className="sm:max-w-md">
              <FamilyPicker
                initialFamilyId={linkFamily}
                onFamily={(id, s) => {
                  setFamilyId(id);
                  setStudent(s);
                }}
              />
            </CardContent>
          </Card>
          {familyId && (
            <PaymentForm
              key={`${familyId}-${formKey}`}
              familyId={familyId}
              student={student}
              preselect={linkInvoice}
              onPaid={setReceipt}
            />
          )}
        </>
      )}
    </div>
  );
}

function PaymentForm({
  familyId,
  student,
  preselect,
  onPaid,
}: {
  familyId: string;
  student?: Student360;
  preselect: string | null;
  onPaid: (r: CounterPaymentResult) => void;
}) {
  const statement = useQuery({
    queryKey: ["fee.statement", familyId],
    queryFn: async () => (await api.fee.familyStatement(familyId)).data,
  });
  const open = (statement.data?.invoices ?? []).filter(
    (i) =>
      (i.status === "issued" || i.status === "partially_paid") &&
      i.outstandingPaisa > 0,
  );
  const [selected, setSelected] = useState<string[] | null>(
    preselect ? [preselect] : null,
  );
  const chosen = selected ?? open.map((i) => i.id);
  const due = open
    .filter((i) => chosen.includes(i.id))
    .reduce((s, i) => s + i.outstandingPaisa, 0);

  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState<Channel>("cash");
  const [instrument, setInstrument] = useState<Record<string, string>>({});
  const [payerGuardianId, setPayerGuardianId] = useState("");
  const [notes, setNotes] = useState("");
  /** one key per attempt: a retry after a timeout replays the same payment instead of charging twice */
  const [idem] = useState(() => crypto.randomUUID());

  const pay = useAction(
    () => {
      const details = Object.fromEntries(
        Object.entries(instrument).filter(([, v]) => v.trim() !== ""),
      );
      return api.fee.payments.counter(
        {
          familyId,
          amountPaisa: toPaisa(amount || String(due / 100)),
          channel,
          ...(selected !== null ? { invoiceIds: chosen } : {}),
          ...(payerGuardianId ? { payerGuardianId } : {}),
          ...(channel !== "cash" && Object.keys(details).length
            ? { instrument: details }
            : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
        { idempotencyKey: idem },
      );
    },
    {
      success: (r) => `Receipt ${r.data.receiptNo}`,
      invalidate: [["fee.statement"], ["fee.invoices"]],
      toastError: false,
      onSuccess: (r) => onPaid(r.data),
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    pay.mutate(undefined);
  }

  if (statement.isPending) return <Loading label="Loading family dues…" />;
  if (statement.isError) return <ErrorAlert error={statement.error} />;
  const totals = statement.data.totals;

  return (
    <form
      onSubmit={submit}
      className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
    >
      <Card>
        <CardHeader>
          <CardTitle>Open invoices</CardTitle>
          <CardDescription>
            Outstanding {formatMoney(totals.outstandingPaisa)} · overdue{" "}
            {formatMoney(totals.overduePaisa)} · credit{" "}
            {formatMoney(totals.creditPaisa)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable<Invoice>
            rows={open}
            empty="No open invoices. A payment now becomes family credit."
            columns={[
              {
                key: "pick",
                label: "",
                render: (r) => (
                  <input
                    type="checkbox"
                    aria-label={`Pay ${r.invoiceNo}`}
                    className="checkbox checkbox-sm"
                    checked={chosen.includes(r.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...chosen, r.id]
                          : chosen.filter((x) => x !== r.id),
                      )
                    }
                  />
                ),
              },
              ...invoiceColumns.filter(
                (c) => c.key !== "paidPaisa" && c.key !== "status",
              ),
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment</CardTitle>
          <CardDescription>Selected dues {formatMoney(due)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pay.error && <ErrorAlert error={pay.error} />}
          <div className="space-y-1.5">
            <Label htmlFor="p-amount">
              Amount (৳)<span className="text-destructive">*</span>
            </Label>
            <Input
              id="p-amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder={(due / 100).toFixed(2)}
              required={due === 0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Empty: the selected dues.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Channel</Label>
            <div className="join w-full">
              {CHANNELS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`btn btn-sm join-item flex-1 ${channel === c ? "btn-primary" : ""}`}
                  onClick={() => {
                    setChannel(c);
                    setInstrument({});
                  }}
                >
                  {humanize(c)}
                </button>
              ))}
            </div>
          </div>
          {channel !== "cash" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {INSTRUMENT_FIELDS[channel].map((f) => (
                <div key={f.name} className="space-y-1.5">
                  <Label htmlFor={`i-${f.name}`}>{f.label}</Label>
                  <Input
                    id={`i-${f.name}`}
                    type={f.type ?? "text"}
                    value={instrument[f.name] ?? ""}
                    onChange={(e) =>
                      setInstrument((p) => ({ ...p, [f.name]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
          {student && student.guardians.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="p-payer">Paid by</Label>
              <select
                id="p-payer"
                className="select select-sm h-8 w-full"
                value={payerGuardianId}
                onChange={(e) => setPayerGuardianId(e.target.value)}
              >
                <option value="">Not recorded</option>
                {student.guardians.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.fullNameEn}
                    {g.isFeePayer ? " (fee payer)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="p-notes">Notes</Label>
            <Textarea
              id="p-notes"
              rows={2}
              maxLength={300}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={pay.isPending}
          >
            {pay.isPending && (
              <span className="loading loading-spinner loading-xs" />
            )}
            Record payment {formatMoney(amount ? toPaisa(amount) : due)}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}

function Receipt({
  receipt,
  familyId,
  onNew,
}: {
  receipt: CounterPaymentResult;
  familyId: string | null;
  onNew: () => void;
}) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Receipt {receipt.receiptNo}</CardTitle>
        <CardDescription>
          Payment {receipt.paymentNo} · verification code{" "}
          <span className="font-mono font-medium">
            {receipt.verificationCode}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <DetailList
          items={[
            ["Amount", formatMoney(receipt.amountPaisa)],
            ["Allocated to invoices", formatMoney(receipt.allocatedPaisa)],
            ["Added to family credit", formatMoney(receipt.creditPaisa)],
          ]}
        />
        <DataTable
          rows={receipt.allocations}
          rowKey={(r) => r.invoiceId}
          empty="Nothing allocated (all credit)."
          columns={[
            {
              key: "invoiceNo",
              label: "Invoice",
              render: (r) => (
                <Link
                  href={`/dashboard/fees/invoices/${r.invoiceId}`}
                  className="font-mono text-xs hover:underline"
                >
                  {r.invoiceNo}
                </Link>
              ),
            },
            {
              key: "amountPaisa",
              label: "Paid",
              type: "money",
              className: "text-right",
            },
          ]}
        />
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button onClick={() => window.print()} variant="outline">
            <PrinterIcon /> Print
          </Button>
          {familyId && (
            <Button
              nativeButton={false}
              variant="outline"
              render={
                <Link href={`/dashboard/fees/statement?familyId=${familyId}`} />
              }
            >
              Family statement
            </Button>
          )}
          <Button onClick={onNew}>
            <RotateCcwIcon /> New payment
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
