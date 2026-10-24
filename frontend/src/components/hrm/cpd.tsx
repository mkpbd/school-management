"use client";

import { useQuery } from "@tanstack/react-query";
import { FileTextIcon, PlusIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/crud/data-table";
import { ErrorAlert, Loading, StatusBadge } from "@/components/page";
import { FileButton } from "@/components/payroll/runs";
import {
  openFile,
  retryWhileScanning,
  uploadFile,
} from "@/components/sis/shared";
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
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, isApiError } from "@/lib/api";
import { todayISO } from "@/lib/format";

// ---- contract shapes (backend/src/modules/hrm/application/CpdUseCases.ts) ----

export const CPD_CATEGORIES = [
  "pedagogy",
  "subject",
  "safeguarding",
  "leadership",
  "technology",
  "curriculum",
  "wellbeing",
  "other",
] as const;
export const CPD_DELIVERY = ["in_person", "online", "blended"] as const;
export const CPD_SESSION_STATUSES = [
  "scheduled",
  "completed",
  "cancelled",
] as const;
export type CpdSessionStatus = (typeof CPD_SESSION_STATUSES)[number];

export interface CpdSession {
  [key: string]: unknown;
  id: string;
  campusId: string;
  courseId: string;
  title: string;
  hours: number;
  startsAt: string;
  endsAt: string;
  venue: string | null;
  trainer: string | null;
  capacity: number;
  status: CpdSessionStatus;
  registered: number;
}

export interface CpdRecord {
  [key: string]: unknown;
  id: string;
  staffId: string;
  staffName: string;
  title: string;
  provider: string | null;
  completedOn: string;
  hours: number;
  source: "session" | "external";
  sessionId: string | null;
  certificateNo: string | null;
  certificateFileId: string | null;
  verifiedAt: string | null;
}

export interface StaffCpd {
  staffId: string;
  year: number;
  records: CpdRecord[];
  totals: {
    verifiedHours: number;
    pendingHours: number;
    targetHours: number;
    progressPercent: number;
  };
}

export interface CpdSummaryRow {
  [key: string]: unknown;
  staffId: string;
  staffNo: string;
  name: string;
  verifiedHours: number;
  pendingHours: number;
  met: boolean;
}

export interface CpdSummaryView {
  year: number;
  targetHours: number;
  rows: CpdSummaryRow[];
}

// ---- helpers ----

/** 2.5 -> "2.5 h" */
export function hours(n: number | string | null | undefined): string {
  const v = Number(n);
  return Number.isFinite(v) ? `${v} h` : "—";
}

/** Date + time entered in Asia/Dhaka -> ISO instant with offset (what the API expects). */
export function dhakaInstant(date: string, time: string): string {
  return `${date}T${time.slice(0, 5)}:00+06:00`;
}

export function currentYear(): number {
  return Number(todayISO().slice(0, 4));
}

/** CPD year (calendar year) picker: this year and the four before. */
export function YearSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (year: number) => void;
}) {
  const [now] = useState(currentYear);
  const years = Array.from({ length: 5 }, (_, i) => now - i);
  if (!years.includes(value)) years.push(value);
  return (
    <select
      aria-label="Year"
      className="select select-sm h-8 sm:w-32"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}

/** Verified hours against the target, pending hours on top. */
export function CpdProgress({
  verified,
  pending,
  target,
}: {
  verified: number;
  pending: number;
  target: number;
}) {
  return (
    <div className="flex min-w-32 items-center gap-2">
      <progress
        className={`progress w-24 ${verified >= target ? "progress-success" : "progress-primary"}`}
        value={Math.min(verified, target)}
        max={Math.max(target, 1)}
      />
      <span className="text-xs text-muted-foreground tabular-nums">
        {Math.min(100, Math.round((verified / Math.max(target, 1)) * 100))}%
        {pending > 0 ? ` (+${pending} h pending)` : ""}
      </span>
    </div>
  );
}

/** Button that opens an uploaded certificate (file vault, needs hrm.cpd.view). */
export function CertificateFileButton({ fileId }: { fileId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await openFile(fileId);
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Could not open the file",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <span className="loading loading-spinner loading-xs" />
      ) : (
        <FileTextIcon />
      )}
      File
    </Button>
  );
}

