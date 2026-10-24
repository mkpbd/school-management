"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheckIcon, SaveIcon } from "lucide-react";
import { useState, Suspense } from "react";
import { toast } from "sonner";
import {
  dhakaInstant,
  explain,
  STAFF_STATUSES,
  toDhakaTime,
  type StaffDayStatus,
  type StaffSheet,
} from "@/components/att/shared";
import { RefSelect } from "@/components/crud/fields";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
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
import { formatDate, humanize, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

function StaffRegisterPageContent() {
  const [campusId, setCampusId] = useState("");
  const [date, setDate] = useState(todayISO);
  const query = { date, ...(campusId ? { campusId } : {}) };

  const sheet = useQuery({
    queryKey: ["att", "staffDaily", query],
    queryFn: () => api.att.staff.daily.get<StaffSheet>(query),
    retry: false,
  });

  return (
    <>
      <PageHeader
        title="Staff register"
        description="Daily attendance of the campus staff. Late, early leave and overtime are computed from the times."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="sm:w-64">
              <RefSelect
                source={refs.campuses}
                value={campusId}
                placeholder="Active campus"
                onChange={setCampusId}
              />
            </div>
            <Input
              type="date"
              className="sm:w-44"
              aria-label="Date"
              max={todayISO()}
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </div>
          {sheet.isPending ? (
            <Loading />
          ) : sheet.isError ? (
            <ErrorAlert error={new Error(explain(sheet.error))} />
          ) : (
            <StaffRegisterEditor
              key={`${campusId}:${date}:${sheet.dataUpdatedAt}`}
              sheet={sheet.data.data}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

type Row = {
  status: StaffDayStatus | "";
  checkIn: string;
  checkOut: string;
  overtime: string;
};

function StaffRegisterEditor({ sheet }: { sheet: StaffSheet }) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const canEdit = can(me, "att.staff.edit");
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      sheet.rows.map((r) => [
        r.staffId,
        {
          status: r.day?.status ?? "",
          checkIn: toDhakaTime(r.day?.checkInAt),
          checkOut: toDhakaTime(r.day?.checkOutAt),
          overtime: "",
        },
      ]),
    ),
  );
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const set = (staffId: string, patch: Partial<Row>) =>
    setRows((all) => ({ ...all, [staffId]: { ...all[staffId]!, ...patch } }));
  const marked = sheet.rows.filter((r) => rows[r.staffId]!.status !== "");

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      const { data } = await api.att.staff.daily.mark<{ saved: number }>(
        { date: sheet.date, campusId: sheet.campusId },
        {
          entries: marked.map((r) => {
            const v = rows[r.staffId]!;
            return {
              staffId: r.staffId,
              status: v.status as StaffDayStatus,
              ...(v.checkIn
                ? { checkInAt: dhakaInstant(sheet.date, v.checkIn) }
                : {}),
              ...(v.checkOut
                ? { checkOutAt: dhakaInstant(sheet.date, v.checkOut) }
                : {}),
              ...(v.overtime !== ""
                ? {
                    overtimeMinutes: Math.max(
                      0,
                      Math.round(Number(v.overtime)),
                    ),
                  }
                : {}),
            };
          }),
        },
        { idempotencyKey },
      );
      toast.success(`Saved ${data.saved} staff`);
      setIdempotencyKey(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ["att", "staffDaily"] });
    } catch (err) {
      setProblem(explain(err, "Could not save the staff register."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{formatDate(sheet.date)}</CardTitle>
            <CardDescription>
              {sheet.rows.length} staff · {marked.length} marked
              {!sheet.schoolDay && " · not a school day"}
            </CardDescription>
          </div>
          {canEdit && sheet.rows.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setRows((all) =>
                    Object.fromEntries(
                      Object.entries(all).map(([id, v]) => [
                        id,
                        v.status ? v : { ...v, status: "present" as const },
                      ]),
                    ),
                  )
                }
              >
                <CheckCheckIcon /> Unmarked → present
              </Button>
              <Button onClick={save} disabled={busy || marked.length === 0}>
                {busy ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <SaveIcon />
                )}
                Save ({marked.length})
              </Button>
            </div>
          )}
        </CardHeader>
      </Card>
      {!sheet.schoolDay && (
        <div role="alert" className="alert alert-warning alert-soft text-sm">
          Not a school day (weekend or holiday). Mark only staff who worked (on
          duty / overtime).
        </div>
      )}
      {problem && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {problem}
        </div>
      )}
      {sheet.rows.length === 0 ? (
        <Empty>No staff on this campus on this date.</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Staff</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>In</TableHead>
              <TableHead>Out</TableHead>
              <TableHead>Overtime (min)</TableHead>
              <TableHead>Computed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sheet.rows.map((r) => {
              const v = rows[r.staffId]!;
              return (
                <TableRow key={r.staffId}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.staffNo}
                    </div>
                  </TableCell>
                  <TableCell>
                    <select
                      aria-label={`Status of ${r.name}`}
                      className="select select-sm h-7 w-36"
                      disabled={!canEdit}
                      value={v.status}
                      onChange={(e) =>
                        set(r.staffId, {
                          status: e.target.value as Row["status"],
                        })
                      }
                    >
                      <option value="">Not marked</option>
                      {STAFF_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {humanize(s)}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="time"
                      className="h-7 w-28"
                      aria-label={`Check-in of ${r.name}`}
                      disabled={!canEdit}
                      value={v.checkIn}
                      onChange={(e) =>
                        set(r.staffId, { checkIn: e.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="time"
                      className="h-7 w-28"
                      aria-label={`Check-out of ${r.name}`}
                      disabled={!canEdit}
                      value={v.checkOut}
                      onChange={(e) =>
                        set(r.staffId, { checkOut: e.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      max={1440}
                      className="h-7 w-24"
                      aria-label={`Overtime of ${r.name}`}
                      placeholder={
                        r.day ? String(r.day.overtimeMinutes) : "auto"
                      }
                      disabled={!canEdit}
                      value={v.overtime}
                      onChange={(e) =>
                        set(r.staffId, { overtime: e.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.day ? (
                      <>
                        {r.day.lateMinutes > 0 && (
                          <div>Late {r.day.lateMinutes} min</div>
                        )}
                        {r.day.earlyLeaveMinutes > 0 && (
                          <div>Early {r.day.earlyLeaveMinutes} min</div>
                        )}
                        {r.day.overtimeMinutes > 0 && (
                          <div>OT {r.day.overtimeMinutes} min</div>
                        )}
                        <div>{humanize(r.day.source)}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        Times are Asia/Dhaka. Leave overtime empty to compute it from the
        check-out time. Only marked rows are saved.
      </p>
    </div>
  );
}

/** Dates, ids and URL params are read at request time, so the page streams behind a boundary (Cache Components). */
export default function StaffRegisterPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StaffRegisterPageContent />
    </Suspense>
  );
}
