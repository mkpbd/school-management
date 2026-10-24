"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { RefSelect } from "@/components/crud/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Body } from "@/lib/api";
import type { BudgetLineView } from "@/lib/api/services/acc-accounting";
import { formatMoney } from "@/lib/format";
import {
  activeCostCentresRef,
  budgetAccountsRef,
  MONTHS,
  paisaToTaka,
  takaToPaisa,
} from "./accounting";

/** Budget line as the API takes it: annualPaisa (spread evenly) or 12 months. */
export type BudgetLineInput = Body<
  "/api/v1/acc/budgets/{id}/lines",
  "put"
>["lines"][number];

export interface BudgetLineDraft {
  accountId: string;
  costCentreId: string;
  mode: "annual" | "monthly";
  /** taka */
  annual: string;
  /** taka, January first */
  months: string[];
}

export const emptyBudgetLine = (): BudgetLineDraft => ({
  accountId: "",
  costCentreId: "",
  mode: "annual",
  annual: "",
  months: Array.from({ length: 12 }, () => ""),
});

/** Same split as the backend: floor(annual / 12) per month, the remainder in December. */
function spreadAnnual(annualPaisa: number): number[] {
  const base = Math.floor(annualPaisa / 12);
  const months = Array.from({ length: 12 }, () => base);
  months[11] = annualPaisa - base * 11;
  return months;
}

/** Saved lines -> editor rows (an even spread shows as an annual amount). */
export function toBudgetDrafts(lines: BudgetLineView[]): BudgetLineDraft[] {
  return lines.map((l) => {
    const even = spreadAnnual(l.annualPaisa).every((m, i) => m === l.months[i]);
    return {
      accountId: l.accountId,
      costCentreId: l.costCentreId ?? "",
      mode: even ? "annual" : "monthly",
      annual: paisaToTaka(l.annualPaisa),
      months: l.months.map(paisaToTaka),
    };
  });
}

function draftMonths(d: BudgetLineDraft): number[] {
  return d.mode === "annual"
    ? spreadAnnual(takaToPaisa(d.annual) || 0)
    : d.months.map((m) => takaToPaisa(m));
}

export function draftAnnual(d: BudgetLineDraft): number {
  return d.mode === "annual"
    ? takaToPaisa(d.annual)
    : d.months.reduce((s, m) => s + (takaToPaisa(m) || 0), 0);
}

/** Editor rows -> API lines, or the first problem found. */
export function toBudgetInputs(
  drafts: BudgetLineDraft[],
): { lines: BudgetLineInput[]; error?: undefined } | { error: string } {
  const seen = new Set<string>();
  const lines: BudgetLineInput[] = [];
  for (const [i, d] of drafts.entries()) {
    const n = `Line ${i + 1}`;
    if (!d.accountId) return { error: `${n}: choose an account.` };
    const key = `${d.accountId}|${d.costCentreId}`;
    if (seen.has(key))
      return {
        error: `${n}: the account appears twice for the same cost centre.`,
      };
    seen.add(key);
    const costCentreId = d.costCentreId || null;
    if (d.mode === "annual") {
      const annualPaisa = takaToPaisa(d.annual);
      if (!Number.isFinite(annualPaisa) || annualPaisa < 0)
        return { error: `${n}: enter a valid annual amount.` };
      lines.push({ accountId: d.accountId, costCentreId, annualPaisa });
    } else {
      const months = d.months.map((m) => takaToPaisa(m));
      if (months.some((m) => !Number.isFinite(m) || m < 0))
        return { error: `${n}: monthly amounts must be positive numbers.` };
      lines.push({ accountId: d.accountId, costCentreId, months });
    }
  }
  return { lines };
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** Lines per account x cost centre: an annual amount spread evenly, or 12 monthly amounts. */
export function BudgetLinesEditor({
  lines,
  onChange,
}: {
  lines: BudgetLineDraft[];
  onChange: (lines: BudgetLineDraft[]) => void;
}) {
  const update = (i: number, patch: Partial<BudgetLineDraft>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (draftAnnual(l) || 0), 0);

  function setMode(i: number, mode: BudgetLineDraft["mode"]) {
    const l = lines[i];
    if (mode === "monthly")
      update(i, {
        mode,
        months: draftMonths(l).map((m) =>
          Number.isFinite(m) ? paisaToTaka(m) : "",
        ),
      });
    else update(i, { mode, annual: paisaToTaka(draftAnnual(l) || 0) });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Lines</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...lines, emptyBudgetLine()])}
        >
          <PlusIcon /> Add line
        </Button>
      </div>
      {lines.length === 0 && (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No lines yet. Add one per income / expense account and cost centre.
        </p>
      )}
      {lines.map((l, i) => (
        <div key={i} className="space-y-3 rounded-lg border p-3">
          <div className="grid gap-2 sm:grid-cols-[3fr_2fr_auto_2fr_auto] sm:items-end">
            <Field label="Account">
              <RefSelect
                source={budgetAccountsRef}
                value={l.accountId}
                required
                onChange={(v) => update(i, { accountId: v })}
              />
            </Field>
            <Field label="Cost centre">
              <RefSelect
                source={activeCostCentresRef}
                value={l.costCentreId}
                placeholder="None (whole campus)"
                onChange={(v) => update(i, { costCentreId: v })}
              />
            </Field>
            <Field label="Amounts">
              <div className="join">
                <button
                  type="button"
                  className={`btn join-item btn-sm ${l.mode === "annual" ? "btn-active" : ""}`}
                  onClick={() => setMode(i, "annual")}
                >
                  Annual
                </button>
                <button
                  type="button"
                  className={`btn join-item btn-sm ${l.mode === "monthly" ? "btn-active" : ""}`}
                  onClick={() => setMode(i, "monthly")}
                >
                  12 months
                </button>
              </div>
            </Field>
            {l.mode === "annual" ? (
              <Field label="Annual amount (৳)">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={l.annual}
                  onChange={(e) => update(i, { annual: e.target.value })}
                />
              </Field>
            ) : (
              <div className="pb-1.5 text-sm">
                Year{" "}
                <span className="font-medium tabular-nums">
                  {formatMoney(draftAnnual(l) || 0)}
                </span>
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove line"
              onClick={() => onChange(lines.filter((_, j) => j !== i))}
            >
              <Trash2Icon className="text-destructive" />
            </Button>
          </div>
          {l.mode === "monthly" && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
              {MONTHS.map((m, k) => (
                <Field key={m} label={m}>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    className="px-1.5"
                    value={l.months[k]}
                    onChange={(e) =>
                      update(i, {
                        months: l.months.map((x, j) =>
                          j === k ? e.target.value : x,
                        ),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="text-right text-sm">
        Total{" "}
        <span className="font-medium tabular-nums">{formatMoney(total)}</span>
      </div>
    </div>
  );
}
