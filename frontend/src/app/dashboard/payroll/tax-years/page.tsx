"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheckIcon,
  CopyIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  ConfirmButton,
  DetailList,
  Empty,
  ErrorAlert,
  Loading,
  PageHeader,
} from "@/components/page";
import {
  TAX_CATEGORIES,
  useTaxYears,
  type TaxCategory,
  type TaxRules,
  type TaxYearRow,
} from "@/components/payroll/setup";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, isApiError } from "@/lib/api";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  humanize,
  toPaisa,
} from "@/lib/format";

type Editing = { year: TaxYearRow; isNew: boolean } | null;

export default function TaxYearsPage() {
  const { data: me } = useMe();
  const years = useTaxYears();
  const [editing, setEditing] = useState<Editing>(null);
  const verify = useAction((code: string) => api.hrm.taxYears.verify(code), {
    success: "Tax table verified",
    invalidate: [["hrm.taxYears"]],
  });
  const rows = [...(years.data ?? [])].sort((a, b) =>
    b.code.localeCompare(a.code),
  );
  const canEdit = can(me, "hrm.payroll.create");
  const canVerify = can(me, "hrm.payroll.approve");

  function startNew() {
    const latest = rows[0];
    const code = latest ? nextCode(latest.code) : "";
    const [y1] = code.split("-");
    setEditing({
      isNew: true,
      year: {
        code,
        startsOn: y1 ? `${y1}-07-01` : "",
        endsOn: y1 ? `${Number(y1) + 1}-06-30` : "",
        rules: latest?.rules ?? EMPTY_RULES,
        sourceNote: "",
        verifiedBy: null,
        verifiedAt: null,
      },
    });
  }

  return (
    <>
      <PageHeader
        title="Income tax"
        description="Tax tables per income year (July–June), used for monthly TDS on salaries. Payroll warns while a year is unverified."
        actions={
          canEdit && (
            <Button onClick={startNew}>
              <PlusIcon /> New income year
            </Button>
          )
        }
      />
      {years.isError ? (
        <ErrorAlert error={years.error} />
      ) : years.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent>
            <Empty>No income years yet.</Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((y) => (
            <Card key={y.code}>
              <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    Income year {y.code}
                    {y.verifiedAt ? (
                      <span className="badge badge-soft badge-success badge-sm">
                        Verified {formatDateTime(y.verifiedAt)}
                      </span>
                    ) : (
                      <span className="badge badge-soft badge-warning badge-sm">
                        Unverified
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {formatDate(y.startsOn)} – {formatDate(y.endsOn)}
                    {y.sourceNote && <> · {y.sourceNote}</>}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canVerify && !y.verifiedAt && (
                    <ConfirmButton
                      title={`Verify income year ${y.code}?`}
                      description="Confirm that the thresholds, slabs, exemption, rebate and minimum tax match the Finance Act for this income year. The payroll warning goes away."
                      confirmLabel="Verify"
                      onConfirm={() => verify.mutateAsync(y.code)}
                    >
                      <BadgeCheckIcon /> Verify
                    </ConfirmButton>
                  )}
                  {canEdit && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing({ year: y, isNew: false })}
                      >
                        <PencilIcon /> Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setEditing({
                            isNew: true,
                            year: {
                              ...y,
                              code: nextCode(y.code),
                              sourceNote: "",
                              verifiedAt: null,
                              verifiedBy: null,
                            },
                          })
                        }
                      >
                        <CopyIcon /> Copy to new year
                      </Button>
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <RulesView rules={y.rules} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <TaxYearDialog editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

const EMPTY_RULES: TaxRules = {
  thresholds: { general: 0 },
  slabs: [{ widthPaisa: null, ratePct: 0 }],
  salaryExemption: { fraction: 1 / 3, capPaisa: 0 },
  rebate: { incomePct: 0, investmentPct: 0, capPaisa: 0 },
  minimumTaxPaisa: 0,
};

/** "2026-27" -> "2027-28" */
function nextCode(code: string): string {
  const y = Number(code.slice(0, 4));
  if (!Number.isFinite(y)) return "";
  return `${y + 1}-${String((y + 2) % 100).padStart(2, "0")}`;
}

function RulesView({ rules }: { rules: TaxRules }) {
  // lower bound of each band = sum of the widths before it
  const starts = rules.slabs.map((_, i) =>
    rules.slabs.slice(0, i).reduce((sum, x) => sum + (x.widthPaisa ?? 0), 0),
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-medium">Tax-free threshold</h3>
        <DetailList
          items={TAX_CATEGORIES.filter(
            (c) => rules.thresholds[c] !== undefined,
          ).map((c) => [humanize(c), formatMoney(rules.thresholds[c])])}
        />
        <h3 className="mt-4 mb-2 text-sm font-medium">Other rules</h3>
        <DetailList
          items={[
            [
              "Salary exemption",
              `${Math.round(rules.salaryExemption.fraction * 10000) / 100}% of salary, max ${formatMoney(rules.salaryExemption.capPaisa)}`,
            ],
            [
              "Investment rebate",
              `lowest of ${rules.rebate.incomePct}% of taxable income, ${rules.rebate.investmentPct}% of investment, ${formatMoney(rules.rebate.capPaisa)}`,
            ],
            ["Minimum tax", formatMoney(rules.minimumTaxPaisa)],
          ]}
        />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium">
          Slabs (income above the threshold)
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Income band</TableHead>
              <TableHead className="text-right">Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.slabs.map((s, i) => {
              const from = starts[i]!;
              const label =
                s.widthPaisa === null
                  ? `Above ${formatMoney(from)}`
                  : `${formatMoney(from)} – ${formatMoney(from + s.widthPaisa)}`;
              return (
                <TableRow key={i}>
                  <TableCell className="tabular-nums">{label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.ratePct}%
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---- editor ----

function TaxYearDialog({
  editing,
  onClose,
}: {
  editing: Editing;
  onClose: () => void;
}) {
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        {editing && <TaxYearForm editing={editing} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

const taka = (paisa: number | undefined | null) =>
  paisa === undefined || paisa === null ? "" : String(paisa / 100);

function TaxYearForm({
  editing,
  onClose,
}: {
  editing: NonNullable<Editing>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { year, isNew } = editing;
  const r = year.rules;
  const [code, setCode] = useState(year.code);
  const [startsOn, setStartsOn] = useState(year.startsOn);
  const [endsOn, setEndsOn] = useState(year.endsOn);
  const [sourceNote, setSourceNote] = useState(year.sourceNote ?? "");
  const [thresholds, setThresholds] = useState<Record<TaxCategory, string>>(
    () =>
      Object.fromEntries(
        TAX_CATEGORIES.map((c) => [c, taka(r.thresholds[c])]),
      ) as Record<TaxCategory, string>,
  );
  const [slabs, setSlabs] = useState(() =>
    r.slabs.map((s, i) => ({
      key: i,
      width: taka(s.widthPaisa),
      rest: s.widthPaisa === null,
      rate: String(s.ratePct),
    })),
  );
  const [nextKey, setNextKey] = useState(r.slabs.length);
  const [exemptionPct, setExemptionPct] = useState(
    String(Math.round(r.salaryExemption.fraction * 1e6) / 1e4),
  );
  const [exemptionCap, setExemptionCap] = useState(
    taka(r.salaryExemption.capPaisa),
  );
  const [rebateIncome, setRebateIncome] = useState(String(r.rebate.incomePct));
  const [rebateInvest, setRebateInvest] = useState(
    String(r.rebate.investmentPct),
  );
  const [rebateCap, setRebateCap] = useState(taka(r.rebate.capPaisa));
  const [minimum, setMinimum] = useState(taka(r.minimumTaxPaisa));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{4}-\d{2}$/.test(code))
      return setError("Code must look like 2026-27.");
    if (!thresholds.general)
      return setError("The general threshold is required.");
    if (slabs.length === 0 || !slabs.at(-1)!.rest)
      return setError("The last slab must be the open-ended rest.");
    if (slabs.slice(0, -1).some((s) => s.rest))
      return setError("Only the last slab can be the rest.");
    const rules: TaxRules = {
      thresholds: Object.fromEntries(
        TAX_CATEGORIES.filter((c) => thresholds[c] !== "").map((c) => [
          c,
          toPaisa(thresholds[c]),
        ]),
      ) as TaxRules["thresholds"],
      slabs: slabs.map((s) => ({
        widthPaisa: s.rest ? null : toPaisa(s.width || 0),
        ratePct: Number(s.rate || 0),
      })),
      salaryExemption: {
        fraction: Number(exemptionPct || 0) / 100,
        capPaisa: toPaisa(exemptionCap || 0),
      },
      rebate: {
        incomePct: Number(rebateIncome || 0),
        investmentPct: Number(rebateInvest || 0),
        capPaisa: toPaisa(rebateCap || 0),
      },
      minimumTaxPaisa: toPaisa(minimum || 0),
    };
    setBusy(true);
    try {
      await api.hrm.taxYears.save(code, {
        startsOn,
        endsOn,
        ...(sourceNote ? { sourceNote } : {}),
        rules,
      });
      toast.success(`Income year ${code} saved — it needs verification again`);
      await queryClient.invalidateQueries({ queryKey: ["hrm.taxYears"] });
      onClose();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const money = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    required = false,
  ) => (
    <div key={id} className="space-y-1.5">
      <Label htmlFor={id}>
        {label} <span className="text-xs text-muted-foreground">(৳)</span>
        {required && <span className="text-destructive">*</span>}
      </Label>
      <Input
        id={id}
        type="number"
        step="0.01"
        min="0"
        required={required}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );
  const pct = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
  ) => (
    <div key={id} className="space-y-1.5">
      <Label htmlFor={id}>
        {label} <span className="text-xs text-muted-foreground">(%)</span>
      </Label>
      <Input
        id={id}
        type="number"
        step="any"
        min="0"
        max="100"
        required
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>
          {isNew ? "New income year" : `Edit income year ${year.code}`}
        </DialogTitle>
        <DialogDescription>
          Saving clears the verification: someone with approval rights must
          verify the table against the Finance Act again.
        </DialogDescription>
      </DialogHeader>
      {error && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="t-code">
            Code<span className="text-destructive">*</span>
          </Label>
          <Input
            id="t-code"
            required
            disabled={!isNew}
            placeholder="2027-28"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-start">
            Starts on<span className="text-destructive">*</span>
          </Label>
          <Input
            id="t-start"
            type="date"
            required
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-end">
            Ends on<span className="text-destructive">*</span>
          </Label>
          <Input
            id="t-end"
            type="date"
            required
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="t-note">Source note</Label>
          <Textarea
            id="t-note"
            rows={2}
            placeholder="Finance Act 2027, section …"
            value={sourceNote}
            onChange={(e) => setSourceNote(e.target.value)}
          />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          Tax-free threshold per category
        </legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {TAX_CATEGORIES.map((c) =>
            money(
              `t-th-${c}`,
              humanize(c),
              thresholds[c],
              (v) => setThresholds((t) => ({ ...t, [c]: v })),
              c === "general",
            ),
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Empty categories fall back to the general threshold.
        </p>
      </fieldset>

      <fieldset className="space-y-2">
        <div className="flex items-center justify-between">
          <legend className="text-sm font-medium">
            Slabs, in order (income above the threshold)
          </legend>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSlabs((ss) => {
                // insert before the open-ended rest
                const last = ss.at(-1);
                const row = { key: nextKey, width: "", rest: false, rate: "" };
                return last?.rest
                  ? [...ss.slice(0, -1), row, last]
                  : [...ss, row];
              });
              setNextKey((k) => k + 1);
            }}
          >
            <PlusIcon /> Add slab
          </Button>
        </div>
        {slabs.map((s, i) => (
          <div key={s.key} className="flex flex-wrap items-center gap-2">
            <span className="w-6 text-sm text-muted-foreground">{i + 1}.</span>
            <Input
              aria-label="Band width (৳)"
              type="number"
              step="0.01"
              min="0"
              className="w-40"
              placeholder="Width ৳"
              disabled={s.rest}
              required={!s.rest}
              value={s.rest ? "" : s.width}
              onChange={(e) =>
                setSlabs((ss) =>
                  ss.map((x) =>
                    x.key === s.key ? { ...x, width: e.target.value } : x,
                  ),
                )
              }
            />
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-xs"
                checked={s.rest}
                onChange={(e) =>
                  setSlabs((ss) =>
                    ss.map((x) =>
                      x.key === s.key ? { ...x, rest: e.target.checked } : x,
                    ),
                  )
                }
              />
              rest
            </label>
            <Input
              aria-label="Rate (%)"
              type="number"
              step="any"
              min="0"
              max="100"
              required
              className="w-24"
              placeholder="Rate %"
              value={s.rate}
              onChange={(e) =>
                setSlabs((ss) =>
                  ss.map((x) =>
                    x.key === s.key ? { ...x, rate: e.target.value } : x,
                  ),
                )
              }
            />
            <span className="text-sm text-muted-foreground">%</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove slab"
              onClick={() =>
                setSlabs((ss) => ss.filter((x) => x.key !== s.key))
              }
            >
              <Trash2Icon className="text-destructive" />
            </Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          The last slab must be &quot;rest&quot; (everything above).
        </p>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-medium sm:col-span-3">
          Exemption, rebate, minimum
        </legend>
        {pct("t-ex-f", "Salary exemption", exemptionPct, setExemptionPct)}
        {money("t-ex-c", "Exemption cap", exemptionCap, setExemptionCap)}
        {money("t-min", "Minimum tax", minimum, setMinimum)}
        {pct(
          "t-rb-i",
          "Rebate: % of taxable income",
          rebateIncome,
          setRebateIncome,
        )}
        {pct(
          "t-rb-v",
          "Rebate: % of investment",
          rebateInvest,
          setRebateInvest,
        )}
        {money("t-rb-c", "Rebate cap", rebateCap, setRebateCap)}
      </fieldset>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <span className="loading loading-spinner loading-xs" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
