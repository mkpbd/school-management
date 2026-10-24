"use client";

import { useQuery } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { RefSelect } from "@/components/crud/fields";
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
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { api } from "@/lib/api";
import type { StockRow, StoreRow } from "@/lib/api/services/inv";
import { formatMoney, toPaisa } from "@/lib/format";
import { formatDelta, formatQty, invStoresRef, invVariantsRef } from "./shared";

export type StockAction = "receive" | "issue" | "transfer" | "count";

const INVALIDATE = [["inv.stock"], ["inv.movements"]];

interface LineDraft {
  variantId: string;
  qty: string;
  /** unit cost in taka (receipts only) */
  cost: string;
}

const emptyLine = (): LineDraft => ({ variantId: "", qty: "", cost: "" });

export const stockLabel = (r: StockRow) =>
  `${r.sku} ${r.itemName}${r.variantCode !== "STD" ? ` · ${r.variantCode}` : ""}`;

/** Receipt / issue / transfer / count dialog of one store. API errors (INSUFFICIENT_STOCK, ...) are toasted. */
export function StockActionDialog({
  action,
  store,
  onOpenChange,
}: {
  action: StockAction | null;
  store: StoreRow;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={action !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
        {action === "receive" && (
          <ReceiveForm store={store} onDone={() => onOpenChange(false)} />
        )}
        {action === "issue" && (
          <OutwardForm
            mode="issue"
            store={store}
            onDone={() => onOpenChange(false)}
          />
        )}
        {action === "transfer" && (
          <OutwardForm
            mode="transfer"
            store={store}
            onDone={() => onOpenChange(false)}
          />
        )}
        {action === "count" && (
          <CountForm store={store} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Whole-store stock (shared with the stock page when it has no filters). */
function useStoreStock(storeId: string) {
  return useQuery({
    queryKey: ["inv.stock", storeId, {}],
    queryFn: () => api.inv.stores.stock(storeId, {}),
  });
}

function Field({
  label,
  required,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label>
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

function QtyInput({
  value,
  onChange,
  min = "0.001",
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  placeholder?: string;
}) {
  return (
    <Input
      type="number"
      step="0.001"
      min={min}
      max="1000000"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Footer({
  onCancel,
  busy,
  disabled,
  label,
}: {
  onCancel: () => void;
  busy: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={busy || disabled}>
        {busy && <span className="loading loading-spinner loading-xs" />}
        {label}
      </Button>
    </DialogFooter>
  );
}

function LinesHeader({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-medium">Lines</h3>
      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <PlusIcon /> Add line
      </Button>
    </div>
  );
}

function RemoveLine({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Remove line"
      disabled={disabled}
      onClick={onClick}
    >
      <Trash2Icon className="text-destructive" />
    </Button>
  );
}

// ---- opening balance / receipt ----

function ReceiveForm({
  store,
  onDone,
}: {
  store: StoreRow;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<"receipt" | "opening">("receipt");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const update = (i: number, patch: Partial<LineDraft>) =>
    setLines((p) => p.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce(
    (s, l) => s + (Number(l.qty) || 0) * toPaisa(l.cost || 0),
    0,
  );

  const receive = useAction(
    () =>
      api.inv.stores.receive(store.id, {
        kind,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        lines: lines.map((l) => ({
          variantId: l.variantId,
          qty: Number(l.qty),
          unitCostPaisa: toPaisa(l.cost),
        })),
      }),
    {
      success: (r) =>
        `${kind === "opening" ? "Opening balance" : "Receipt"} posted (${r.data.movements} line${r.data.movements === 1 ? "" : "s"})`,
      invalidate: INVALIDATE,
      onSuccess: onDone,
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    receive.mutate(undefined);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Receive into {store.name}</DialogTitle>
        <DialogDescription>
          Opening balance or a receipt without a purchase order (donation,
          return from a department). Purchase orders are received in
          procurement.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Field label="Kind" required>
          <select
            className="select select-sm h-8 w-full"
            value={kind}
            onChange={(e) => setKind(e.target.value as "receipt" | "opening")}
          >
            <option value="receipt">Receipt</option>
            <option value="opening">Opening balance</option>
          </select>
        </Field>
        <Field label="Reason / source">
          <Input
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
      <div className="space-y-3">
        <LinesHeader onAdd={() => setLines((p) => [...p, emptyLine()])} />
        {lines.map((l, i) => (
          <div
            key={i}
            className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[3fr_1fr_1fr_1fr_auto] sm:items-end"
          >
            <Field label="Item">
              <RefSelect
                source={invVariantsRef}
                value={l.variantId}
                onChange={(v) => update(i, { variantId: v })}
                required
              />
            </Field>
            <Field label="Quantity">
              <QtyInput value={l.qty} onChange={(v) => update(i, { qty: v })} />
            </Field>
            <Field label="Unit cost (৳)">
              <Input
                type="number"
                step="0.01"
                min="0"
                required
                value={l.cost}
                onChange={(e) => update(i, { cost: e.target.value })}
              />
            </Field>
            <div className="pb-1.5 text-right text-sm tabular-nums text-muted-foreground">
              {formatMoney((Number(l.qty) || 0) * toPaisa(l.cost || 0))}
            </div>
            <RemoveLine
              disabled={lines.length === 1}
              onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        <div className="text-right text-sm">
          Total{" "}
          <span className="font-medium tabular-nums">{formatMoney(total)}</span>
        </div>
      </div>
      <Footer
        onCancel={onDone}
        busy={receive.isPending}
        label={kind === "opening" ? "Post opening balance" : "Post receipt"}
      />
    </form>
  );
}

// ---- issue note / transfer ----

function OutwardForm({
  mode,
  store,
  onDone,
}: {
  mode: "issue" | "transfer";
  store: StoreRow;
  onDone: () => void;
}) {
  const stock = useStoreStock(store.id);
  const available = (stock.data?.data.rows ?? []).filter((r) => r.onHand > 0);
  const byVariant = new Map(available.map((r) => [r.variantId, r]));
  const [issuedTo, setIssuedTo] = useState("");
  const [toStoreId, setToStoreId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const update = (i: number, patch: Partial<LineDraft>) =>
    setLines((p) => p.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const body = {
    ...(reason.trim() ? { reason: reason.trim() } : {}),
    lines: lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty) })),
  };

  const issue = useAction(
    () =>
      api.inv.stores.issue(store.id, { issuedTo: issuedTo.trim(), ...body }),
    {
      success: "Issue note posted",
      invalidate: INVALIDATE,
      onSuccess: onDone,
    },
  );
  const transfer = useAction(
    () => api.inv.transfer({ fromStoreId: store.id, toStoreId, ...body }),
    {
      success: "Stock transferred",
      invalidate: INVALIDATE,
      onSuccess: onDone,
    },
  );
  const run = mode === "issue" ? issue : transfer;

  function submit(e: FormEvent) {
    e.preventDefault();
    run.mutate(undefined);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>
          {mode === "issue"
            ? `Issue from ${store.name}`
            : `Transfer from ${store.name}`}
        </DialogTitle>
        <DialogDescription>
          {mode === "issue"
            ? "Goods handed to a department or person. Never more than is on hand."
            : "Moves stock to another store at the average cost."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "issue" ? (
          <Field label="Issued to" required>
            <Input
              required
              minLength={2}
              maxLength={120}
              placeholder="Science dept / Mr Karim"
              value={issuedTo}
              onChange={(e) => setIssuedTo(e.target.value)}
            />
          </Field>
        ) : (
          <Field label="To store" required>
            <RefSelect
              source={invStoresRef}
              value={toStoreId}
              onChange={setToStoreId}
              filter={(r) => r.id !== store.id && r.isActive === true}
              required
            />
          </Field>
        )}
        <Field label="Reason">
          <Input
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
      <div className="space-y-3">
        <LinesHeader onAdd={() => setLines((p) => [...p, emptyLine()])} />
        {lines.map((l, i) => {
          const row = byVariant.get(l.variantId);
          return (
            <div
              key={i}
              className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[3fr_1fr_1fr_auto] sm:items-end"
            >
              <Field label="Item">
                <select
                  className="select select-sm h-8 w-full"
                  required
                  disabled={stock.isPending}
                  value={l.variantId}
                  onChange={(e) => update(i, { variantId: e.target.value })}
                >
                  <option value="">
                    {stock.isPending
                      ? "Loading…"
                      : available.length
                        ? "Select…"
                        : "Nothing on hand"}
                  </option>
                  {available.map((r) => (
                    <option key={r.variantId} value={r.variantId}>
                      {stockLabel(r)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Quantity">
                <QtyInput
                  value={l.qty}
                  onChange={(v) => update(i, { qty: v })}
                />
              </Field>
              <div className="pb-1.5 text-sm text-muted-foreground">
                {row ? `On hand ${formatQty(row.onHand, row.unit)}` : ""}
              </div>
              <RemoveLine
                disabled={lines.length === 1}
                onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
              />
            </div>
          );
        })}
      </div>
      <Footer
        onCancel={onDone}
        busy={run.isPending}
        label={mode === "issue" ? "Post issue note" : "Transfer"}
      />
    </form>
  );
}

// ---- stock count ----

function CountForm({ store, onDone }: { store: StoreRow; onDone: () => void }) {
  const stock = useStoreStock(store.id);
  const rows = stock.data?.data.rows ?? [];
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<LineDraft[]>([]);
  const [reason, setReason] = useState("");
  const updateExtra = (i: number, patch: Partial<LineDraft>) =>
    setExtra((p) => p.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const lines = [
    ...rows
      .filter((r) => (counted[r.variantId] ?? "") !== "")
      .map((r) => ({
        variantId: r.variantId,
        countedQty: Number(counted[r.variantId]),
      })),
    ...extra
      .filter((l) => l.variantId && l.qty !== "")
      .map((l) => ({ variantId: l.variantId, countedQty: Number(l.qty) })),
  ];
  const count = useAction(
    () => api.inv.stores.count(store.id, { reason: reason.trim(), lines }),
    {
      success: (r) =>
        r.data.differences.length
          ? `Count posted: ${r.data.differences.length} adjustment${r.data.differences.length === 1 ? "" : "s"}`
          : "Count posted: no differences",
      invalidate: INVALIDATE,
      onSuccess: onDone,
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    count.mutate(undefined);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Stock count — {store.name}</DialogTitle>
        <DialogDescription>
          Counted quantities replace the book quantities; the differences are
          posted as adjustments. Leave a line empty to skip it.
        </DialogDescription>
      </DialogHeader>
      <Field label="Reason" required>
        <Input
          required
          minLength={3}
          maxLength={300}
          placeholder="Year-end count"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {stock.isPending ? (
        <span className="loading loading-spinner loading-sm" />
      ) : (
        rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Book</TableHead>
                <TableHead className="w-36">Counted</TableHead>
                <TableHead className="text-right">Difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const v = counted[r.variantId] ?? "";
                const diff =
                  v === ""
                    ? null
                    : Math.round((Number(v) - r.onHand) * 1000) / 1000;
                return (
                  <TableRow key={r.variantId}>
                    <TableCell>{stockLabel(r)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQty(r.onHand, r.unit)}
                    </TableCell>
                    <TableCell>
                      <QtyInput
                        min="0"
                        value={v}
                        onChange={(x) =>
                          setCounted((p) => ({ ...p, [r.variantId]: x }))
                        }
                      />
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${diff === null || diff === 0 ? "text-muted-foreground" : diff < 0 ? "text-error" : "text-success"}`}
                    >
                      {diff === null
                        ? ""
                        : diff === 0
                          ? "0"
                          : formatDelta(diff)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )
      )}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Found items not on the books</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setExtra((p) => [...p, emptyLine()])}
          >
            <PlusIcon /> Add item
          </Button>
        </div>
        {extra.map((l, i) => (
          <div
            key={i}
            className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[3fr_1fr_auto] sm:items-end"
          >
            <Field label="Item">
              <RefSelect
                source={invVariantsRef}
                value={l.variantId}
                onChange={(v) => updateExtra(i, { variantId: v })}
                filter={(r) => !rows.some((s) => s.variantId === r.id)}
              />
            </Field>
            <Field label="Counted">
              <QtyInput
                min="0"
                value={l.qty}
                onChange={(v) => updateExtra(i, { qty: v })}
              />
            </Field>
            <RemoveLine
              disabled={false}
              onClick={() => setExtra((p) => p.filter((_, j) => j !== i))}
            />
          </div>
        ))}
      </div>
      <Footer
        onCancel={onDone}
        busy={count.isPending}
        disabled={lines.length === 0}
        label={`Post count (${lines.length})`}
      />
    </form>
  );
}
