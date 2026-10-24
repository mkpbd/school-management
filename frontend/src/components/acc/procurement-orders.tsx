"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { RefSelect } from "@/components/crud/fields";
import { invStoresRef } from "@/components/inv/shared";
import { DetailList } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { api } from "@/lib/api";
import type {
  BillRow,
  PaymentMethod,
  PoDetail,
  PoLine,
} from "@/lib/api/services/acc-procurement";
import {
  formatDate,
  formatMoney,
  humanize,
  toPaisa,
  todayISO,
} from "@/lib/format";
import {
  addDays,
  Field,
  formatQty,
  lineAmount,
  PAYMENT_METHODS,
  round3,
} from "./procurement";

export const PO_INVALIDATE = [
  ["acc.purchaseOrder"],
  ["acc.purchaseOrders"],
  ["acc.bills"],
  ["acc.vendor"],
];
export const BILL_INVALIDATE = [
  ["acc.bill"],
  ["acc.bills"],
  ["acc.purchaseOrder"],
  ["acc.payablesAging"],
  ["acc.vendor"],
];

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="alert alert-error alert-soft text-sm">
      {message}
    </div>
  );
}

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : "Something went wrong.";

function QtyCell({
  value,
  max,
  onChange,
}: {
  value: string;
  max: number;
  onChange: (v: string) => void;
}) {
  return (
    <Input
      type="number"
      step="0.001"
      min="0"
      max={String(max)}
      className="ml-auto h-8 w-28 text-right"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ---- goods receipt ----

export function ReceiveDialog({
  po,
  open,
  onOpenChange,
}: {
  po: PoDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        {open && <ReceiveForm po={po} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ReceiveForm({ po, onDone }: { po: PoDetail; onDone: () => void }) {
  const open = (l: PoLine) => round3(l.quantity - l.receivedQty);
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      po.lines.map((l) => [l.id, open(l) > 0 ? String(open(l)) : ""]),
    ),
  );
  const [receivedOn, setReceivedOn] = useState(todayISO());
  const [storeId, setStoreId] = useState("");
  const [rating, setRating] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const chosen = po.lines
    .map((l) => ({ line: l, quantity: Number(qty[l.id]) || 0 }))
    .filter((x) => x.quantity > 0);
  const needsStore = chosen.some((x) => x.line.itemVariantId);
  const late = Boolean(po.expectedOn && receivedOn > po.expectedOn);

  const receive = useAction(
    () =>
      api.acc.purchaseOrders.receive(po.id, {
        ...(receivedOn ? { receivedOn } : {}),
        ...(needsStore ? { storeId } : {}),
        lines: chosen.map((x) => ({
          poLineId: x.line.id,
          quantity: x.quantity,
        })),
        ...(rating ? { rating: Number(rating) } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    {
      success: (r) =>
        `${r.data.grnNo} recorded — order ${humanize(r.data.poStatus).toLowerCase()}`,
      invalidate: [...PO_INVALIDATE, ["inv.stock"], ["inv.movements"]],
      toastError: false,
      onSuccess: onDone,
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    receive.mutate(undefined, { onError: (err) => setError(errorText(err)) });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Goods receipt — {po.poNo}</DialogTitle>
        <DialogDescription>
          Quantities delivered now (partial deliveries are fine; never more than
          ordered). Stock items go into a store.
        </DialogDescription>
      </DialogHeader>
      <FormError message={error} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Line</TableHead>
            <TableHead className="text-right">Ordered</TableHead>
            <TableHead className="text-right">Received</TableHead>
            <TableHead className="text-right">Now</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {po.lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell>
                {l.description}
                {l.itemVariantId && (
                  <span className="badge badge-ghost badge-sm ml-1">stock</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatQty(l.quantity)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatQty(l.receivedQty)}
              </TableCell>
              <TableCell className="text-right">
                {open(l) > 0 ? (
                  <QtyCell
                    value={qty[l.id] ?? ""}
                    max={open(l)}
                    onChange={(v) => setQty((p) => ({ ...p, [l.id]: v }))}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    complete
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Received on"
          help={
            po.expectedOn
              ? late
                ? `Late (expected ${formatDate(po.expectedOn)})`
                : `On time (expected ${formatDate(po.expectedOn)})`
              : undefined
          }
        >
          <Input
            type="date"
            min={po.orderDate}
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
          />
        </Field>
        <Field
          label="Store"
          required={needsStore}
          help={
            needsStore
              ? "Stock items are added to this store"
              : "Only for stock items"
          }
        >
          <RefSelect
            source={invStoresRef}
            value={storeId}
            required={needsStore}
            onChange={setStoreId}
            filter={(r) => r.isActive !== false}
          />
        </Field>
        <Field label="Rating" help="Vendor performance (1 poor – 5 excellent)">
          <select
            className="select select-sm h-8 w-full"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
          >
            <option value="">Not rated</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {"★".repeat(n)} {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note" className="sm:col-span-3">
          <Textarea
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Condition, shortages, delivery challan no"
          />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={receive.isPending || chosen.length === 0}
        >
          {receive.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Record receipt
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---- supplier bill ----

export function BillDialog({
  po,
  open,
  onOpenChange,
  onRecorded,
}: {
  po: PoDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRecorded?: (b: BillRow) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        {open && (
          <BillForm
            po={po}
            onDone={() => onOpenChange(false)}
            onRecorded={onRecorded}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BillForm({
  po,
  onDone,
  onRecorded,
}: {
  po: PoDetail;
  onDone: () => void;
  onRecorded?: (b: BillRow) => void;
}) {
  const unbilled = (l: PoLine) => round3(l.receivedQty - l.billedQty);
  const vendor = useQuery({
    queryKey: ["acc.vendor", po.vendorId],
    queryFn: () => api.acc.vendors.get(po.vendorId),
  });
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(todayISO());
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      po.lines.map((l) => [l.id, unbilled(l) > 0 ? String(unbilled(l)) : ""]),
    ),
  );
  const [vat, setVat] = useState("");
  const [tds, setTds] = useState("");
  const [error, setError] = useState<string | null>(null);

  const chosen = po.lines
    .map((l) => ({ line: l, quantity: Number(qty[l.id]) || 0 }))
    .filter((x) => x.quantity > 0);
  const gross = chosen.reduce(
    (s, x) => s + lineAmount(x.quantity, x.line.unitPaisa),
    0,
  );
  const v = vendor.data?.data;
  const vatPaisa = vat.trim()
    ? toPaisa(vat)
    : Math.round((gross * Number(v?.vatRatePct ?? 0)) / 100);
  const tdsPaisa = tds.trim()
    ? toPaisa(tds)
    : Math.round((gross * Number(v?.tdsRatePct ?? 0)) / 100);
  const net = gross - vatPaisa - tdsPaisa;

  const record = useAction(
    () =>
      api.acc.purchaseOrders.bill(po.id, {
        billNo: billNo.trim(),
        ...(billDate ? { billDate } : {}),
        lines: chosen.map((x) => ({
          poLineId: x.line.id,
          quantity: x.quantity,
        })),
        ...(vat.trim() ? { vatPaisa: toPaisa(vat) } : {}),
        ...(tds.trim() ? { tdsPaisa: toPaisa(tds) } : {}),
      }),
    {
      success: (r) =>
        `Bill ${r.data.billNo} recorded — net ${formatMoney(r.data.netPayablePaisa)} due ${formatDate(r.data.dueDate)}`,
      invalidate: BILL_INVALIDATE,
      toastError: false,
      onSuccess: (r) => {
        onDone();
        onRecorded?.(r.data);
      },
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    record.mutate(undefined, { onError: (err) => setError(errorText(err)) });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Supplier bill — {po.poNo}</DialogTitle>
        <DialogDescription>
          Three-way match: a bill covers goods received and not yet billed, at
          the order price. VAT and TDS are withheld at the vendor&apos;s rates
          unless overridden; the journal is posted.
        </DialogDescription>
      </DialogHeader>
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bill no" required>
          <Input
            required
            maxLength={60}
            value={billNo}
            onChange={(e) => setBillNo(e.target.value)}
          />
        </Field>
        <Field label="Bill date">
          <Input
            type="date"
            value={billDate}
            onChange={(e) => setBillDate(e.target.value)}
          />
        </Field>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Line</TableHead>
            <TableHead className="text-right">Received</TableHead>
            <TableHead className="text-right">Billed</TableHead>
            <TableHead className="text-right">Bill now</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {po.lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell>
                {l.description}
                <span className="block text-xs text-muted-foreground">
                  {formatMoney(l.unitPaisa)} each
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatQty(l.receivedQty)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatQty(l.billedQty)}
              </TableCell>
              <TableCell className="text-right">
                {unbilled(l) > 0 ? (
                  <QtyCell
                    value={qty[l.id] ?? ""}
                    max={unbilled(l)}
                    onChange={(val) => setQty((p) => ({ ...p, [l.id]: val }))}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    nothing to bill
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(lineAmount(Number(qty[l.id]) || 0, l.unitPaisa))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="VAT withheld (৳)"
          help={`Default ${Number(v?.vatRatePct ?? 0)}% of gross`}
        >
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder={(vatPaisa / 100).toFixed(2)}
            value={vat}
            onChange={(e) => setVat(e.target.value)}
          />
        </Field>
        <Field
          label="TDS withheld (৳)"
          help={`Default ${Number(v?.tdsRatePct ?? 0)}% of gross`}
        >
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder={(tdsPaisa / 100).toFixed(2)}
            value={tds}
            onChange={(e) => setTds(e.target.value)}
          />
        </Field>
      </div>
      <div className="rounded-lg border p-3">
        <DetailList
          items={[
            [
              "Gross",
              <span key="g" className="tabular-nums">
                {formatMoney(gross)}
              </span>,
            ],
            [
              "VAT withheld",
              <span key="v" className="tabular-nums">
                {formatMoney(vatPaisa)}
              </span>,
            ],
            [
              "TDS withheld",
              <span key="t" className="tabular-nums">
                {formatMoney(tdsPaisa)}
              </span>,
            ],
            [
              "Net payable",
              <span
                key="n"
                className={`font-medium tabular-nums ${net < 0 ? "text-destructive" : ""}`}
              >
                {formatMoney(net)}
              </span>,
            ],
            [
              "Due date",
              v && billDate
                ? formatDate(addDays(billDate, v.paymentTermsDays))
                : "—",
            ],
            ["Payment terms", v ? `${v.paymentTermsDays} days` : "—"],
          ]}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={record.isPending || chosen.length === 0 || net < 0}
        >
          {record.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Record bill
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---- payment ----

export function PayDialog({
  bill,
  onOpenChange,
}: {
  bill: BillRow | null;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={bill !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {bill && <PayForm bill={bill} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function PayForm({ bill, onDone }: { bill: BillRow; onDone: () => void }) {
  const due = bill.netPayablePaisa - bill.paidPaisa;
  const [amount, setAmount] = useState((due / 100).toFixed(2));
  const [paidOn, setPaidOn] = useState(todayISO());
  const [method, setMethod] = useState<PaymentMethod>("bank");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pay = useAction(
    () =>
      api.acc.bills.pay(bill.id, {
        amountPaisa: toPaisa(amount),
        ...(paidOn ? { paidOn } : {}),
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      }),
    {
      success: (r) =>
        `${r.data.payment.paymentNo}: ${formatMoney(r.data.payment.amountPaisa)} paid to ${bill.vendorName}`,
      invalidate: BILL_INVALIDATE,
      toastError: false,
      onSuccess: onDone,
    },
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        pay.mutate(undefined, { onError: (err) => setError(errorText(err)) });
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Pay bill {bill.billNo}</DialogTitle>
        <DialogDescription>
          {bill.vendorName} — {formatMoney(due)} outstanding of{" "}
          {formatMoney(bill.netPayablePaisa)}. Posts Dr accounts payable, Cr
          bank / cash / mobile wallet.
        </DialogDescription>
      </DialogHeader>
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount (৳)" required>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            max={(due / 100).toFixed(2)}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Paid on">
          <Input
            type="date"
            min={bill.billDate}
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
          />
        </Field>
        <Field label="Method" required>
          <select
            className="select select-sm h-8 w-full"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {humanize(m)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reference">
          <Input
            maxLength={100}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Cheque / transfer / trx id"
          />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pay.isPending}>
          {pay.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Record payment
        </Button>
      </DialogFooter>
    </form>
  );
}
