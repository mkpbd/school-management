"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCheckIcon,
  FilePenLineIcon,
  HistoryIcon,
  LayoutGridIcon,
  LockIcon,
  SaveIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { toast } from "sonner";
import {
  CorrectionDialog,
  type CorrectionPrefill,
} from "@/components/att/correction-dialog";
import { HistoryDialog } from "@/components/att/history-dialog";
import {
  explain,
  SHORT,
  TONE,
  type DailySheet,
  type MarkResult,
} from "@/components/att/shared";
import { RefSelect } from "@/components/crud/fields";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { DAILY_STATUSES, type DailyStatus } from "@/components/sis/shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { formatDate, formatDateTime, humanize, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

function DailyRegisterPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // section and date live in the URL so "My day" can link straight to a register
  const sectionId = params.get("sectionId") ?? "";
  const date = params.get("date") ?? todayISO();
  const go = (next: { sectionId?: string; date?: string }) => {
    const q = new URLSearchParams({ sectionId, date, ...next });
    if (!q.get("sectionId")) q.delete("sectionId");
    router.replace(`${pathname}?${q}`);
  };

  const sheet = useQuery({
    queryKey: ["att", "daily", sectionId, date],
    queryFn: () => api.att.daily.get<DailySheet>(sectionId, { date }),
    enabled: Boolean(sectionId),
  });

  return (
    <>
      <PageHeader
        title="Daily register"
        description="Tap only the exceptions; everyone else is saved as present (or on leave). Absent and late marks send an SMS / push to the primary guardian."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="sm:w-64">
              <RefSelect
                source={refs.sections}
                value={sectionId}
                placeholder="Pick a section"
                onChange={(v) => go({ sectionId: v })}
              />
            </div>
            <Input
              type="date"
              className="sm:w-44"
              aria-label="Date"
              max={todayISO()}
              value={date}
              onChange={(e) => e.target.value && go({ date: e.target.value })}
            />
          </div>
          {!sectionId ? (
            <Empty>Pick a section and a date.</Empty>
          ) : sheet.isPending ? (
            <Loading />
          ) : sheet.isError ? (
            <ErrorAlert error={sheet.error} />
          ) : (
            // remount on every fresh sheet so the marks start from the server state
            <RegisterEditor
              key={`${sectionId}:${date}:${sheet.dataUpdatedAt}`}
              sheet={sheet.data.data}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

type Marks = Record<string, { status: DailyStatus; remarks: string }>;

function RegisterEditor({ sheet }: { sheet: DailySheet }) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const canEdit =
    can(me, "att.daily.edit") && sheet.schoolDay && sheet.editable;
  const canCorrect =
    can(me, "att.correction.create") &&
    sheet.schoolDay &&
    !sheet.editable &&
    sheet.marked;
  const [marks, setMarks] = useState<Marks>(() =>
    Object.fromEntries(
      sheet.entries.map((e) => [
        e.studentId,
        { status: e.status ?? e.suggested, remarks: e.remarks ?? "" },
      ]),
    ),
  );
  // one key per edit session: a retried save replays instead of sending alerts twice
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [history, setHistory] = useState<{
    studentId: string;
    date: string;
    name: string;
  } | null>(null);
  const [correction, setCorrection] = useState<CorrectionPrefill | null>(null);

  const set = (studentId: string, patch: Partial<Marks[string]>) =>
    setMarks((m) => ({ ...m, [studentId]: { ...m[studentId]!, ...patch } }));

  const counts = DAILY_STATUSES.map(
    (s) =>
      [s, Object.values(marks).filter((m) => m.status === s).length] as const,
  );
  // quick marking: only rows that differ from the suggestion (present, or leave) are sent; markRest fills the rest
  const exceptions = sheet.entries.filter((e) => {
    const m = marks[e.studentId]!;
    return m.status !== e.suggested || m.remarks.trim() !== "";
  });

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      const { data } = await api.att.daily.mark<MarkResult>(
        sheet.classSectionId,
        {
          markRest: true,
          entries: exceptions.map((e) => {
            const m = marks[e.studentId]!;
            return {
              studentId: e.studentId,
              status: m.status,
              ...(m.remarks.trim() ? { remarks: m.remarks.trim() } : {}),
            };
          }),
        },
        { date: sheet.date },
        { idempotencyKey },
      );
      toast.success(
        `Saved: ${data.changed} changed, ${data.alerts} guardian alert${data.alerts === 1 ? "" : "s"}`,
      );
      setIdempotencyKey(crypto.randomUUID());
      await queryClient.invalidateQueries({
        queryKey: ["att", "daily", sheet.classSectionId, sheet.date],
      });
    } catch (err) {
      setProblem(explain(err, "Could not save the register."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {sheet.sectionName}
              {sheet.periodWise && (
                <span className="badge badge-info badge-soft badge-sm">
                  Period-wise
                </span>
              )}
              {!sheet.editable && sheet.schoolDay && (
                <span className="badge badge-ghost badge-sm gap-1">
                  <LockIcon className="size-3" /> Locked
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {formatDate(sheet.date)} · {sheet.entries.length} students ·{" "}
              {sheet.marked ? "already marked" : "not marked yet"}
              {sheet.schoolDay &&
                (sheet.editable
                  ? ` · editable until ${formatDateTime(sheet.editableUntil)}`
                  : ` · edit window closed ${formatDateTime(sheet.editableUntil)}`)}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {sheet.periodWise && (
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    href={`/dashboard/attendance/section-day?sectionId=${sheet.classSectionId}&date=${sheet.date}`}
                  />
                }
              >
                <LayoutGridIcon /> Lessons
              </Button>
            )}
            {canCorrect && (
              <Button
                variant="outline"
                onClick={() =>
                  setCorrection({ kind: "daily", date: sheet.date })
                }
              >
                <FilePenLineIcon /> Request correction
              </Button>
            )}
            {canEdit && sheet.entries.length > 0 && (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    setMarks(
                      Object.fromEntries(
                        sheet.entries.map((e) => [
                          e.studentId,
                          { status: e.suggested, remarks: "" },
                        ]),
                      ),
                    )
                  }
                >
                  <CheckCheckIcon /> Reset to all present
                </Button>
                <Button onClick={save} disabled={busy}>
                  {busy ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <SaveIcon />
                  )}
                  Save ({exceptions.length} exception
                  {exceptions.length === 1 ? "" : "s"}, rest present)
                </Button>
              </>
            )}
          </div>
        </CardHeader>
      </Card>

      {!sheet.schoolDay && (
        <div role="alert" className="alert alert-warning alert-soft text-sm">
          Not a school day
          {sheet.holiday ? `: ${sheet.holiday}` : " (weekend or holiday)"}. The
          register is read-only.
        </div>
      )}
      {sheet.schoolDay && !sheet.editable && (
        <div role="alert" className="alert alert-soft text-sm">
          The edit window for this date closed at{" "}
          {formatDateTime(sheet.editableUntil)}. The register is read-only;
          {can(me, "att.correction.create")
            ? " use “Correct” on a student to ask for a change (applied when approved)."
            : " ask someone with correction rights to request a change."}
        </div>
      )}
      {problem && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {problem}
        </div>
      )}

      {sheet.entries.length === 0 ? (
        <Empty>No students are placed in this section on this date.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {counts.map(([s, n]) => (
              <span key={s} className="badge badge-soft badge-sm">
                {humanize(s)}: {n}
              </span>
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Roll</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sheet.entries.map((e) => {
                const m = marks[e.studentId]!;
                return (
                  <TableRow key={e.studentId}>
                    <TableCell>{e.rollNo ?? "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{e.fullNameEn}</div>
                      {e.suggested === "leave" && (
                        <div className="text-xs text-info">Approved leave</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div
                        className="join"
                        role="radiogroup"
                        aria-label={`Status of ${e.fullNameEn}`}
                      >
                        {DAILY_STATUSES.map((s) => (
                          <button
                            key={s}
                            type="button"
                            role="radio"
                            aria-checked={m.status === s}
                            title={humanize(s)}
                            disabled={!canEdit}
                            className={`btn btn-xs join-item ${m.status === s ? TONE[s] : "btn-ghost border-base-300"}`}
                            onClick={() => set(e.studentId, { status: s })}
                          >
                            {SHORT[s]}
                          </button>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-7 min-w-40"
                        maxLength={200}
                        disabled={!canEdit}
                        aria-label={`Remarks for ${e.fullNameEn}`}
                        value={m.remarks}
                        onChange={(ev) =>
                          set(e.studentId, { remarks: ev.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canCorrect && e.status && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              setCorrection({
                                kind: "daily",
                                studentId: e.studentId,
                                date: sheet.date,
                              })
                            }
                          >
                            <FilePenLineIcon /> Correct
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="ghost"
                          title="Mark history"
                          onClick={() =>
                            setHistory({
                              studentId: e.studentId,
                              date: sheet.date,
                              name: e.fullNameEn,
                            })
                          }
                        >
                          <HistoryIcon /> History
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            P present · A absent · L late · LV leave · H half day · E excused.
            Only the exceptions are sent; the rest are saved as present (or
            leave when approved leave covers the day). Only changed rows are
            written.
          </p>
        </>
      )}
      <HistoryDialog target={history} onClose={() => setHistory(null)} />
      <CorrectionDialog
        prefill={correction}
        onClose={() => setCorrection(null)}
      />
    </div>
  );
}

/** Dates, ids and URL params are read at request time, so the page streams behind a boundary (Cache Components). */
export default function DailyRegisterPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DailyRegisterPageContent />
    </Suspense>
  );
}
