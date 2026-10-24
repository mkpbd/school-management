"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCheckIcon,
  DoorOpenIcon,
  MoonIcon,
  SaveIcon,
  SunIcon,
} from "lucide-react";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import {
  HostelSelect,
  ROLL_SESSIONS,
  ROLL_SHORT,
  ROLL_STATUSES,
  ROLL_TONE,
  useUrlState,
} from "@/components/hst/shared";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import type {
  RollSession,
  RollSheet,
  RollStatus,
} from "@/lib/api/services/hst";
import { formatDate, formatDateTime, humanize, todayISO } from "@/lib/format";

export default function RollCallPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RollCallView />
    </Suspense>
  );
}

/** Morning before school, night after lights-out (Dhaka time). */
function defaultSession(): RollSession {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dhaka",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
  return hour >= 15 || hour < 3 ? "night" : "morning";
}

function RollCallView() {
  const [{ hostelId, date, session }, setUrl] = useUrlState({
    hostelId: "",
    date: todayISO(),
    session: defaultSession(),
  });
  const sheet = useQuery({
    queryKey: ["hst.roll", hostelId, date, session],
    queryFn: async () =>
      (
        await api.hst.hostels.rollCall(hostelId, {
          date,
          session: session as RollSession,
        })
      ).data,
    enabled: Boolean(hostelId),
  });

  return (
    <>
      <PageHeader
        title="Roll call"
        description="Morning and night register of the hostel. Residents out on a pass start as on leave; a new absent mark texts the guardian."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <HostelSelect
              value={hostelId}
              onChange={(id) => setUrl({ hostelId: id })}
            />
            <Input
              type="date"
              aria-label="Date"
              className="sm:w-44"
              max={todayISO()}
              value={date}
              onChange={(e) =>
                e.target.value && setUrl({ date: e.target.value })
              }
            />
            <div className="join">
              {ROLL_SESSIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`btn btn-sm join-item ${session === s ? "btn-primary" : "btn-ghost border-base-300"}`}
                  onClick={() => setUrl({ session: s })}
                >
                  {s === "morning" ? (
                    <SunIcon className="size-4" />
                  ) : (
                    <MoonIcon className="size-4" />
                  )}
                  {humanize(s)}
                </button>
              ))}
            </div>
          </div>
          {!hostelId ? (
            <Empty>Choose a hostel.</Empty>
          ) : sheet.isPending ? (
            <Loading />
          ) : sheet.isError ? (
            <ErrorAlert error={sheet.error} />
          ) : (
            // remount on every fresh sheet so the marks start from the server state
            <RollEditor
              key={`${hostelId}:${date}:${session}:${sheet.dataUpdatedAt}`}
              sheet={sheet.data}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

type Marks = Record<string, { status: RollStatus; note: string }>;

function RollEditor({ sheet }: { sheet: RollSheet }) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const canMark = can(me, "hst.roll_call.create") && sheet.date <= todayISO();
  const suggested = (r: RollSheet["rows"][number]): RollStatus =>
    r.outOnPass ? "on_leave" : "present";
  const [marks, setMarks] = useState<Marks>(() =>
    Object.fromEntries(
      sheet.rows.map((r) => [
        r.studentId,
        { status: r.mark?.status ?? suggested(r), note: r.mark?.note ?? "" },
      ]),
    ),
  );
  // one key per edit session: a retried save replays instead of texting guardians twice
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const marked = sheet.rows.filter((r) => r.mark).length;
  const lastMarked = sheet.rows.reduce<string | null>(
    (max, r) =>
      r.mark && (!max || r.mark.markedAt > max) ? r.mark.markedAt : max,
    null,
  );
  const out = sheet.rows.filter((r) => r.outOnPass).length;
  const counts = ROLL_STATUSES.map(
    (s) =>
      [s, Object.values(marks).filter((m) => m.status === s).length] as const,
  );
  const set = (studentId: string, patch: Partial<Marks[string]>) =>
    setMarks((m) => ({ ...m, [studentId]: { ...m[studentId]!, ...patch } }));

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      const { data } = await api.hst.hostels.markRollCall(
        sheet.hostelId,
        { date: sheet.date, session: sheet.session },
        {
          entries: sheet.rows.map((r) => {
            const m = marks[r.studentId]!;
            return {
              studentId: r.studentId,
              status: m.status,
              ...(m.note.trim() ? { note: m.note.trim() } : {}),
            };
          }),
        },
        { idempotencyKey },
      );
      toast.success(
        `Saved ${data.saved}; ${data.absentAlerts} guardian alert${data.absentAlerts === 1 ? "" : "s"}`,
      );
      setIdempotencyKey(crypto.randomUUID());
      await queryClient.invalidateQueries({
        queryKey: ["hst.roll", sheet.hostelId, sheet.date, sheet.session],
      });
    } catch (err) {
      setProblem(
        err instanceof Error ? err.message : "Could not save the roll call.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>
              {humanize(sheet.session)} roll call · {formatDate(sheet.date)}
            </CardTitle>
            <CardDescription>
              {sheet.rows.length} residents ·{" "}
              {marked
                ? `${marked} marked, last at ${formatDateTime(lastMarked)}`
                : "not marked yet"}
              {out > 0 && ` · ${out} out on a pass`}
            </CardDescription>
          </div>
          {canMark && sheet.rows.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setMarks(
                    Object.fromEntries(
                      sheet.rows.map((r) => [
                        r.studentId,
                        { status: suggested(r), note: "" },
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
                Save roll call
              </Button>
            </div>
          )}
        </CardHeader>
      </Card>
      {problem && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {problem}
        </div>
      )}
      {sheet.rows.length === 0 ? (
        <Empty>No residents on this date.</Empty>
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
                <TableHead className="w-24">Room / bed</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sheet.rows.map((r) => {
                const m = marks[r.studentId]!;
                return (
                  <TableRow key={r.studentId}>
                    <TableCell className="font-mono text-xs">
                      {r.roomCode} / {r.bedCode}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{r.studentName}</div>
                      {r.outOnPass && (
                        <div className="inline-flex items-center gap-1 text-xs text-info">
                          <DoorOpenIcon className="size-3" /> Out on a pass
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div
                        className="join"
                        role="radiogroup"
                        aria-label={`Status of ${r.studentName}`}
                      >
                        {ROLL_STATUSES.map((s) => (
                          <button
                            key={s}
                            type="button"
                            role="radio"
                            aria-checked={m.status === s}
                            title={humanize(s)}
                            disabled={!canMark}
                            className={`btn btn-xs join-item ${m.status === s ? ROLL_TONE[s] : "btn-ghost border-base-300"}`}
                            onClick={() => set(r.studentId, { status: s })}
                          >
                            {ROLL_SHORT[s]}
                          </button>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-7 min-w-40"
                        maxLength={200}
                        disabled={!canMark}
                        aria-label={`Note for ${r.studentName}`}
                        value={m.note}
                        onChange={(e) =>
                          set(r.studentId, { note: e.target.value })
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            P present · A absent · L late · LV on leave. The whole sheet is
            saved; re-saving does not text guardians again for students already
            marked absent.
          </p>
        </>
      )}
    </div>
  );
}
