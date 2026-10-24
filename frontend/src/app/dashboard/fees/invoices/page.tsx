"use client";

import { useQuery } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RefLabel, RefSelect } from "@/components/crud/fields";
import {
  InvoiceTable,
  INVOICE_STATUSES,
  invoiceColumns,
} from "@/components/fee/invoice-table";
import { StudentPicker } from "@/components/fee/student-picker";
import { ErrorAlert, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { can, useMe } from "@/hooks/use-me";
import { api, type StudentListItem } from "@/lib/api";
import type { Invoice, InvoiceStatus } from "@/lib/api/services/fee";
import { formatMoney, humanize, toPaisa, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

const PAGE_SIZE = 50;

export default function InvoicesPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [status, setStatus] = useState<InvoiceStatus | "">("");
  const [period, setPeriod] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [familyId, setFamilyId] = useState("");
  const [campusId, setCampusId] = useState("");
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);

  const query = {
    limit: PAGE_SIZE,
    offset,
    ...(status ? { status } : {}),
    ...(period ? { period } : {}),
    ...(overdue ? { overdue: "true" as const } : {}),
    ...(student ? { studentId: student.id } : {}),
    ...(/^[0-9a-f-]{36}$/i.test(familyId.trim())
      ? { familyId: familyId.trim() }
      : {}),
    ...(campusId ? { campusId } : {}),
  };
  const list = useQuery({
    queryKey: ["fee.invoices", "list", query],
    queryFn: async () => (await api.fee.invoices.list(query)).data,
  });
  const hasMore = (list.data?.length ?? 0) === PAGE_SIZE;
  const reset = () => setOffset(0);

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Monthly and ad-hoc invoices. Click an invoice for its lines, payments and void."
        actions={
          can(me, "fee.invoice.create") && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New ad-hoc invoice
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <StudentPicker
                value={student}
                onChange={(s) => {
                  setStudent(s);
                  reset();
                }}
                placeholder="Filter by student"
              />
            </div>
            <Input
              placeholder="Family id"
              className="font-mono"
              value={familyId}
              onChange={(e) => {
                setFamilyId(e.target.value);
                reset();
              }}
            />
            <select
              aria-label="Status"
              className="select select-sm h-8 w-full"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as InvoiceStatus | "");
                reset();
              }}
            >
              <option value="">All statuses</option>
              {INVOICE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
            <Input
              type="month"
              aria-label="Billing period"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                reset();
              }}
            />
            <RefSelect
              source={refs.campuses}
              value={campusId}
              placeholder="All campuses"
              onChange={(v) => {
                setCampusId(v);
                reset();
              }}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={overdue}
                onChange={(e) => {
                  setOverdue(e.target.checked);
                  reset();
                }}
              />
              Overdue only
            </label>
          </div>

          <InvoiceTable
            rows={list.data}
            isPending={list.isPending}
            error={list.error}
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

          {(offset > 0 || hasMore) && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-sm text-muted-foreground">
                {offset + 1}–{offset + (list.data?.length ?? 0)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasMore}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
          {creating && (
            <AdhocInvoiceForm
              onClose={() => setCreating(false)}
              onCreated={(inv) =>
                router.push(`/dashboard/fees/invoices/${inv.id}`)
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface LineDraft {
  feeHeadId: string;
  description: string;
  amount: string;
}

function AdhocInvoiceForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (inv: Invoice) => void;
}) {
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [dueDate, setDueDate] = useState(todayISO());
  const [lines, setLines] = useState<LineDraft[]>([
    { feeHeadId: "", description: "", amount: "" },
  ]);
  /** stable per form: retrying after a network error replays instead of issuing twice */
  const [idem] = useState(() => crypto.randomUUID());
  const create = useAction(
    () =>
      api.fee.invoices.create(
        {
          studentId: student!.id,
          dueDate,
          lines: lines.map((l) => ({
            feeHeadId: l.feeHeadId,
            description: l.description.trim(),
            amountPaisa: toPaisa(l.amount),
          })),
        },
        { idempotencyKey: idem },
      ),
    {
      success: (r) => `Invoice ${r.data.invoiceNo} issued`,
      invalidate: [["fee.invoices"]],
      toastError: false,
      onSuccess: (r) => onCreated(r.data),
    },
  );
  const update = (i: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce(
    (s, l) => s + (Number(l.amount) > 0 ? toPaisa(l.amount) : 0),
    0,
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(undefined);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>New ad-hoc invoice</DialogTitle>
        <DialogDescription>
          Issued immediately to the student&apos;s family.
        </DialogDescription>
      </DialogHeader>
      {create.error && <ErrorAlert error={create.error} />}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div className="space-y-1.5">
          <Label>
            Student<span className="text-destructive">*</span>
          </Label>
          <StudentPicker value={student} onChange={setStudent} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-due">
            Due date<span className="text-destructive">*</span>
          </Label>
          <Input
            id="inv-due"
            type="date"
            required
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Lines</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={lines.length >= 20}
            onClick={() =>
              setLines((p) => [
                ...p,
                { feeHeadId: "", description: "", amount: "" },
              ])
            }
          >
            <PlusIcon /> Add line
          </Button>
        </div>
        {lines.map((l, i) => (
          <div
            key={i}
            className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr_auto] sm:items-center"
          >
            <RefSelect
              source={refs.feeHeads}
              value={l.feeHeadId}
              required
              placeholder="Fee head"
              onChange={(v) => update(i, { feeHeadId: v })}
            />
            <Input
              placeholder="Description"
              required
              value={l.description}
              onChange={(e) => update(i, { description: e.target.value })}
            />
            <Input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="Amount ৳"
              required
              value={l.amount}
              onChange={(e) => update(i, { amount: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove line"
              disabled={lines.length === 1}
              onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
            >
              <Trash2Icon className="text-destructive" />
            </Button>
          </div>
        ))}
        <p className="text-right text-sm">
          Total{" "}
          <span className="font-medium tabular-nums">{formatMoney(total)}</span>
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!student || create.isPending}>
          {create.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Issue invoice
        </Button>
      </DialogFooter>
    </form>
  );
}
