"use client";

import { useQuery } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { RefLabel } from "@/components/crud/fields";
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
import { api, isApiError } from "@/lib/api";
import { formatMoney, humanize, toPaisa } from "@/lib/format";
import { refs } from "@/lib/refs";

// ---- response shapes (backend/src/modules/hrm/application/payrollPorts.ts, domain/tax.ts) ----

export type ComponentKind = "earning" | "deduction" | "employer_contribution";
export type ComponentCalc = "fixed" | "percent_of_basic" | "per_unit";

export interface SalaryComponentRow {
  [key: string]: unknown;
  id: string;
  code: string;
  nameEn: string;
  kind: ComponentKind;
  calc: ComponentCalc;
  taxable: boolean;
  seq: number;
}

export interface ContractView {
  [key: string]: unknown;
  id: string;
  staffId: string;
  contractType: string;
  startsOn: string;
  endsOn: string | null;
  probationEndsOn: string | null;
  basicPaisa: number;
  components: Array<{
    componentId: string;
    code: string;
    amountPaisa: number | null;
    percent: number | null;
  }>;
}

export interface LoanView {
  [key: string]: unknown;
  id: string;
  staffId: string;
  kind: "loan" | "advance";
  principalPaisa: number;
  installmentPaisa: number;
  outstandingPaisa: number;
  /** first day of the first recovery month */
  startsMonth: string;
  status: string;
  reason: string | null;
}

export type TaxCategory =
  | "general"
  | "female"
  | "senior"
  | "disabled"
  | "third_gender"
  | "freedom_fighter";
export const TAX_CATEGORIES: TaxCategory[] = [
  "general",
  "female",
  "senior",
  "disabled",
  "third_gender",
  "freedom_fighter",
];

export interface TaxRules {
  thresholds: Partial<Record<TaxCategory, number>> & { general: number };
  /** above the threshold, in order; `widthPaisa: null` = the rest (must be last) */
  slabs: Array<{ widthPaisa: number | null; ratePct: number }>;
  salaryExemption: { fraction: number; capPaisa: number };
  rebate: { incomePct: number; investmentPct: number; capPaisa: number };
  minimumTaxPaisa: number;
}

