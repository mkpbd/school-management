"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BanIcon,
  CheckCheckIcon,
  ClipboardCheckIcon,
  PlusIcon,
  UserPlusIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel, RefSelect } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { ConfirmButton, PageHeader, StatusBadge } from "@/components/page";
import {
  CPD_SESSION_STATUSES,
  dhakaInstant,
  hours,
  type CpdSession,
  type CpdSessionStatus,
} from "@/components/hrm/cpd";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type Row } from "@/lib/api";
import { formatDateTime, humanize } from "@/lib/format";
import { refs, type RefSource } from "@/lib/refs";

/** Option source of the staff registered for one session (attendance can only be marked for them). */
const registrants = (sessionId: string): RefSource => ({
  key: `cpdRegistrations:${sessionId}`,
  load: async () =>
    (
      await api.hrm.cpdSessions.registrations<
        Array<{
          staffId: string;
          staffNo: string;
          name: string;
          status: string;
        }>
      >(sessionId)
    ).data
      .filter((r) => r.status !== "cancelled")
      .map((r) => ({ ...r, id: r.staffId })),
  label: (r) =>
    `${String(r.name)} (${String(r.staffNo)})${r.status === "registered" ? "" : ` - ${String(r.status)}`}`,
});

type SessionDialog =
  | { kind: "schedule" }
  | { kind: "register" | "attendance" | "cancel"; session: CpdSession };

const INVALIDATE = [["hrm.cpdSessions"], ["hrm.cpd"], ["hrm.cpdSummary"]];

