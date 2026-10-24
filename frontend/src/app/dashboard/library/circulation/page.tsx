"use client";

import { ArrowDownToLineIcon, ArrowUpFromLineIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { BorrowerPicker, borrowerHref } from "@/components/lib/shared";
import { PageHeader } from "@/components/page";
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
import { useAction } from "@/hooks/use-action";
import { api } from "@/lib/api";
import type {
  BorrowerType,
  IssueResult,
  ReturnCondition,
  ReturnResult,
} from "@/lib/api/services/lib";
import { formatDate, formatMoney, humanize, toPaisa } from "@/lib/format";

const INVALIDATE = [
  ["lib.loans"],
  ["lib.catalogue"],
  ["lib.title"],
  ["lib.copies"],
  ["lib.reservations"],
];

export default function CirculationPage() {
  return (
    <>
      <PageHeader
        title="Issue / return"
        description="Scan the barcode and press Enter. Each scan is sent once (idempotent), so a double scan never issues twice."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <IssueCard />
        <ReturnCard />
      </div>
    </>
  );
}

function IssueCard() {
  const [type, setType] = useState<BorrowerType>("student");
  const [borrower, setBorrower] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [barcode, setBarcode] = useState("");
  const [result, setResult] = useState<IssueResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const issue = useAction(
    (b: { barcode: string; borrowerId: string; borrowerType: BorrowerType }) =>
      api.lib.circulation.issue(b, { idempotencyKey: crypto.randomUUID() }),
    {
      success: (r) =>
        `Issued "${r.data.title}" — due ${formatDate(r.data.dueOn)}`,
      invalidate: INVALIDATE,
      onSuccess: (r) => {
        setResult(r.data);
        setBarcode("");
        input.current?.focus();
      },
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!borrower || !barcode.trim()) return;
    issue.mutate({
      barcode: barcode.trim(),
      borrowerType: type,
      borrowerId: borrower.id,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowUpFromLineIcon className="size-5" /> Issue
        </CardTitle>
        <CardDescription>
          Pick the reader, then scan each book. Loan limits come from the member
          policy.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Reader</Label>
            <BorrowerPicker
              type={type}
              onTypeChange={setType}
              value={borrower}
              onChange={(b) => {
                setBorrower(b);
                setResult(null);
                if (b) setTimeout(() => input.current?.focus(), 0);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="issue-barcode">Barcode</Label>
            <Input
              id="issue-barcode"
              ref={input}
              autoComplete="off"
              className="font-mono"
              placeholder={borrower ? "Scan barcode…" : "Pick a reader first"}
              disabled={!borrower}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={!borrower || !barcode.trim() || issue.isPending}
          >
            {issue.isPending && (
              <span className="loading loading-spinner loading-xs" />
            )}
            Issue
          </Button>
        </form>
        {result && (
          <div
            role="status"
            className="alert alert-success alert-soft mt-4 flex-col items-start gap-1 text-sm"
          >
            <div className="font-semibold">
              {result.title}{" "}
              <span className="font-mono text-xs">({result.accessionNo})</span>
            </div>
            <div>
              To{" "}
              <Link
                className="link"
                href={borrowerHref(result.borrower.type, result.borrower.id)}
              >
                {result.borrower.name}
              </Link>{" "}
              ({humanize(result.borrower.memberType)})
            </div>
            <div className="text-base font-semibold">
              Due {formatDate(result.dueOn)}
            </div>
            <div>
              {result.activeLoans} of {result.maxLoans} books on loan
              {result.reservationFulfilled && " · reservation fulfilled"}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReturnCard() {
  const [barcode, setBarcode] = useState("");
  const [condition, setCondition] = useState<ReturnCondition>("good");
  const [damage, setDamage] = useState("");
  const [waive, setWaive] = useState(false);
  const [result, setResult] = useState<ReturnResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ret = useAction(
    (b: Parameters<typeof api.lib.circulation.return>[0]) =>
      api.lib.circulation.return(b, { idempotencyKey: crypto.randomUUID() }),
    {
      success: (r) => `Returned "${r.data.title}"`,
      invalidate: INVALIDATE,
      onSuccess: (r) => {
        setResult(r.data);
        setBarcode("");
        setCondition("good");
        setDamage("");
        setWaive(false);
        input.current?.focus();
      },
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!barcode.trim()) return;
    ret.mutate({
      barcode: barcode.trim(),
      condition,
      ...(condition === "damaged" && damage
        ? { damageFinePaisa: toPaisa(damage) }
        : {}),
      ...(waive ? { waiveFine: true } : {}),
    });
  }

  const fine = result?.fine;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowDownToLineIcon className="size-5" /> Return
        </CardTitle>
        <CardDescription>
          A student&apos;s fine is billed to the family through Fees; a staff
          fine is recorded on the loan.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="return-barcode">Barcode</Label>
            <Input
              id="return-barcode"
              ref={input}
              autoFocus
              autoComplete="off"
              className="font-mono"
              placeholder="Scan barcode…"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="return-condition">Condition</Label>
              <select
                id="return-condition"
                className="select select-sm h-8 w-full"
                value={condition}
                onChange={(e) =>
                  setCondition(e.target.value as ReturnCondition)
                }
              >
                <option value="good">Good</option>
                <option value="damaged">Damaged</option>
                <option value="lost">Lost (replacement charged)</option>
              </select>
            </div>
            {condition === "damaged" && (
              <div className="space-y-1.5">
                <Label htmlFor="return-damage">
                  Damage fine{" "}
                  <span className="text-xs text-muted-foreground">(৳)</span>
                </Label>
                <Input
                  id="return-damage"
                  type="number"
                  step="0.01"
                  min="0"
                  value={damage}
                  onChange={(e) => setDamage(e.target.value)}
                />
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={waive}
              onChange={(e) => setWaive(e.target.checked)}
            />
            Waive the fine
          </label>
          <Button
            type="submit"
            className="w-full"
            disabled={!barcode.trim() || ret.isPending}
          >
            {ret.isPending && (
              <span className="loading loading-spinner loading-xs" />
            )}
            Return
          </Button>
        </form>
        {result && fine && (
          <div
            role="status"
            className={`alert alert-soft mt-4 flex-col items-start gap-1 text-sm ${fine.totalPaisa > 0 && !fine.waived ? "alert-warning" : "alert-success"}`}
          >
            <div className="font-semibold">
              {result.title}{" "}
              <span className="font-mono text-xs">({result.accessionNo})</span>
            </div>
            <div>
              From{" "}
              <Link
                className="link"
                href={borrowerHref(result.borrower.type, result.borrower.id)}
              >
                {result.borrower.name}
              </Link>
              {result.overdueDays > 0 && ` · ${result.overdueDays} days late`}
            </div>
            <div className="text-base font-semibold">
              Fine {formatMoney(fine.totalPaisa)}
              {fine.waived && " (waived)"}
            </div>
            {fine.totalPaisa > 0 && (
              <div className="text-xs">
                Overdue {formatMoney(fine.overduePaisa)} · Replacement{" "}
                {formatMoney(fine.replacementPaisa)} · Damage{" "}
                {formatMoney(fine.damagePaisa)}
              </div>
            )}
            {result.feeInvoiceNo && (
              <div>Billed on invoice {result.feeInvoiceNo}</div>
            )}
            <div>
              Copy is now {humanize(result.copyStatus)}
              {result.heldForReservation && " — held for the next reservation"}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
