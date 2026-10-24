"use client";

import { useQuery } from "@tanstack/react-query";
import { PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorAlert, Loading } from "@/components/page";
import type { PayslipSummary } from "@/components/payroll/runs";
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
import { useAction } from "@/hooks/use-action";
import { api, isApiError } from "@/lib/api";
import { toPaisa } from "@/lib/format";

type Adjustment = { componentCode: string; amount: string; note: string };
type Draft = {
  lwpDays: string;
  overtimeMinutes: string;
  coverPeriods: string;
  adjustments?: Adjustment[];
};
type StaffRow = {
  staffId: string;
  staffNo: string;
  name: string;
  lwpDays?: number;
};

const EMPTY: Draft = { lwpDays: "", overtimeMinutes: "", coverPeriods: "" };

/**
 * Monthly inputs per staff (PUT /payroll-runs/{id}/inputs). The API merges: a field left blank keeps the value
 * saved earlier, so only what is typed here is sent. Adjustments, once edited for a row, replace that row's list.
 */
export function InputsDialog({
  runId,
  campusId,
  payslips,
  open,
  onOpenChange,
}: {
  runId: string;
  campusId: string;
  payslips: PayslipSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-5xl">
        {open && (
          <InputsBody
            runId={runId}
            campusId={campusId}
            payslips={payslips}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function InputsBody({
  runId,
  campusId,
  payslips,
  onDone,
}: {
  runId: string;
  campusId: string;
  payslips: PayslipSummary[];
  onDone: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<unknown>(null);

  // computed runs list their payslips; a fresh draft falls back to the campus staff list
  const staff = useQuery({
    queryKey: ["payroll.inputs.staff", campusId],
    queryFn: () =>
      api.hrm.staff.search<{ id: string; staffNo: string; fullNameEn: string }>(
        { campusId, limit: 200 },
      ),
    enabled: payslips.length === 0,
  });
  const components = useQuery({
    queryKey: ["payroll.inputs.components"],
    queryFn: () =>
      api.hrm.salaryComponents.list<{
        code: string;
        nameEn: string;
        kind: string;
      }>({ pageSize: 500 }),
  });

  const rows: StaffRow[] = payslips.length
    ? payslips.map((p) => ({
        staffId: p.staffId,
        staffNo: p.staffNo,
        name: p.name,
        lwpDays: p.lwpDays,
      }))
    : (staff.data?.data ?? []).map((s) => ({
        staffId: s.id,
        staffNo: s.staffNo,
        name: s.fullNameEn,
      }));
  const f = filter.trim().toLowerCase();
  const shown = f
    ? rows.filter((r) => `${r.staffNo} ${r.name}`.toLowerCase().includes(f))
    : rows;
  const adjustable = (components.data?.data ?? []).filter(
    (c) => c.code !== "BASIC",
  );

  const save = useAction(
    (body: Parameters<typeof api.hrm.payrollRuns.setInputs>[1]) =>
      api.hrm.payrollRuns.setInputs<{ saved: number }>(runId, body),
    {
      invalidate: [["hrm.payrollRun", runId], ["hrm.payrollRuns"]],
      toastError: false,
      onSuccess: (r) => {
        toast.success(
          `Inputs saved for ${r.data.saved} staff — compute again to update the payslips`,
        );
        onDone();
      },
    },
  );

  const set = (staffId: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({
      ...prev,
      [staffId]: { ...EMPTY, ...prev[staffId], ...patch },
    }));

  function submit() {
    setError(null);
    const payload = Object.entries(drafts).flatMap(([staffId, d]) => {
      const row: {
        staffId: string;
        lwpDays?: number;
        overtimeMinutes?: number;
        coverPeriods?: number;
        adjustments?: Array<{
          componentCode: string;
          amountPaisa: number;
          note?: string;
        }>;
      } = { staffId };
      if (d.lwpDays.trim()) row.lwpDays = Number(d.lwpDays);
      if (d.overtimeMinutes.trim())
        row.overtimeMinutes = Math.round(Number(d.overtimeMinutes));
      if (d.coverPeriods.trim())
        row.coverPeriods = Math.round(Number(d.coverPeriods));
      if (d.adjustments)
        row.adjustments = d.adjustments
          .filter((a) => a.componentCode && a.amount.trim())
          .map((a) => ({
            componentCode: a.componentCode,
            amountPaisa: toPaisa(a.amount),
            ...(a.note.trim() ? { note: a.note.trim() } : {}),
          }));
      return Object.keys(row).length > 1 ? [row] : [];
    });
    if (!payload.length) {
      onDone();
      return;
    }
    save.mutateAsync({ rows: payload }).catch((err: unknown) => setError(err));
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Monthly inputs</DialogTitle>
        <DialogDescription>
          Unpaid leave days, overtime, cover periods and one-off adjustments.
          Blank fields keep what was saved before (e.g. by “Fill from
          attendance”). A computed run goes back to draft and must be computed
          again.
        </DialogDescription>
      </DialogHeader>
      {Boolean(error) && (
        <ErrorAlert
          error={
            isApiError(error) && Object.keys(error.fieldErrors).length
              ? new Error(Object.values(error.fieldErrors).join("; "))
              : error
          }
        />
      )}
      <div className="relative sm:w-72">
        <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Filter staff…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {staff.isPending && payslips.length === 0 ? (
        <Loading />
      ) : staff.error ? (
        <ErrorAlert error={staff.error} />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No staff found for this campus.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Staff</TableHead>
              <TableHead className="w-28">Unpaid days</TableHead>
              <TableHead className="w-28">Overtime (min)</TableHead>
              <TableHead className="w-28">Cover periods</TableHead>
              <TableHead>Adjustments (৳)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => {
              const d = drafts[r.staffId] ?? EMPTY;
              return (
                <TableRow key={r.staffId} className="align-top">
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {r.staffNo}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder={
                        r.lwpDays !== undefined ? String(r.lwpDays) : "keep"
                      }
                      value={d.lwpDays}
                      onChange={(e) =>
                        set(r.staffId, { lwpDays: e.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      placeholder="keep"
                      value={d.overtimeMinutes}
                      onChange={(e) =>
                        set(r.staffId, { overtimeMinutes: e.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      placeholder="keep"
                      value={d.coverPeriods}
                      onChange={(e) =>
                        set(r.staffId, { coverPeriods: e.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell className="min-w-72 space-y-1">
                    {(d.adjustments ?? []).map((a, i) => (
                      <div key={i} className="flex gap-1">
                        <select
                          aria-label="Component"
                          className="select select-sm h-8 w-36"
                          value={a.componentCode}
                          onChange={(e) =>
                            set(r.staffId, {
                              adjustments: d.adjustments!.map((x, j) =>
                                j === i
                                  ? { ...x, componentCode: e.target.value }
                                  : x,
                              ),
                            })
                          }
                        >
                          <option value="">Component…</option>
                          {adjustable.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.nameEn} ({c.kind === "deduction" ? "−" : "+"})
                            </option>
                          ))}
                        </select>
                        <Input
                          type="number"
                          step="0.01"
                          className="w-24"
                          placeholder="৳"
                          value={a.amount}
                          onChange={(e) =>
                            set(r.staffId, {
                              adjustments: d.adjustments!.map((x, j) =>
                                j === i ? { ...x, amount: e.target.value } : x,
                              ),
                            })
                          }
                        />
                        <Input
                          className="w-28"
                          placeholder="Note"
                          value={a.note}
                          onChange={(e) =>
                            set(r.staffId, {
                              adjustments: d.adjustments!.map((x, j) =>
                                j === i ? { ...x, note: e.target.value } : x,
                              ),
                            })
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove adjustment"
                          onClick={() =>
                            set(r.staffId, {
                              adjustments: d.adjustments!.filter(
                                (_, j) => j !== i,
                              ),
                            })
                          }
                        >
                          <XIcon />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        set(r.staffId, {
                          adjustments: [
                            ...(d.adjustments ?? []),
                            { componentCode: "", amount: "", note: "" },
                          ],
                        })
                      }
                    >
                      <PlusIcon /> Adjustment
                    </Button>
                    {d.adjustments && (
                      <p className="text-xs text-muted-foreground">
                        Replaces earlier adjustments of this person.
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={save.isPending} onClick={submit}>
          {save.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Save inputs
        </Button>
      </DialogFooter>
    </div>
  );
}