// ---- one staff member's CPD year (My CPD, and HR's view of a staff member) ----

/** Hours vs target, records with certificates, and "log external training". `staffId` omitted = yourself. */
export function StaffCpdView({
  staffId,
  year,
}: {
  staffId?: string;
  year: number;
}) {
  const { data: me } = useMe();
  const [logging, setLogging] = useState(false);
  const query = { year, ...(staffId ? { staffId } : {}) };
  const cpd = useQuery({
    queryKey: ["hrm.cpd", query],
    queryFn: async () => (await api.hrm.cpd.get<StaffCpd>(query)).data,
    retry: false,
  });
  const canLog = staffId ? can(me, "hrm.cpd.create") : Boolean(me?.staffId);
  const canOpenFiles = can(me, "hrm.cpd.view");

  if (isApiError(cpd.error) && cpd.error.code === "STAFF_REQUIRED")
    return (
      <Card>
        <CardContent>
          <div className="py-10 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              No staff record for this login
            </p>
            <p>
              CPD is tracked for staff members. Ask HR to link your login to
              your staff profile.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  if (cpd.isError) return <ErrorAlert error={cpd.error} />;
  if (cpd.isPending) return <Loading />;
  const { totals, records } = cpd.data;
  const remaining = Math.max(0, totals.targetHours - totals.verifiedHours);

  return (
    <div className="space-y-4">
      <div className="stats stats-vertical w-full border bg-card shadow-sm sm:stats-horizontal">
        <div className="stat">
          <div className="stat-title">Verified hours</div>
          <div
            className={`stat-value text-xl ${remaining === 0 ? "text-success" : ""}`}
          >
            {hours(totals.verifiedHours)}
          </div>
          <div className="stat-desc">
            <progress
              className={`progress w-full ${remaining === 0 ? "progress-success" : "progress-primary"}`}
              value={totals.progressPercent}
              max={100}
            />
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Target ({year})</div>
          <div className="stat-value text-xl">{hours(totals.targetHours)}</div>
          <div className="stat-desc">
            {remaining === 0 ? "Target met" : `${remaining} h to go`}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Waiting for verification</div>
          <div className="stat-value text-xl">{hours(totals.pendingHours)}</div>
          <div className="stat-desc">
            External training counts once HR verifies it
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="sm:flex sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Training records</CardTitle>
            <CardDescription>
              Completed in-house sessions (verified, with a certificate) and
              external training.
            </CardDescription>
          </div>
          {canLog && (
            <Button onClick={() => setLogging(true)}>
              <PlusIcon /> Log external training
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataTable<CpdRecord>
            rows={records}
            empty={`No CPD recorded for ${year}.`}
            columns={[
              {
                key: "title",
                label: "Training",
                render: (r) => (
                  <div>
                    <div className="font-medium">{r.title}</div>
                    {r.provider && (
                      <div className="text-xs text-muted-foreground">
                        {r.provider}
                      </div>
                    )}
                  </div>
                ),
              },
              { key: "completedOn", label: "Completed", type: "date" },
              {
                key: "hours",
                label: "Hours",
                render: (r) => (
                  <span className="tabular-nums">{hours(r.hours)}</span>
                ),
              },
              {
                key: "source",
                label: "Source",
                render: (r) =>
                  r.source === "session" ? "In-house session" : "External",
              },
              {
                key: "verifiedAt",
                label: "Status",
                render: (r) => (
                  <StatusBadge status={r.verifiedAt ? "verified" : "pending"} />
                ),
              },
              { key: "certificateNo", label: "Certificate no.", type: "mono" },
            ]}
            actions={(r) => (
              <>
                {r.certificateNo && r.verifiedAt && (
                  <FileButton
                    mode="open"
                    size="xs"
                    variant="ghost"
                    load={() => api.hrm.cpdRecords.certificate(r.id)}
                  >
                    Certificate
                  </FileButton>
                )}
                {r.certificateFileId && canOpenFiles && (
                  <CertificateFileButton fileId={r.certificateFileId} />
                )}
              </>
            )}
          />
        </CardContent>
      </Card>

      <LogTrainingDialog
        open={logging}
        onOpenChange={setLogging}
        staffId={staffId}
      />
    </div>
  );
}

// ---- log external training (optional certificate upload) ----

const ACCEPT = "application/pdf,image/jpeg,image/png";
const MAX_BYTES = 10 * 1024 * 1024;

type Step = "idle" | "uploading" | "scanning" | "saving";
const STEP_LABEL: Record<Step, string> = {
  idle: "",
  uploading: "Uploading…",
  scanning: "Waiting for the virus scan…",
  saving: "Saving…",
};

/** External training: title, provider, date, hours and an optional certificate (purpose cpd_certificate). */
export function LogTrainingDialog({
  open,
  onOpenChange,
  staffId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Log for another staff member (hrm.cpd.create); omitted = yourself. */
  staffId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && (
          <LogTrainingForm
            staffId={staffId}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LogTrainingForm({
  staffId,
  onClose,
}: {
  staffId?: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [completedOn, setCompletedOn] = useState(todayISO);
  const [hoursValue, setHoursValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const log = useAction(
    (certificateFileId: string | null) =>
      api.hrm.cpdRecords.logExternal({
        ...(staffId ? { staffId } : {}),
        title: title.trim(),
        ...(provider.trim() ? { provider: provider.trim() } : {}),
        completedOn,
        hours: Number(hoursValue),
        ...(certificateFileId ? { certificateFileId } : {}),
      }),
    {
      invalidate: [["hrm.cpd"], ["hrm.cpdPending"], ["hrm.cpdSummary"]],
      toastError: false,
    },
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (file && file.size > MAX_BYTES) {
      setError("File is larger than 10 MB.");
      return;
    }
    setError(null);
    try {
      let id = fileId;
      if (file && !id) {
        setStep("uploading");
        id = await uploadFile(file, "cpd_certificate");
        setFileId(id);
      }
      if (id) {
        setStep("scanning");
        await retryWhileScanning(async () => {
          setStep("saving");
          try {
            return await log.mutateAsync(id);
          } finally {
            setStep("scanning");
          }
        });
      } else {
        setStep("saving");
        await log.mutateAsync(null);
      }
      toast.success("Training logged — HR will verify it");
      setStep("idle");
      onClose();
    } catch (err) {
      setStep("idle");
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  const busy = step !== "idle";

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Log external training</DialogTitle>
        <DialogDescription>
          Courses, workshops or conferences outside the school. The hours count
          towards the target once HR verifies them.
        </DialogDescription>
      </DialogHeader>
      {error && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {error}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cpd-title">
            Title<span className="text-destructive">*</span>
          </Label>
          <Input
            id="cpd-title"
            required
            minLength={3}
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cpd-provider">Provider</Label>
          <Input
            id="cpd-provider"
            maxLength={200}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cpd-date">
            Completed on<span className="text-destructive">*</span>
          </Label>
          <Input
            id="cpd-date"
            type="date"
            required
            max={todayISO()}
            value={completedOn}
            onChange={(e) => setCompletedOn(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cpd-hours">
            Hours<span className="text-destructive">*</span>
          </Label>
          <Input
            id="cpd-hours"
            type="number"
            required
            min={0.5}
            max={500}
            step={0.5}
            value={hoursValue}
            onChange={(e) => setHoursValue(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            In half hours, e.g. 2.5
          </p>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cpd-file">Certificate</Label>
          <input
            id="cpd-file"
            type="file"
            accept={ACCEPT}
            disabled={busy || Boolean(fileId)}
            className="file-input file-input-sm w-full"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">
            {fileId
              ? "Uploaded; retry will only save the record."
              : "Optional. PDF, JPEG or PNG up to 10 MB."}
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <span className="loading loading-spinner loading-xs" />}
          {busy ? STEP_LABEL[step] : "Log training"}
        </Button>
      </DialogFooter>
    </form>
  );
}
