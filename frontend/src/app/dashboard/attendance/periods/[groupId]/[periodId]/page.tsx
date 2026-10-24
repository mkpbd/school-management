"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  CheckCheckIcon,
  FilePenLineIcon,
  HistoryIcon,
  LockIcon,
  SaveIcon,
} from "lucide-react";
import Link from "next/link";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useState, Suspense } from "react";
import { toast } from "sonner";
import {
  CorrectionDialog,
  type CorrectionPrefill,
} from "@/components/att/correction-dialog";
import { HistoryDialog } from "@/components/att/history-dialog";
import {
  explain,
  hhmm,
  PERIOD_STATUSES,
  SHORT,
  TONE,
  type MarkResult,
  type PeriodRegister,
  type PeriodStatus,
} from "@/components/att/shared";
import { Empty, Loading, PageHeader, StatusBadge } from "@/components/page";
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

function PeriodRegisterPageContent() {
  const { groupId, periodId } = useParams<{
    groupId: string;
    periodId: string;
  }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const date = params.get("date") ?? todayISO();

  const register = useQuery({
    queryKey: ["att", "period", groupId, periodId, date],
    queryFn: () =>
      api.att.periods.get<PeriodRegister>(groupId, periodId, { date }),
    retry: false,
  });

  return (
    <>
      <PageHeader
        title="Lesson register"
        description="Starts from the daily register (absent stays absent, leave becomes excused). Absent from a lesson while at school alerts the guardian."
        actions={
          <>
            <Input
              type="date"
              className="w-44"
              aria-label="Date"
              max={todayISO()}
              value={date}
              onChange={(e) =>
                e.target.value &&
                router.replace(`${pathname}?date=${e.target.value}`)
              }
            />
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/dashboard/attendance/my-day" />}
            >
              <ArrowLeftIcon /> My day
            </Button>
          </>
        }
      />
      <Card>
        <CardContent>
          {register.isPending ? (
            <Loading />
          ) : register.isError ? (
            <div role="alert" className="alert alert-error alert-soft text-sm">
              {explain(register.error, "Could not load the lesson register.")}
            </div>
          ) : (
            <PeriodEditor
              key={`${groupId}:${periodId}:${date}:${register.dataUpdatedAt}`}
              register={register.data.data}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function PeriodEditor({ register: r }: { register: PeriodRegister }) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const canEdit = can(me, "att.period.edit") && r.editable && r.periodWise;
  const canCorrect = can(me, "att.correction.create") && !r.editable;
  const [marks, setMarks] = useState<Record<string, PeriodStatus>>(() =>
    Object.fromEntries(
      r.entries.map((e) => [e.studentId, e.status ?? e.suggested]),
    ),
  );
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

  const exceptions = r.entries.filter(
    (e) => marks[e.studentId] !== e.suggested,
  );
  const counts = PERIOD_STATUSES.map(
    (s) => [s, Object.values(marks).filter((m) => m === s).length] as const,
  );

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      const { data } = await api.att.periods.mark<MarkResult>(
        r.teachingGroupId,
        r.period.id,
        {
          markRest: true,
          entries: exceptions.map((e) => ({
            studentId: e.studentId,
            status: marks[e.studentId]!,
          })),
        },
        { date: r.date },
        { idempotencyKey },
      );
      toast.success(
        `Saved: ${data.changed} changed, ${data.alerts} guardian alert${data.alerts === 1 ? "" : "s"}`,
      );
      setIdempotencyKey(crypto.randomUUID());
      await queryClient.invalidateQueries({
        queryKey: ["att", "period", r.teachingGroupId, r.period.id, r.date],
      });
      await queryClient.invalidateQueries({ queryKey: ["att", "myRegisters"] });
    } catch (err) {
      const message = explain(err, "Could not save the lesson register.");
      setProblem(message);
      toast.error(message);
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
              {r.groupName} · {r.period.label}
              {r.periodWise ? (
                <span className="badge badge-info badge-soft badge-sm">
                  Period-wise
                </span>
              ) : (
                <span className="badge badge-ghost badge-sm">Daily only</span>
              )}
              {!r.editable && (
                <span className="badge badge-ghost badge-sm gap-1">
                  <LockIcon className="size-3" /> Locked
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {formatDate(r.date)} · {hhmm(r.period.startsAt)}–
              {hhmm(r.period.endsAt)} · {r.entries.length} students ·{" "}
              {r.marked ? "already marked" : "not marked yet"} ·{" "}
              {r.editable
                ? `editable until ${formatDateTime(r.editableUntil)}`
                : `edit window closed ${formatDateTime(r.editableUntil)}`}
            </CardDescription>
          </div>
          {canEdit && r.entries.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setMarks(
                    Object.fromEntries(
                      r.entries.map((e) => [e.studentId, e.suggested]),
                    ),
                  )
                }
              >
                <CheckCheckIcon /> Reset to suggested
              </Button>
              <Button onClick={save} disabled={busy}>
                {busy ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <SaveIcon />
                )}
                Save ({exceptions.length} exception
                {exceptions.length === 1 ? "" : "s"}, rest as suggested)
              </Button>
            </div>
          )}
        </CardHeader>
      </Card>

      {!r.periodWise && (
        <div role="alert" className="alert alert-warning alert-soft text-sm">
          This year group takes daily attendance only (setting
          attendance.period_wise_year_groups); lessons are not marked.
        </div>
      )}
      {!r.editable && (
        <div role="alert" className="alert alert-soft text-sm">
          The edit window for this date has closed. The register is read-only
          {canCorrect
            ? "; use “Correct” on a marked student to ask for a change."
            : "."}
        </div>
      )}
      {problem && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {problem}
        </div>
      )}

      {r.entries.length === 0 ? (
        <Empty>No students in this teaching group on this date.</Empty>
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
                <TableHead>Daily</TableHead>
                <TableHead>Lesson</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.entries.map((e) => {
                const m = marks[e.studentId]!;
                return (
                  <TableRow key={e.studentId}>
                    <TableCell>{e.rollNo ?? "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{e.fullNameEn}</div>
                      {e.status === null && (
                        <div className="text-xs text-muted-foreground">
                          Suggested: {humanize(e.suggested)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {e.daily ? (
                        <StatusBadge status={e.daily} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div
                        className="join"
                        role="radiogroup"
                        aria-label={`Lesson status of ${e.fullNameEn}`}
                      >
                        {PERIOD_STATUSES.map((s) => (
                          <button
                            key={s}
                            type="button"
                            role="radio"
                            aria-checked={m === s}
                            title={humanize(s)}
                            disabled={!canEdit}
                            className={`btn btn-xs join-item ${m === s ? TONE[s] : "btn-ghost border-base-300"}`}
                            onClick={() =>
                              setMarks((all) => ({ ...all, [e.studentId]: s }))
                            }
                          >
                            {SHORT[s]}
                          </button>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canCorrect && e.status && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              setCorrection({
                                kind: "period",
                                studentId: e.studentId,
                                date: r.date,
                                periodDefinitionId: r.period.id,
                              })
                            }
                          >
                            <FilePenLineIcon /> Correct
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            setHistory({
                              studentId: e.studentId,
                              date: r.date,
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
            P present · A absent · L late · E excused. Only the exceptions are
            sent; the rest are saved as suggested from the daily register.
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
export default function PeriodRegisterPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PeriodRegisterPageContent />
    </Suspense>
  );
}