export interface TaxYearRow {
  [key: string]: unknown;
  code: string;
  startsOn: string;
  endsOn: string;
  rules: TaxRules;
  sourceNote: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

export const CONTRACT_TYPES = [
  "permanent",
  "fixed_term",
  "part_time",
  "hourly",
  "probation",
] as const;

// ---- data hooks ----

export function useSalaryComponents() {
  return useQuery({
    queryKey: ["hrm.salaryComponents", "all"],
    queryFn: async () =>
      (
        await api.hrm.salaryComponents.list<SalaryComponentRow>({
          pageSize: 500,
        })
      ).data,
    staleTime: 5 * 60_000,
  });
}

export function useTaxYears() {
  return useQuery({
    queryKey: ["hrm.taxYears"],
    queryFn: async () => (await api.hrm.taxYears.list<TaxYearRow[]>()).data,
  });
}

/** Staff name linking to the pay profile. */
export function StaffPayLink({ staffId }: { staffId: string }) {
  return (
    <Link
      className="link link-hover"
      href={`/dashboard/payroll/staff/${staffId}`}
    >
      <RefLabel source={refs.staff} id={staffId} />
    </Link>
  );
}

/** "12.5%" for percent components, "৳1,200.00" otherwise. */
export function componentValue(c: {
  amountPaisa: number | null;
  percent: number | null;
}): string {
  return c.percent !== null && c.percent !== undefined
    ? `${c.percent}% of basic`
    : formatMoney(c.amountPaisa ?? 0);
}

// ---- contract / revision dialog ----

interface Line {
  key: number;
  code: string;
  value: string;
}

export type ContractDialogMode =
  | { kind: "create"; staffId: string }
  | { kind: "revise"; contract: ContractView };

/** New contract, or a salary revision of the current one: basic pay + component lines. */
export function ContractDialog({
  mode,
  onOpenChange,
  onSaved,
}: {
  mode: ContractDialogMode | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={mode !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {mode && (
          <ContractForm
            mode={mode}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ContractForm({
  mode,
  onClose,
  onSaved,
}: {
  mode: ContractDialogMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const components = useSalaryComponents();
  const current = mode.kind === "revise" ? mode.contract : null;
  const [contractType, setContractType] = useState<string>(
    current?.contractType ?? "permanent",
  );
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [probationEndsOn, setProbationEndsOn] = useState("");
  const [basic, setBasic] = useState(
    current ? String(current.basicPaisa / 100) : "",
  );
  const [lines, setLines] = useState<Line[]>(() =>
    (current?.components ?? []).map((c, i) => ({
      key: i,
      code: c.code,
      value:
        c.percent !== null
          ? String(c.percent)
          : String((c.amountPaisa ?? 0) / 100),
    })),
  );
  const [nextKey, setNextKey] = useState(
    () => (current?.components.length ?? 0) + 1,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const options = (components.data ?? [])
    .filter((c) => c.code !== "BASIC")
    .sort((a, b) => a.seq - b.seq);
  const byCode = new Map(options.map((c) => [c.code, c]));

  function setLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const codes = lines.map((l) => l.code).filter(Boolean);
    if (new Set(codes).size !== codes.length) {
      setError("Each component can appear only once.");
      return;
    }
    const payload = lines
      .filter((l) => l.code)
      .map((l) =>
        byCode.get(l.code)?.calc === "percent_of_basic"
          ? { componentCode: l.code, percent: Number(l.value || 0) }
          : { componentCode: l.code, amountPaisa: toPaisa(l.value || 0) },
      );
    setBusy(true);
    try {
      if (mode.kind === "create") {
        await api.hrm.staff.createContract(mode.staffId, {
          contractType: contractType as (typeof CONTRACT_TYPES)[number],
          startsOn,
          ...(endsOn ? { endsOn } : {}),
          ...(probationEndsOn ? { probationEndsOn } : {}),
          basicPaisa: toPaisa(basic),
          components: payload,
        });
        toast.success("Contract created");
      } else {
        await api.hrm.contracts.revise(mode.contract.id, {
          effectiveFrom: startsOn,
          basicPaisa: toPaisa(basic),
          components: payload,
        });
        toast.success("Salary revised");
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>
          {mode.kind === "create" ? "New contract" : "Revise salary"}
        </DialogTitle>
        <DialogDescription>
          {mode.kind === "create"
            ? "Contracts of a staff member must not overlap."
            : "A new contract starts on the revision date; the current one ends the day before."}
        </DialogDescription>
      </DialogHeader>
      {error && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {error}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {mode.kind === "create" && (
          <div className="space-y-1.5">
            <Label htmlFor="c-type">Contract type</Label>
            <select
              id="c-type"
              className="select select-sm h-8 w-full"
              value={contractType}
              onChange={(e) => setContractType(e.target.value)}
            >
              {CONTRACT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="c-start">
            {mode.kind === "create" ? "Starts on" : "Effective from"}
            <span className="text-destructive">*</span>
          </Label>
          <Input
            id="c-start"
            type="date"
            required
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </div>
        {mode.kind === "create" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="c-end">Ends on</Label>
              <Input
                id="c-end"
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-prob">Probation ends on</Label>
              <Input
                id="c-prob"
                type="date"
                value={probationEndsOn}
                onChange={(e) => setProbationEndsOn(e.target.value)}
              />
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="c-basic">
            Basic pay per month{" "}
            <span className="text-xs text-muted-foreground">(৳)</span>
            <span className="text-destructive">*</span>
          </Label>
          <Input
            id="c-basic"
            type="number"
            step="0.01"
            min="0"
            required
            value={basic}
            onChange={(e) => setBasic(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Allowances and deductions</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setLines((ls) => [...ls, { key: nextKey, code: "", value: "" }]);
              setNextKey((k) => k + 1);
            }}
          >
            <PlusIcon /> Add component
          </Button>
        </div>
        {lines.length === 0 && (
          <p className="text-sm text-muted-foreground">Basic pay only.</p>
        )}
        {lines.map((l) => {
          const comp = byCode.get(l.code);
          const unit =
            comp?.calc === "percent_of_basic"
              ? "% of basic"
              : comp?.calc === "per_unit"
                ? "৳ per unit"
                : "৳ per month";
          return (
            <div key={l.key} className="flex items-center gap-2">
              <select
                aria-label="Component"
                className="select select-sm h-8 flex-1"
                required
                value={l.code}
                onChange={(e) => setLine(l.key, { code: e.target.value })}
              >
                <option value="">
                  {components.isPending ? "Loading…" : "Select component…"}
                </option>
                {options.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.nameEn} ({c.code}) · {humanize(c.kind)}
                  </option>
                ))}
              </select>
              <Input
                aria-label="Value"
                type="number"
                step="0.01"
                min="0"
                required
                className="w-32"
                value={l.value}
                onChange={(e) => setLine(l.key, { value: e.target.value })}
              />
              <span className="w-24 text-xs text-muted-foreground">{unit}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove"
                onClick={() =>
                  setLines((ls) => ls.filter((x) => x.key !== l.key))
                }
              >
                <Trash2Icon className="text-destructive" />
              </Button>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Per-unit components (cover periods, overtime) are paid per unit
          entered in the monthly payroll inputs.
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <span className="loading loading-spinner loading-xs" />}
          {mode.kind === "create" ? "Create contract" : "Save revision"}
        </Button>
      </DialogFooter>
    </form>
  );
}
