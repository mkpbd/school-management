"use client";

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
import { useAction } from "@/hooks/use-action";
import { api } from "@/lib/api";
import type {
  JournalRow,
  VoucherType,
} from "@/lib/api/services/acc-accounting";
import { formatMoney, humanize, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";
import { accountCodesRef, takaToPaisa, VOUCHER_TYPES } from "./accounting";

interface LineDraft {
  accountCode: string;
  /** taka */
  debit: string;
  credit: string;
  memo: string;
}

const emptyLine = (): LineDraft => ({
  accountCode: "",
  debit: "",
  credit: "",
  memo: "",
});

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

/** Manual voucher with a balanced debit / credit lines editor. */
export function VoucherDialog({
  open,
  onOpenChange,
  onPosted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPosted: (journal: JournalRow) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-5xl">
        {open && (
          <VoucherForm
            onCancel={() => onOpenChange(false)}
            onPosted={(j) => {
              onOpenChange(false);
              onPosted(j);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function VoucherForm({
  onCancel,
  onPosted,
}: {
  onCancel: () => void;
  onPosted: (j: JournalRow) => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [campusId, setCampusId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [voucherType, setVoucherType] = useState<VoucherType>("journal");
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const update = (i: number, patch: Partial<LineDraft>) =>
    setLines((p) => p.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const amounts = lines.map((l) => ({
    debit: takaToPaisa(l.debit),
    credit: takaToPaisa(l.credit),
  }));
  const debit = amounts.reduce((s, a) => s + (a.debit || 0), 0);
  const credit = amounts.reduce((s, a) => s + (a.credit || 0), 0);
  const diff = debit - credit;
  const balanced = debit > 0 && diff === 0;

  const post = useAction(
    () =>
      api.acc.journals.create(
        {
          ...(campusId ? { campusId } : {}),
          date,
          voucherType,
          narration: narration.trim(),
          lines: lines.map((l, i) => ({
            accountCode: l.accountCode,
            debitPaisa: amounts[i].debit,
            creditPaisa: amounts[i].credit,
            ...(l.memo.trim() ? { memo: l.memo.trim() } : {}),
          })),
        },
        { idempotencyKey },
      ),
    {
      success: (r) => `Journal ${r.data.journalNo} posted`,
      invalidate: [
        ["acc.journals"],
        ["acc.trialBalance"],
        ["acc.ledger"],
        ["acc.periods"],
      ],
      toastError: false,
      onSuccess: (r) => onPosted(r.data),
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    for (const [i, a] of amounts.entries()) {
      if (
        Number.isNaN(a.debit) ||
        Number.isNaN(a.credit) ||
        a.debit < 0 ||
        a.credit < 0
      )
        return setError(`Line ${i + 1}: amounts must be positive numbers.`);
      if (a.debit > 0 === a.credit > 0)
        return setError(`Line ${i + 1}: enter either a debit or a credit.`);
    }
    if (!balanced) return setError("Debits and credits must be equal.");
    post.mutate(undefined, {
      onError: (err) =>
        setError(err instanceof Error ? err.message : "Something went wrong."),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>New voucher</DialogTitle>
        <DialogDescription>
          A manual journal. Total debits must equal total credits; the fiscal
          period of the date must not be locked. Posted vouchers cannot be
          edited — reverse them instead.
        </DialogDescription>
      </DialogHeader>
      {error && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {error}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date" required>
          <Input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Voucher type" required>
          <select
            className="select select-sm h-8 w-full"
            value={voucherType}
            onChange={(e) => setVoucherType(e.target.value as VoucherType)}
          >
            {VOUCHER_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Campus">
          <RefSelect
            source={refs.campuses}
            value={campusId}
            placeholder="Active campus"
            onChange={setCampusId}
          />
        </Field>
        <Field label="Narration" required className="sm:col-span-3">
          <Input
            required
            minLength={3}
            maxLength={300}
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
          />
        </Field>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Lines</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={lines.length >= 100}
            onClick={() => setLines((p) => [...p, emptyLine()])}
          >
            <PlusIcon /> Add line
          </Button>
        </div>
        {lines.map((l, i) => (
          <div
            key={i}
            className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[3fr_1fr_1fr_2fr_auto] sm:items-end"
          >
            <Field label="Account">
              <RefSelect
                source={accountCodesRef}
                value={l.accountCode}
                required
                onChange={(v) => update(i, { accountCode: v })}
              />
            </Field>
            <Field label="Debit (৳)">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={l.debit}
                onChange={(e) =>
                  update(i, {
                    debit: e.target.value,
                    ...(e.target.value ? { credit: "" } : {}),
                  })
                }
              />
            </Field>
            <Field label="Credit (৳)">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={l.credit}
                onChange={(e) =>
                  update(i, {
                    credit: e.target.value,
                    ...(e.target.value ? { debit: "" } : {}),
                  })
                }
              />
            </Field>
            <Field label="Memo">
              <Input
                maxLength={200}
                value={l.memo}
                onChange={(e) => update(i, { memo: e.target.value })}
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove line"
              disabled={lines.length <= 2}
              onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
            >
              <Trash2Icon className="text-destructive" />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 text-sm">
          <span>
            Debit{" "}
            <span className="font-medium tabular-nums">
              {formatMoney(debit)}
            </span>
          </span>
          <span>
            Credit{" "}
            <span className="font-medium tabular-nums">
              {formatMoney(credit)}
            </span>
          </span>
          {balanced ? (
            <span className="badge badge-soft badge-success badge-sm">
              Balanced
            </span>
          ) : (
            <span className="badge badge-soft badge-warning badge-sm">
              {diff === 0
                ? "Enter amounts"
                : `Difference ${formatMoney(Math.abs(diff))} ${diff > 0 ? "Dr" : "Cr"}`}
            </span>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={post.isPending || !balanced}>
          {post.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Post voucher
        </Button>
      </DialogFooter>
    </form>
  );
}