export default function CpdSessionsPage() {
  const { data: me } = useMe();
  const [status, setStatus] = useState<"" | CpdSessionStatus>("scheduled");
  const [campusId, setCampusId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dialog, setDialog] = useState<SessionDialog | null>(null);
  const query = {
    ...(status ? { status } : {}),
    ...(campusId ? { campusId } : {}),
    ...(from ? { from: dhakaInstant(from, "00:00") } : {}),
    ...(to ? { to: dhakaInstant(to, "23:59") } : {}),
  };
  const sessions = useQuery({
    queryKey: ["hrm.cpdSessions", query],
    queryFn: () => api.hrm.cpdSessions.list<CpdSession[]>(query),
  });
  const canManage = can(me, "hrm.cpd.create");
  const close = () => setDialog(null);

  const register = useAction((id: string) => api.hrm.cpdSessions.register(id), {
    success: "You are registered",
    invalidate: INVALIDATE,
  });
  const complete = useAction(
    (id: string) => api.hrm.cpdSessions.complete<{ records: number }>(id),
    {
      success: (r) =>
        `Session completed: ${r.data.records} CPD record(s) with certificates`,
      invalidate: INVALIDATE,
    },
  );
  const save = useAction(
    async ({ dialog, body }: { dialog: SessionDialog; body: Row }) => {
      switch (dialog.kind) {
        case "schedule":
          return api.hrm.cpdSessions.schedule({
            courseId: String(body.courseId),
            ...(body.campusId ? { campusId: String(body.campusId) } : {}),
            startsAt: dhakaInstant(String(body.date), String(body.startTime)),
            endsAt: dhakaInstant(
              String(body.endDate ?? body.date),
              String(body.endTime),
            ),
            ...(body.venue ? { venue: String(body.venue) } : {}),
            ...(body.trainer ? { trainer: String(body.trainer) } : {}),
            ...(body.capacity !== undefined
              ? { capacity: Number(body.capacity) }
              : {}),
          });
        case "register":
          return api.hrm.cpdSessions.register(dialog.session.id, {
            staffId: String(body.staffId),
          });
        case "attendance": {
          const ids = (key: string) =>
            Array.isArray(body[key]) ? (body[key] as string[]) : [];
          return api.hrm.cpdSessions.setAttendance(dialog.session.id, {
            entries: [
              ...ids("attended").map((staffId) => ({
                staffId,
                status: "attended" as const,
              })),
              ...ids("absent").map((staffId) => ({
                staffId,
                status: "absent" as const,
              })),
            ],
          });
        }
        case "cancel":
          return api.hrm.cpdSessions.cancel(dialog.session.id, {
            reason: String(body.reason),
          });
      }
    },
    { invalidate: INVALIDATE, toastError: false },
  );

  // "now" = when the list was loaded (pure render); the backend refuses late registrations anyway
  const now = sessions.dataUpdatedAt;
  const open = (s: CpdSession) => s.status === "scheduled";

  return (
    <>
      <PageHeader
        title="CPD sessions"
        description={
          <>
            Scheduled training sessions. Register for one, then it counts
            towards{" "}
            <Link className="link" href="/dashboard/hr/cpd/my">
              your CPD hours
            </Link>{" "}
            once it is completed.
          </>
        }
        actions={
          canManage && (
            <Button onClick={() => setDialog({ kind: "schedule" })}>
              <PlusIcon /> Schedule session
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <select
              aria-label="Status"
              className="select select-sm h-8 sm:w-40"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="">All statuses</option>
              {CPD_SESSION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
            <div className="sm:w-52">
              <RefSelect
                source={refs.campuses}
                value={campusId}
                placeholder="All campuses"
                onChange={setCampusId}
              />
            </div>
            <Input
              aria-label="From"
              type="date"
              className="h-8 sm:w-40"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              aria-label="To"
              type="date"
              className="h-8 sm:w-40"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <DataTable<CpdSession>
            rows={sessions.data?.data}
            isPending={sessions.isPending}
            error={sessions.error}
            empty="No sessions found."
            columns={[
              {
                key: "title",
                label: "Course",
                render: (s) => (
                  <div>
                    <div className="font-medium">{s.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {hours(s.hours)}
                      {s.trainer ? ` · ${s.trainer}` : ""}
                    </div>
                  </div>
                ),
              },
              { key: "startsAt", label: "Starts", type: "datetime" },
              { key: "endsAt", label: "Ends", type: "datetime" },
              { key: "venue", label: "Venue", render: (s) => s.venue ?? "—" },
              {
                key: "campusId",
                label: "Campus",
                render: (s) => (
                  <RefLabel source={refs.campuses} id={s.campusId} />
                ),
              },
              {
                key: "registered",
                label: "Registered",
                render: (s) => (
                  <span
                    className={`tabular-nums ${s.registered >= s.capacity ? "text-warning" : ""}`}
                  >
                    {s.registered} / {s.capacity}
                    {s.registered >= s.capacity && s.status === "scheduled"
                      ? " (full)"
                      : ""}
                  </span>
                ),
              },
              {
                key: "status",
                label: "Status",
                render: (s) => <StatusBadge status={s.status} />,
              },
            ]}
            actions={(s) =>
              open(s) ? (
                <>
                  {me?.staffId &&
                    Date.parse(s.startsAt) > now &&
                    s.registered < s.capacity && (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={register.isPending}
                        onClick={() => register.mutate(s.id)}
                      >
                        Register
                      </Button>
                    )}
                  {canManage && (
                    <>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Register a staff member"
                        title="Register a staff member"
                        onClick={() =>
                          setDialog({ kind: "register", session: s })
                        }
                      >
                        <UserPlusIcon />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Mark attendance"
                        title="Mark attendance"
                        onClick={() =>
                          setDialog({ kind: "attendance", session: s })
                        }
                      >
                        <ClipboardCheckIcon />
                      </Button>
                      <ConfirmButton
                        variant="ghost"
                        size="icon-sm"
                        title={`Complete "${s.title}"?`}
                        description={`Everyone marked attended gets ${hours(s.hours)} of verified CPD and a certificate number. The session can no longer change.`}
                        confirmLabel="Complete"
                        onConfirm={() => complete.mutateAsync(s.id)}
                      >
                        <CheckCheckIcon />
                      </ConfirmButton>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Cancel session"
                        title="Cancel session"
                        onClick={() =>
                          setDialog({ kind: "cancel", session: s })
                        }
                      >
                        <BanIcon className="text-destructive" />
                      </Button>
                    </>
                  )}
                </>
              ) : null
            }
          />
        </CardContent>
      </Card>

      <FormDialog
        open={dialog?.kind === "schedule"}
        onOpenChange={(o) => !o && close()}
        title="Schedule session"
        description="Times are Asia/Dhaka. Staff can register until the session starts."
        submitLabel="Schedule"
        successMessage="Session scheduled"
        fields={[
          {
            name: "courseId",
            label: "Course",
            type: "ref",
            ref: refs.cpdCourses,
            refFilter: (r) => r.isActive !== false,
            required: true,
            wide: true,
          },
          {
            name: "campusId",
            label: "Campus",
            type: "ref",
            ref: refs.campuses,
            help: "Defaults to the active campus",
          },
          {
            name: "capacity",
            label: "Capacity",
            type: "number",
            placeholder: "30",
            help: "Places (1–500, default 30)",
          },
          { name: "date", label: "Date", type: "date", required: true },
          {
            name: "endDate",
            label: "End date",
            type: "date",
            help: "Only if it runs over several days",
          },
          {
            name: "startTime",
            label: "Starts at",
            type: "time",
            required: true,
          },
          { name: "endTime", label: "Ends at", type: "time", required: true },
          { name: "venue", label: "Venue" },
          { name: "trainer", label: "Trainer" },
        ]}
        onSubmit={(body) =>
          save.mutateAsync({ dialog: { kind: "schedule" }, body })
        }
      />

      {dialog && dialog.kind !== "schedule" && (
        <FormDialog
          open
          onOpenChange={(o) => !o && close()}
          {...SESSION_DIALOGS[dialog.kind](dialog.session)}
          onSubmit={(body) => save.mutateAsync({ dialog, body })}
        />
      )}
    </>
  );
}

const SESSION_DIALOGS = {
  register: (s: CpdSession) => ({
    title: "Register a staff member",
    description: `${s.title} · ${formatDateTime(s.startsAt)} · ${s.registered} / ${s.capacity} registered`,
    submitLabel: "Register",
    successMessage: "Registered",
    fields: [
      {
        name: "staffId",
        label: "Staff member",
        type: "ref" as const,
        ref: refs.staff,
        required: true,
        wide: true,
      },
    ],
  }),
  attendance: (s: CpdSession) => ({
    title: "Mark attendance",
    description: `${s.title} · ${formatDateTime(s.startsAt)}. Mark the registered staff; complete the session afterwards to issue CPD hours.`,
    submitLabel: "Save attendance",
    successMessage: "Attendance saved",
    fields: [
      {
        name: "attended",
        label: "Attended",
        type: "refs" as const,
        ref: registrants(s.id),
      },
      {
        name: "absent",
        label: "Absent",
        type: "refs" as const,
        ref: registrants(s.id),
      },
    ],
  }),
  cancel: (s: CpdSession) => ({
    title: "Cancel session",
    description: `${s.title} · ${formatDateTime(s.startsAt)}. The ${s.registered} registered staff member(s) are notified with the reason.`,
    submitLabel: "Cancel session",
    successMessage: "Session cancelled",
    fields: [
      {
        name: "reason",
        label: "Reason",
        type: "textarea" as const,
        required: true,
        help: "At least 3 characters; sent to the registered staff",
      },
    ],
  }),
};
