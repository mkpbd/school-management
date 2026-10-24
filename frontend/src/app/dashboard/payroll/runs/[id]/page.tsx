"use client";

import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  BanIcon,
  CalculatorIcon,
  CheckIcon,
  ClipboardListIcon,
  LockIcon,
  SendIcon,
  UserCheckIcon,
  WalletIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import {
  ConfirmButton,
  DetailList,
  ErrorAlert,
  Loading,
  PageHeader,
} from "@/components/page";
import {
  allows,
  FileButton,
  money,
  monthLabel,
  RunStatusBadge,
  type AttendanceInputs,
  type ComputeSummary,
  type PayrollRun,
  type PayrollSheet,
  type PayslipSummary,
} from "@/components/payroll/runs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/format";
import { refs } from "@/lib/refs";
import { InputsDialog } from "./inputs-dialog";

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: me } = useMe();
  const [inputsOpen, setInputsOpen] = useState(false);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [paying, setPaying] = useState(false);
  const [lastCompute, setLastCompute] = useState<ComputeSummary | null>(null);
  const [lastPull, setLastPull] = useState<AttendanceInputs | null>(null);

  const sheet = useQuery({
    queryKey: ["hrm.payrollRun", id],
    queryFn: () => api.hrm.payrollRuns.get<PayrollSheet>(id),
  });
  const invalidate = [["hrm.payrollRun", id], ["hrm.payrollRuns"]];

  const pull = useAction(
    () => api.hrm.payrollRuns.inputsFromAttendance<AttendanceInputs>(id),
    {
      invalidate,
      success: (r) =>
        `Inputs filled from attendance for ${r.data.rows.length} staff`,
      onSuccess: (r) => setLastPull(r.data),
    },
  );
  const compute = useAction(
    () => api.hrm.payrollRuns.compute<ComputeSummary>(id),
    {
      invalidate,
      success: (r) => `Computed ${r.data.staff} payslips`,
      onSuccess: (r) => setLastCompute(r.data),
    },
  );
  const submit = useAction(() => api.hrm.payrollRuns.submit<PayrollRun>(id), {
    invalidate,
    success: "Submitted for approval",
  });
  const decide = useAction(
    (body: { decision: "approve" | "reject"; note?: string }) =>
      api.hrm.payrollRuns.decide<PayrollRun>(id, body),
    { invalidate, toastError: false },
  );
  const lock = useAction(
    () => api.hrm.payrollRuns.lock<PayrollRun & { loansUpdated: number }>(id),
    {
      invalidate,
      success: (r) =>
        `Payroll locked — ${r.data.loansUpdated} loan installment(s) recorded, staff notified`,
    },
  );
  const paid = useAction(
    (paymentReference: string) =>
      api.hrm.payrollRuns.markPaid<PayrollRun>(id, { paymentReference }),
    {
      invalidate,
      toastError: false,
    },
  );
  const cancel = useAction(() => api.hrm.payrollRuns.cancel<PayrollRun>(id), {
    invalidate,
    success: "Payroll run cancelled",
  });

  if (sheet.isPending) return <Loading />;
  if (sheet.isError) return <ErrorAlert error={sheet.error} />;

  const run = sheet.data.data;
  const status = run.status;
  const slips = run.payslips ?? [];
  const sum = (k: keyof PayslipSummary) =>
    slips.reduce((a, p) => a + (Number(p[k]) || 0), 0);
  const canEdit = can(me, "hrm.payroll.create");
  const canApprove = can(me, "hrm.payroll.approve");
  const isSubmitter = Boolean(
    me && run.submittedBy && run.submittedBy === me.id,
  );
  const busy =
    pull.isPending ||
    compute.isPending ||
    submit.isPending ||
    lock.isPending ||
    cancel.isPending;
  const slipWarnings = slips.flatMap((p) =>
    (p.warnings ?? []).map((w) => ({ ...w, who: `${p.staffNo} ${p.name}` })),
  );

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href="/dashboard/payroll/runs" />}
      >
        <ArrowLeftIcon /> Payroll runs
      </Button>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Payroll · {monthLabel(run.periodMonth)}{" "}
            <RunStatusBadge status={status} />
          </span>
        }
        description={<RefLabel source={refs.campuses} id={run.campusId} />}
        actions={
          <>
            {slips.length > 0 && (
              <FileButton
                mode="open"
                load={() => api.hrm.payrollRuns.payslipsPdf(id)}
              >
                All payslips (PDF)
              </FileButton>
            )}
            {allows("bankAdvice", status) && can(me, "hrm.payroll.export") && (
              <FileButton
                mode="save"
                load={() => api.hrm.payrollRuns.bankAdvice(id)}
                onLoaded={(file) => {
                  const missing = Number(
                    file.headers.get("X-Missing-Accounts") ?? 0,
                  );
                  if (missing > 0)
                    toast.warning(
                      `${missing} staff have no salary bank account and are not in the file`,
                    );
                }}
              >
                Bank advice (CSV)
              </FileButton>
            )}
          </>
        }
      />

      {/* workflow */}
      {status !== "cancelled" && status !== "paid" && (
        <Card className="mb-4">
          <CardContent className="space-y-3">
            <Steps status={status} />
            <div className="flex flex-wrap gap-2">
              {allows("editInputs", status) && canEdit && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => pull.mutate(undefined)}
                  >
                    {pull.isPending ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <UserCheckIcon />
                    )}
                    Fill from attendance
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setInputsOpen(true)}
                  >
                    <ClipboardListIcon /> Edit inputs
                  </Button>
                </>
              )}
              {allows("compute", status) && canEdit && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => compute.mutate(undefined)}
                >
                  {compute.isPending ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <CalculatorIcon />
                  )}
                  {status === "computed" ? "Recompute" : "Compute"}
                </Button>
              )}
              {allows("submit", status) && canEdit && (
                <ConfirmButton
                  variant="default"
                  title="Submit for approval?"
                  description="An approver (not you) must approve it before it can be locked. Inputs can't be changed while it is submitted."
                  confirmLabel="Submit"
                  onConfirm={() => submit.mutateAsync(undefined)}
                >
                  <SendIcon /> Submit
                </ConfirmButton>
              )}
              {allows("decide", status) && canApprove && (
                <>
                  <Button
                    size="sm"
                    disabled={isSubmitter}
                    onClick={() => setDecision("approve")}
                  >
                    <CheckIcon /> Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isSubmitter}
                    onClick={() => setDecision("reject")}
                  >
                    <XIcon /> Reject
                  </Button>
                  {isSubmitter && (
                    <span className="self-center text-xs text-muted-foreground">
                      You submitted it, so someone else must decide.
                    </span>
                  )}
                </>
              )}
              {allows("lock", status) && canApprove && (
                <ConfirmButton
                  variant="default"
                  title="Lock this payroll?"
                  description={
                    <>
                      Payslips are frozen and can no longer be recomputed. This
                      month&apos;s loan / advance installments are deducted from
                      the outstanding balances, and every staff member is
                      notified that their payslip is ready. This cannot be
                      undone.
                    </>
                  }
                  confirmLabel="Lock payroll"
                  onConfirm={() => lock.mutateAsync(undefined)}
                >
                  <LockIcon /> Lock
                </ConfirmButton>
              )}
              {allows("markPaid", status) && canApprove && (
                <Button size="sm" onClick={() => setPaying(true)}>
                  <WalletIcon /> Mark paid
                </Button>
              )}
              {allows("cancel", status) && canEdit && (
                <ConfirmButton
                  destructive
                  title="Cancel this payroll run?"
                  description="The run and its payslips are discarded. You can start a new run for the month afterwards."
                  confirmLabel="Cancel run"
                  onConfirm={async () => {
                    await cancel.mutateAsync(undefined);
                    router.push("/dashboard/payroll/runs");
                  }}
                >
                  <BanIcon /> Cancel run
                </ConfirmButton>
              )}
              {!canEdit && !canApprove && (
                <span className="text-sm text-muted-foreground">
                  You can view this payroll but not change it.
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* totals (daisyUI stats) */}
      <div className="stats stats-vertical mb-4 w-full border bg-card shadow-sm lg:stats-horizontal">
        <Stat title="Staff" value={String(run.totals?.staff ?? slips.length)} />
        <Stat
          title="Gross"
          value={formatMoney(run.totals?.grossPaisa ?? run.grossPaisa ?? 0)}
        />
        <Stat
          title="Deductions"
          value={formatMoney(
            run.totals?.deductionsPaisa ?? run.deductionsPaisa ?? 0,
          )}
        />
        <Stat title="Income tax (TDS)" value={formatMoney(sum("taxPaisa"))} />
        <Stat
          title="Net pay"
          value={formatMoney(run.totals?.netPaisa ?? run.netPaisa ?? 0)}
          strong
        />
        <Stat
          title="Employer contributions"
          value={formatMoney(sum("employerContributionPaisa"))}
        />
      </div>

      {lastCompute &&
        (lastCompute.warnings.length > 0 || lastCompute.skipped.length > 0) && (
          <div
            role="alert"
            className="alert alert-warning alert-soft mb-4 block text-sm"
          >
            <p className="font-medium">Last compute</p>
            <ul className="mt-1 list-disc pl-5">
              {lastCompute.warnings.map((w, i) => (
                <li key={`w${i}`}>
                  {w.staffNo && (
                    <span className="font-mono">{w.staffNo}: </span>
                  )}
                  {w.message}
                </li>
              ))}
              {lastCompute.skipped.map((s) => (
                <li key={`s${s.staffId}`}>
                  <span className="font-mono">{s.staffNo}</span> skipped:{" "}
                  {s.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      {slipWarnings.length > 0 && (
        <div className="alert alert-warning alert-soft mb-4 block text-sm">
          <p className="font-medium">
            Payslip warnings ({slipWarnings.length})
          </p>
          <ul className="mt-1 list-disc pl-5">
            {slipWarnings.slice(0, 20).map((w, i) => (
              <li key={i}>
                <span className="font-mono">{w.who}</span>: {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {lastPull && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Filled from attendance</CardTitle>
            <CardDescription>
              Unpaid days and overtime per staff. Compute to apply them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={lastPull.rows.map((r) => ({ ...r, id: r.staffId }))}
              columns={[
                { key: "staffNo", label: "Staff no", type: "mono" },
                { key: "lwpDays", label: "Unpaid days" },
                { key: "overtimeMinutes", label: "Overtime (min)" },
                {
                  key: "lwpBreakdown",
                  label: "From",
                  render: (r) =>
                    `leave ${r.lwpBreakdown.unpaidLeave} · absent ${r.lwpBreakdown.absent} · half day ${r.lwpBreakdown.halfDay} · late ${r.lwpBreakdown.late}`,
                },
              ]}
            />
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Payslips</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<PayslipSummary>
            rows={slips}
            onRowClick={(p) =>
              router.push(`/dashboard/payroll/payslips/${p.id}`)
            }
            empty={
              status === "draft"
                ? "No payslips yet. Fill / edit the inputs if needed, then Compute."
                : "No payslips in this run."
            }
            columns={[
              { key: "staffNo", label: "Staff no", type: "mono" },
              { key: "name", label: "Name" },
              {
                key: "paidDays",
                label: "Paid days",
                render: (p) => `${p.paidDays} / ${p.workingDays}`,
              },
              { key: "lwpDays", label: "Unpaid" },
              { key: "grossPaisa", label: "Gross", type: "money" },
              { key: "deductionsPaisa", label: "Deductions", type: "money" },
              { key: "taxPaisa", label: "TDS", type: "money" },
              {
                key: "netPaisa",
                label: "Net pay",
                render: (p) => (
                  <span
                    className={`font-medium tabular-nums ${p.netPaisa < 0 ? "text-destructive" : ""}`}
                  >
                    {money(p.netPaisa)}
                  </span>
                ),
              },
              {
                key: "warnings",
                label: "",
                render: (p) =>
                  p.warnings?.length ? (
                    <span
                      className="badge badge-warning badge-soft badge-sm"
                      title={p.warnings.map((w) => w.message).join("\n")}
                    >
                      {p.warnings.length} warning
                      {p.warnings.length > 1 ? "s" : ""}
                    </span>
                  ) : null,
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList
            items={[
              [
                "Extra components",
                run.includedComponents?.length
                  ? run.includedComponents.join(", ")
                  : "—",
              ],
              ["Computed", formatDateTime(run.computedAt)],
              ["Submitted", formatDateTime(run.submittedAt)],
              ["Approved", formatDateTime(run.approvedAt)],
              ["Decision note", run.decisionNote ?? "—"],
              ["Locked", formatDateTime(run.lockedAt)],
              ["Paid", formatDateTime(run.paidAt)],
              ["Payment reference", run.paymentReference ?? "—"],
            ]}
          />
        </CardContent>
      </Card>

      <InputsDialog
        runId={id}
        campusId={run.campusId}
        payslips={slips}
        open={inputsOpen}
        onOpenChange={setInputsOpen}
      />
      <FormDialog
        open={decision !== null}
        onOpenChange={(o) => !o && setDecision(null)}
        title={decision === "approve" ? "Approve payroll" : "Reject payroll"}
        description={
          decision === "approve"
            ? "After approval the payroll can be locked."
            : "The run goes back to computed so the inputs can be corrected."
        }
        submitLabel={decision === "approve" ? "Approve" : "Reject"}
        successMessage={
          decision === "approve" ? "Payroll approved" : "Payroll rejected"
        }
        fields={[
          {
            name: "note",
            label: "Note",
            type: "textarea",
            required: decision === "reject",
          },
        ]}
        onSubmit={(body) =>
          decide.mutateAsync({
            decision: decision!,
            ...(body.note ? { note: String(body.note) } : {}),
          })
        }
      />
      <FormDialog
        open={paying}
        onOpenChange={setPaying}
        title="Record salary payment"
        description="Salaries were transferred to the staff bank accounts (e.g. from the bank advice)."
        submitLabel="Mark paid"
        successMessage="Payroll marked as paid"
        fields={[
          {
            name: "paymentReference",
            label: "Payment reference",
            required: true,
            placeholder: "Bank batch / cheque no",
            wide: true,
          },
        ]}
        onSubmit={(body) => paid.mutateAsync(String(body.paymentReference))}
      />
    </>
  );
}

function Stat({
  title,
  value,
  strong,
}: {
  title: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-title">{title}</div>
      <div
        className={`stat-value text-xl tabular-nums ${strong ? "text-primary" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

const STEPS = [
  ["draft", "Inputs"],
  ["computed", "Computed"],
  ["submitted", "Submitted"],
  ["approved", "Approved"],
  ["locked", "Locked"],
  ["paid", "Paid"],
] as const;

/** daisyUI steps for the run's position in the workflow. */
function Steps({ status }: { status: PayrollRun["status"] }) {
  const at = STEPS.findIndex(([s]) => s === status);
  return (
    <ul className="steps steps-horizontal w-full text-xs">
      {STEPS.map(([s, label], i) => (
        <li key={s} className={`step ${i <= at ? "step-primary" : ""}`}>
          {label}
        </li>
      ))}
    </ul>
  );
}
