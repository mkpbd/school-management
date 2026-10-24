"use client";

import { useQuery } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon, WandSparklesIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { RefSelect } from "@/components/crud/fields";
import { invVariantsRef } from "@/components/inv/shared";
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
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type {
  BudgetOverrun,
  PoRow,
  RankedQuotation,
  RequisitionDetail,
  RequisitionRow,
} from "@/lib/api/services/acc-procurement";
import { formatMoney, toPaisa, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";
import {
  costCentresRef,
  expenseAccountsRef,
  Field,
  lineAmount,
  OverrunTable,
  overrunsOf,
} from "./procurement";

type RequisitionCreate = Parameters<typeof api.acc.requisitions.create>[0];
type PoIssue = Parameters<typeof api.acc.requisitions.issuePurchaseOrder>[1];

export const REQUISITION_INVALIDATE = [
  ["acc.requisitions"],
  ["acc.requisition"],
];

interface LineDraft {
  description: string;
  qty: string;
  /** unit price in taka */
  price: string;
  accountId: string;
  itemVariantId: string;
}

const emptyLine = (): LineDraft => ({
  description: "",
  qty: "1",
  price: "",
  accountId: "",
  itemVariantId: "",
});
const draftAmount = (l: LineDraft) =>
  lineAmount(Number(l.qty) || 0, toPaisa(l.price || 0));

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="alert alert-error alert-soft text-sm">
      {message}
    </div>
  );
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** Purchase lines editor: description, quantity, unit price, expense account, optional stock item. */
function LinesEditor({
  lines,
  onChange,
  priceLabel,
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  priceLabel: string;
}) {
  // labels of stock items, to fill an empty description
  const variants = useQuery({
    queryKey: ["ref", invVariantsRef.key],
    queryFn: invVariantsRef.load,
    staleTime: 60_000,
  });
  const update = (i: number, patch: Partial<LineDraft>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + draftAmount(l), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Lines</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...lines, emptyLine()])}
        >
          <PlusIcon /> Add line
        </Button>
      </div>
      {lines.map((l, i) => (
        <div
          key={i}
          className="grid gap-2 rounded-lg border p-3 sm:grid-cols-6 sm:items-end"
        >
          <Field label="Description" required className="sm:col-span-3">
            <Input
              required
              minLength={2}
              maxLength={500}
              value={l.description}
              onChange={(e) => update(i, { description: e.target.value })}
            />
          </Field>
          <Field label="Quantity" required>
            <Input
              type="number"
              step="0.001"
              min="0.001"
              max="1000000"
              required
              value={l.qty}
              onChange={(e) => update(i, { qty: e.target.value })}
            />
          </Field>
          <Field label={priceLabel} required>
            <Input
              type="number"
              step="0.01"
              min="0"
              required
              value={l.price}
              onChange={(e) => update(i, { price: e.target.value })}
            />
          </Field>
          <div className="pb-1.5 text-right text-sm tabular-nums text-muted-foreground">
            {formatMoney(draftAmount(l))}
          </div>
          <Field label="Expense account" required className="sm:col-span-3">
            <RefSelect
              source={expenseAccountsRef}
              value={l.accountId}
              required
              onChange={(v) => update(i, { accountId: v })}
            />
          </Field>
          <Field label="Stock item" className="sm:col-span-2">
            <RefSelect
              source={invVariantsRef}
              value={l.itemVariantId}
              placeholder="Not a stock item"
              onChange={(v) => {
                const label = variants.data?.find((r) => r.id === v)?.label;
                update(i, {
                  itemVariantId: v,
                  ...(!l.description.trim() && label
                    ? { description: String(label) }
                    : {}),
                });
              }}
            />
          </Field>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove line"
              disabled={lines.length === 1}
              onClick={() => onChange(lines.filter((_, j) => j !== i))}
            >
              <Trash2Icon className="text-destructive" />
            </Button>
          </div>
        </div>
      ))}
      <div className="text-right text-sm">
        Total{" "}
        <span className="font-medium tabular-nums">{formatMoney(total)}</span>
      </div>
    </div>
  );
}

// ---- new requisition ----

