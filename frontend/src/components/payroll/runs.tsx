"use client";

import { FileDownIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deliverFile, type DownloadedFile, type Row } from "@/lib/api";
import { formatMoney, humanize } from "@/lib/format";

// Response shapes from backend/src/modules/hrm/application/payrollPorts.ts

export type RunStatus =
  | "draft"
  | "computed"
  | "submitted"
  | "approved"
  | "locked"
  | "paid"
  | "cancelled";

export type PayrollRun = Row & {
  id: string;
  campusId: string;
  /** first day of the month, YYYY-MM-01 */
  periodMonth: string;
  status: RunStatus;
  includedComponents: string[];
  grossPaisa: number | null;
  deductionsPaisa: number | null;
  netPaisa: number | null;
  computedAt: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  decisionNote: string | null;
  lockedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
};

export type PayslipWarning = { code: string; message: string };

export type PayslipSummary = Row & {
  id: string;
  staffId: string;
  staffNo: string;
  name: string;
  workingDays: number;
  paidDays: number;
  lwpDays: number;
  grossPaisa: number;
  deductionsPaisa: number;
  taxPaisa: number;
  netPaisa: number;
  employerContributionPaisa: number;
  warnings: PayslipWarning[];
};

export type PayrollSheet = PayrollRun & {
  payslips: PayslipSummary[];
  totals: {
    staff: number;
    grossPaisa: number;
    deductionsPaisa: number;
    netPaisa: number;
  };
};

export type PayslipLine = {
  code: string;
  name: string;
  kind: "earning" | "deduction" | "employer_contribution" | string;
  quantity: number | null;
  amountPaisa: number;
  note: string | null;
};

export type PayslipDetail = PayslipSummary & {
  payrollRunId: string;
  campusId: string;
  periodMonth: string;
  runStatus: RunStatus;
  coverPeriods: number;
  overtimeMinutes: number;
  lines: PayslipLine[];
};

export type MyPayslip = PayslipSummary & {
  periodMonth: string;
  runStatus?: RunStatus;
};

/** POST /payroll-runs/{id}/compute */
export type ComputeSummary = {
  runId: string;
  staff: number;
  grossPaisa: number;
  deductionsPaisa: number;
  netPaisa: number;
  warnings: Array<{
    staffId: string;
    staffNo: string;
    code: string;
    message: string;
  }>;
  skipped: Array<{ staffId: string; staffNo: string; reason: string }>;
};

/** POST /payroll-runs/{id}/inputs/from-attendance */
export type AttendanceInputs = {
  status: RunStatus;
  rows: Array<{
    staffId: string;
    staffNo: string;
    lwpDays: number;
    overtimeMinutes: number;
    lwpBreakdown: {
      unpaidLeave: number;
      absent: number;
      halfDay: number;
      late: number;
    };
  }>;
};

/** What each status allows (expectStatus calls in PayrollUseCases.ts). */
export const RUN_ACTIONS = {
  editInputs: ["draft", "computed"],
  compute: ["draft", "computed"],
  submit: ["computed"],
  decide: ["submitted"],
  lock: ["approved"],
  markPaid: ["locked"],
  cancel: ["draft", "computed", "submitted"],
  bankAdvice: ["locked", "paid"],
} satisfies Record<string, RunStatus[]>;

export function allows(
  action: keyof typeof RUN_ACTIONS,
  status: RunStatus,
): boolean {
  return (RUN_ACTIONS[action] as RunStatus[]).includes(status);
}

const TONE: Record<RunStatus, string> = {
  draft: "badge-ghost",
  computed: "badge-info",
  submitted: "badge-warning",
  approved: "badge-primary",
  locked: "badge-secondary",
  paid: "badge-success",
  cancelled: "badge-error",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span
      className={`badge badge-soft badge-sm whitespace-nowrap ${TONE[status] ?? "badge-ghost"}`}
    >
      {humanize(status)}
    </span>
  );
}

/** "2026-10-01" -> "October 2026" (no Date: the label is the same on server and client). */
export function monthLabel(periodMonth: string | null | undefined): string {
  if (!periodMonth) return "—";
  const [y, m] = periodMonth.split("-");
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const name = names[Number(m) - 1];
  return name ? `${name} ${y}` : periodMonth;
}

export function money(paisa: number | null | undefined): string {
  return paisa === null || paisa === undefined ? "—" : formatMoney(paisa);
}

/** Button that fetches a file (PDF / CSV) and opens or saves it. */
export function FileButton({
  load,
  mode,
  onLoaded,
  children,
  variant = "outline",
  size = "sm",
}: {
  load: () => Promise<DownloadedFile>;
  mode: "open" | "save";
  /** Called with the downloaded file, e.g. to warn about something in its headers. */
  onLoaded?: (file: DownloadedFile) => void;
  children: React.ReactNode;
  variant?: "outline" | "ghost" | "default";
  size?: "sm" | "xs" | "icon-sm";
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const file = await load();
          deliverFile(file, mode);
          onLoaded?.(file);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Download failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <span className="loading loading-spinner loading-xs" />
      ) : (
        <FileDownIcon />
      )}
      {children}
    </Button>
  );
}
