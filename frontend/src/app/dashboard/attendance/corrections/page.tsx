"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  HistoryIcon,
  PlusIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { useState, Suspense } from "react";
import {
  CorrectionDialog,
  type CorrectionPrefill,
} from "@/components/att/correction-dialog";
import { HistoryDialog } from "@/components/att/history-dialog";
import {
  CORRECTION_STATUSES,
  type CorrectionRow,
  type CorrectionStatus,
} from "@/components/att/shared";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel, RefSelect, type FieldDef } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { ConfirmButton, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

const NOTE_FIELDS: FieldDef[] = [
  {
    name: "note",
    label: "Note",
    type: "textarea",
    help: "Shown to the requester",
  },
];

function CorrectionsPageContent() {
  const { data: me } = useMe();
  const canApprove = can(me, "att.correction.approve");
  const [status, setStatus] = useState<CorrectionStatus | "">("pending");
  const [studentId, setStudentId] = useState("");
  const [date, setDate] = useState("");
  const [mine, setMine] = useState(false);
  const [requesting, setRequesting] = useState<CorrectionPrefill | null>(null);
  const [deciding, setDeciding] = useState<{
    row: CorrectionRow;
    decision: "approved" | "rejected";
  } | null>(null);
  const [history, setHistory] = useState<{
    studentId: string;
    date: string;
    name: string;
  } | null>(null);

  const query = {
    ...(status ? { status } : {}),
    ...(studentId ? { studentId } : {}),
    ...(date ? { date } : {}),
    ...(mine ? { mine: "true" as const } : {}),
  };
  const list = useQuery({
    queryKey: ["att", "corrections", query],
    queryFn: () => api.att.corrections.list<CorrectionRow[]>(query),
  });

  const decide = useAction(
    ({
      id,
      decision,
      note,
    }: {
      id: string;
      decision: "approved" | "rejected";
      note?: string;
    }) =>
      api.att.corrections.decide<CorrectionRow>(id, {
        decision,
        ...(note ? { note } : {}),
      }),
    { invalidate: [["att"]], toastError: false },
  );
  const cancel = useAction((id: string) => api.att.corrections.cancel(id), {
    invalidate: [["att", "corrections"]],
    success: "Request withdrawn",
  });

  return (
    <>
      <PageHeader
        title="Attendance corrections"
        description="Changes to daily or lesson marks after the edit window. Approval applies the change (audited); nobody approves their own request."
        actions={
          can(me, "att.correction.create") && (
            <Button onClick={() => setRequesting({})}>
              <PlusIcon /> Request correction
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              aria-label="Status"
              className="select select-sm h-8 sm:w-44"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="">All statuses</option>
              {CORRECTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
            <div className="sm:w-72">
              <RefSelect
                source={refs.students}
                value={studentId}
                placeholder="All students"
                onChange={setStudentId}
              />
            </div>
            <Input
              type="date"
              className="sm:w-44"
              aria-label="Date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            {canApprove && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={mine}
                  onChange={(e) => setMine(e.target.checked)}
                />
                Only my requests
              </label>
            )}
          </div>
          <DataTable<CorrectionRow>
            rows={list.data?.data}
            isPending={list.isPending}
            error={list.error}
            empty="No correction requests."
            columns={[
              {
                key: "attendanceDate",
                label: "Date",
                render: (r) => formatDate(r.attendanceDate),
              },
              {
                key: "studentId",
                label: "Student",
                render: (r) =>
                  r.studentName ?? (
                    <RefLabel source={refs.students} id={r.studentId} />
                  ),
              },
              {
                key: "kind",
                label: "Register",
                render: (r) =>
                  r.kind === "daily" ? (
                    "Daily"
                  ) : (
                    <RefLabel source={refs.periods} id={r.periodDefinitionId} />
                  ),
              },
              {
                key: "newStatus",
                label: "Change",
                render: (r) => (
                  <span className="whitespace-nowrap">
                    {humanize(r.oldStatus)} → <b>{humanize(r.newStatus)}</b>
                  </span>
                ),
              },
              { key: "reason", label: "Reason" },
              { key: "requestedAt", label: "Requested", type: "datetime" },
              { key: "status", label: "Status", type: "status" },
              {
                key: "decisionNote",
                label: "Decision",
                render: (r) =>
                  r.decidedAt ? (
                    <>
                      <div className="text-xs">
                        {formatDateTime(r.decidedAt)}
                      </div>
                      {r.decisionNote && (
                        <div className="text-xs text-muted-foreground">
                          {r.decisionNote}
                        </div>
                      )}
                    </>
                  ) : (
                    "—"
                  ),
              },
            ]}
            actions={(r) => {
              const own = r.requestedBy === me?.id;
              return (
                <>
                  <Button
                    size="xs"
                    variant="ghost"
                    title="Mark history"
                    onClick={() =>
                      setHistory({
                        studentId: r.studentId,
                        date: r.attendanceDate,
                        name: r.studentName ?? "",
                      })
                    }
                  >
                    <HistoryIcon />
                  </Button>
                  {r.status === "pending" && canApprove && !own && (
                    <>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() =>
                          setDeciding({ row: r, decision: "approved" })
                        }
                      >
                        <CheckIcon /> Approve
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() =>
                          setDeciding({ row: r, decision: "rejected" })
                        }
                      >
                        <XIcon /> Reject
                      </Button>
                    </>
                  )}
                  {r.status === "pending" && own && (
                    <ConfirmButton
                      size="xs"
                      destructive
                      title="Withdraw this correction request?"
                      confirmLabel="Withdraw"
                      onConfirm={() => cancel.mutateAsync(r.id)}
                    >
                      <Undo2Icon /> Withdraw
                    </ConfirmButton>
                  )}
                </>
              );
            }}
          />
        </CardContent>
      </Card>
      <CorrectionDialog
        prefill={requesting}
        onClose={() => setRequesting(null)}
      />
      <FormDialog
        open={Boolean(deciding)}
        onOpenChange={(open) => !open && setDeciding(null)}
        title={
          deciding?.decision === "approved"
            ? "Approve correction"
            : "Reject correction"
        }
        description={
          deciding
            ? `${deciding.row.studentName ?? "Student"} · ${formatDate(deciding.row.attendanceDate)} · ${humanize(
                deciding.row.oldStatus,
              )} → ${humanize(deciding.row.newStatus)}${
                deciding.decision === "approved"
                  ? ". The mark is changed (source: correction)."
                  : ""
              }`
            : undefined
        }
        fields={NOTE_FIELDS}
        submitLabel={deciding?.decision === "approved" ? "Approve" : "Reject"}
        successMessage={
          deciding?.decision === "approved"
            ? "Approved and applied"
            : "Rejected"
        }
        onSubmit={(body) =>
          decide.mutateAsync({
            id: deciding!.row.id,
            decision: deciding!.decision,
            note: typeof body.note === "string" ? body.note : undefined,
          })
        }
      />
      <HistoryDialog target={history} onClose={() => setHistory(null)} />
    </>
  );
}

/** Dates, ids and URL params are read at request time, so the page streams behind a boundary (Cache Components). */
export default function CorrectionsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CorrectionsPageContent />
    </Suspense>
  );
}