export function RequisitionCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (r: RequisitionRow) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
        {open && (
          <RequisitionForm
            onDone={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RequisitionForm({
  onDone,
  onCreated,
}: {
  onDone: () => void;
  onCreated: (r: RequisitionRow) => void;
}) {
  const [title, setTitle] = useState("");
  const [costCentreId, setCostCentreId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [justification, setJustification] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [submitNow, setSubmitNow] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const create = useAction(
    (body: RequisitionCreate) => api.acc.requisitions.create(body),
    {
      success: (r) =>
        `${r.data.prNo} ${r.data.status === "submitted" ? "submitted for approval" : "saved as draft"}`,
      invalidate: [["acc.requisitions"]],
      toastError: false,
      onSuccess: (r) => {
        onDone();
        onCreated(r.data);
      },
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate(
      {
        title: title.trim(),
        costCentreId,
        ...(departmentId ? { departmentId } : {}),
        ...(neededBy ? { neededBy } : {}),
        ...(justification.trim()
          ? { justification: justification.trim() }
          : {}),
        lines: lines.map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.qty),
          estUnitPaisa: toPaisa(l.price),
          accountId: l.accountId,
          ...(l.itemVariantId ? { itemVariantId: l.itemVariantId } : {}),
        })),
        submit: submitNow,
      },
      { onError: (err) => setError(errorText(err)) },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>New purchase requisition</DialogTitle>
        <DialogDescription>
          What to buy, for which cost centre (budget line) and expense account.
          An approver checks it against the budget.
        </DialogDescription>
      </DialogHeader>
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required className="sm:col-span-2">
          <Input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Science lab consumables, term 2"
          />
        </Field>
        <Field label="Cost centre" required>
          <RefSelect
            source={costCentresRef}
            value={costCentreId}
            required
            onChange={setCostCentreId}
            filter={(r) => r.isActive !== false}
          />
        </Field>
        <Field label="Department">
          <RefSelect
            source={refs.departments}
            value={departmentId}
            placeholder="—"
            onChange={setDepartmentId}
          />
        </Field>
        <Field label="Needed by">
          <Input
            type="date"
            min={todayISO()}
            value={neededBy}
            onChange={(e) => setNeededBy(e.target.value)}
          />
        </Field>
        <Field label="Justification" className="sm:col-span-2">
          <Textarea
            rows={2}
            maxLength={2000}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
        </Field>
      </div>
      <LinesEditor
        lines={lines}
        onChange={setLines}
        priceLabel="Est. unit price (৳)"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          checked={submitNow}
          onChange={(e) => setSubmitNow(e.target.checked)}
        />
        Submit for approval now (otherwise saved as a draft)
      </label>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          {submitNow ? "Submit requisition" : "Save draft"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---- approve / reject ----

export function DecideDialog({
  requisition,
  decision,
  onOpenChange,
}: {
  requisition: RequisitionDetail;
  decision: "approved" | "rejected" | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={decision !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {decision && (
          <DecideForm
            requisition={requisition}
            decision={decision}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DecideForm({
  requisition,
  decision,
  onDone,
}: {
  requisition: RequisitionDetail;
  decision: "approved" | "rejected";
  onDone: () => void;
}) {
  const { data: me } = useMe();
  const [note, setNote] = useState("");
  const [overrunReason, setOverrunReason] = useState("");
  const [overruns, setOverruns] = useState<BudgetOverrun[]>(
    requisition.budgetCheck?.overruns ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const canOverrun = can(me, "acc.budget.approve");
  const approving = decision === "approved";
  const overBudget = approving && overruns.length > 0;

  const decide = useAction(
    () =>
      api.acc.requisitions.decide(requisition.id, {
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(overBudget && overrunReason.trim()
          ? { overrunReason: overrunReason.trim() }
          : {}),
      }),
    {
      success: (r) =>
        approving
          ? `${r.data.prNo} approved${r.data.overruns.length ? " beyond the budget" : ""}`
          : `${r.data.prNo} rejected`,
      invalidate: REQUISITION_INVALIDATE,
      toastError: false,
      onSuccess: onDone,
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    decide.mutate(undefined, {
      onError: (err) => {
        const o = overrunsOf(err);
        if (o) setOverruns(o);
        setError(errorText(err));
      },
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>
          {approving ? "Approve" : "Reject"} {requisition.prNo}
        </DialogTitle>
        <DialogDescription>
          {approving
            ? `Estimated ${formatMoney(requisition.estimatedPaisa)}. After approval procurement collects quotations.`
            : "The requester can correct it and submit again."}
        </DialogDescription>
      </DialogHeader>
      <FormError message={error} />
      {overBudget && (
        <div className="space-y-2">
          <div
            role="alert"
            className="alert alert-warning alert-soft block text-sm"
          >
            <p className="font-medium">Beyond the budget</p>
            <p>
              {canOverrun
                ? "Approving needs a written overrun reason (recorded with your name)."
                : "Only someone who can approve budgets (acc.budget.approve) can approve spending beyond the budget. You can still reject it."}
            </p>
          </div>
          <OverrunTable overruns={overruns} />
        </div>
      )}
      <Field label="Note">
        <Textarea
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {overBudget && canOverrun && (
        <Field label="Overrun reason" required help="At least 5 characters">
          <Textarea
            rows={3}
            required
            minLength={5}
            maxLength={1000}
            value={overrunReason}
            onChange={(e) => setOverrunReason(e.target.value)}
          />
        </Field>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant={approving ? "default" : "destructive"}
          disabled={decide.isPending || (overBudget && !canOverrun)}
        >
          {decide.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          {approving
            ? overBudget
              ? "Approve beyond budget"
              : "Approve"
            : "Reject"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---- choose a quotation ----

export function SelectQuotationDialog({
  requisition,
  quotation,
  onOpenChange,
}: {
  requisition: RequisitionDetail;
  quotation: RankedQuotation | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={quotation !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {quotation && (
          <SelectForm
            requisition={requisition}
            quotation={quotation}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SelectForm({
  requisition,
  quotation,
  onDone,
}: {
  requisition: RequisitionDetail;
  quotation: RankedQuotation;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const valid = requisition.quotations.filter((q) => !q.expired).length;
  const tooFew = valid < requisition.quotationsRequired;
  const needsReason = tooFew || !quotation.lowest;

  const select = useAction(
    () =>
      api.acc.requisitions.selectQuotation(
        requisition.id,
        quotation.id,
        reason.trim() ? { reason: reason.trim() } : {},
      ),
    {
      success: `${quotation.vendorName} selected`,
      invalidate: REQUISITION_INVALIDATE,
      toastError: false,
      onSuccess: onDone,
    },
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        select.mutate(undefined, {
          onError: (err) => setError(errorText(err)),
        });
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Select {quotation.vendorName}</DialogTitle>
        <DialogDescription>
          {formatMoney(quotation.totalPaisa)}
          {quotation.lowest
            ? " — the lowest valid quotation."
            : ` — ${formatMoney(quotation.aboveLowestPaisa ?? 0)} above the lowest.`}
        </DialogDescription>
      </DialogHeader>
      <FormError message={error} />
      {needsReason && (
        <div
          role="alert"
          className="alert alert-warning alert-soft block text-sm"
        >
          {tooFew && (
            <p>
              {requisition.quotationsRequired} valid quotations are required,
              there {valid === 1 ? "is" : "are"} {valid}. Give a single-source
              reason to proceed.
            </p>
          )}
          {!quotation.lowest && (
            <p>
              This is not the lowest quotation: give the reason for choosing it.
            </p>
          )}
        </div>
      )}
      <Field label="Reason" required={needsReason}>
        <Textarea
          rows={3}
          maxLength={1000}
          required={needsReason}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={select.isPending}>
          {select.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Select quotation
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---- issue the purchase order ----

export function IssuePoDialog({
  requisition,
  open,
  onOpenChange,
  onIssued,
}: {
  requisition: RequisitionDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIssued: (po: PoRow) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
        {open && (
          <IssuePoForm
            requisition={requisition}
            onDone={() => onOpenChange(false)}
            onIssued={onIssued}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Unit prices scaled to the quoted total (rounded to paisa); a remaining paisa difference goes to the first line
 * where it divides evenly (e.g. quantity 1).
 */
function fitToQuote(lines: LineDraft[], quotePaisa: number): LineDraft[] {
  const units = lines.map((l) => toPaisa(l.price || 0));
  const qtys = lines.map((l) => Number(l.qty) || 0);
  const current = units.reduce((s, u, i) => s + lineAmount(qtys[i]!, u), 0);
  let next =
    current > 0
      ? units.map((u) => Math.round((u * quotePaisa) / current))
      : units.map((_, i) =>
          i === 0 && qtys[0] ? Math.round(quotePaisa / qtys[0]) : 0,
        );
  const diff =
    quotePaisa - next.reduce((s, u, i) => s + lineAmount(qtys[i]!, u), 0);
  if (diff !== 0) {
    const j = qtys.findIndex(
      (q, i) => q > 0 && Number.isInteger(diff / q) && next[i]! + diff / q >= 0,
    );
    if (j >= 0) next = next.map((u, i) => (i === j ? u + diff / qtys[j]! : u));
  }
  return lines.map((l, i) => ({ ...l, price: (next[i]! / 100).toFixed(2) }));
}

function IssuePoForm({
  requisition,
  onDone,
  onIssued,
}: {
  requisition: RequisitionDetail;
  onDone: () => void;
  onIssued: (po: PoRow) => void;
}) {
  const selected = requisition.quotations.find((q) => q.isSelected)!;
  const [orderDate, setOrderDate] = useState(todayISO());
  const [expectedOn, setExpectedOn] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    fitToQuote(
      (requisition.lines ?? []).map((l) => ({
        description: l.description,
        qty: String(l.quantity),
        price: ((l.estUnitPaisa ?? 0) / 100).toFixed(2),
        accountId: l.accountId ?? "",
        itemVariantId: l.itemVariantId ?? "",
      })),
      selected.totalPaisa,
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [overruns, setOverruns] = useState<BudgetOverrun[] | null>(null);
  const total = lines.reduce((s, l) => s + draftAmount(l), 0);
  const diff = total - selected.totalPaisa;

  const issue = useAction(
    (body: PoIssue) =>
      api.acc.requisitions.issuePurchaseOrder(requisition.id, body),
    {
      success: (r) => `${r.data.poNo} issued to ${r.data.vendorName}`,
      invalidate: [...REQUISITION_INVALIDATE, ["acc.purchaseOrders"]],
      toastError: false,
      onSuccess: (r) => {
        onDone();
        onIssued(r.data);
      },
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOverruns(null);
    issue.mutate(
      {
        ...(orderDate ? { orderDate } : {}),
        ...(expectedOn ? { expectedOn } : {}),
        ...(terms.trim() ? { terms: terms.trim() } : {}),
        lines: lines.map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.qty),
          unitPaisa: toPaisa(l.price),
          accountId: l.accountId,
          ...(l.itemVariantId ? { itemVariantId: l.itemVariantId } : {}),
        })),
      },
      {
        onError: (err) => {
          setOverruns(overrunsOf(err));
          setError(errorText(err));
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Issue purchase order — {selected.vendorName}</DialogTitle>
        <DialogDescription>
          The order total must equal the selected quotation (
          {formatMoney(selected.totalPaisa)}) and still fit the budget.
        </DialogDescription>
      </DialogHeader>
      <FormError message={error} />
      {overruns && overruns.length > 0 && <OverrunTable overruns={overruns} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Order date">
          <Input
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
          />
        </Field>
        <Field
          label="Expected delivery"
          help="Receipts after this date count as late"
        >
          <Input
            type="date"
            min={orderDate || undefined}
            value={expectedOn}
            onChange={(e) => setExpectedOn(e.target.value)}
          />
        </Field>
        <Field label="Terms" className="sm:col-span-3">
          <Textarea
            rows={2}
            maxLength={2000}
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder="Delivery to the central store; payment 30 days after the bill"
          />
        </Field>
      </div>
      <LinesEditor
        lines={lines}
        onChange={setLines}
        priceLabel="Unit price (৳)"
      />
      <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
        <span>
          Quotation{" "}
          <span className="font-medium tabular-nums">
            {formatMoney(selected.totalPaisa)}
          </span>
        </span>
        {diff !== 0 ? (
          <span className="text-destructive">
            {diff > 0 ? "Over" : "Short"} by{" "}
            <span className="tabular-nums">{formatMoney(Math.abs(diff))}</span>
          </span>
        ) : (
          <span className="text-success">Matches the quotation</span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setLines((p) => fitToQuote(p, selected.totalPaisa))}
        >
          <WandSparklesIcon /> Fit prices to quotation
        </Button>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={issue.isPending || diff !== 0}>
          {issue.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Issue purchase order
        </Button>
      </DialogFooter>
    </form>
  );
}
