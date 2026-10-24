"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, PlusIcon, Undo2Icon, XIcon } from "lucide-react";
import { useState, Suspense } from "react";
import { APPLY_LEAVE_FIELDS, LeaveBalances } from "@/components/att/leave";
import {
  CORRECTION_STATUSES,
  type CorrectionStatus,
  type StaffLeaveRow,
} from "@/components/att/shared";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel, RefSelect, type FieldDef } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { ConfirmButton, Loading, PageHeader } from "@/components/page";
import { asBody } from "@/components/sis/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type Body } from "@/lib/api";
import { formatDate, humanize, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

const NOTE_FIELDS: FieldDef[] = [
  {
    name: "note",
    label: "Note",
    type: "textarea",
    help: "Shown to the applicant",
  },
];
const APPLY_FOR_FIELDS: FieldDef[] = [
  {
    name: "staffId",
    label: "Staff member",
    type: "ref",
    ref: refs.staff,
    required: true,
    wide: true,
  },
  ...APPLY_LEAVE_FIELDS,
];

function StaffLeavesPageContent() {
  const { data: me } = useMe();
  const [status, setStatus] = useState<CorrectionStatus | "">("pending");
  const [staffId, setStaffId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applying, setApplying] = useState(false);
  const [deciding, setDeciding] = useState<{
    row: StaffLeaveRow;
    decision: "approved" | "rejected";
  } | null>(null);
  const canApprove = can(me, "att.staff_leave.approve");

  const query = {
    ...(status ? { status } : {}),
    ...(staffId ? { staffId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    limit: 500,
  };
  const leaves = useQuery({
    queryKey: ["att", "staffLeaves", query],
    queryFn: () => api.att.staff.leaves.list<StaffLeaveRow[]>(query),
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
      api.att.staff.leaves.decide<{ status: string; daysMarked: number }>(id, {
        decision,
        ...(note ? { note } : {}),
      }),
    { invalidate: [["att"], ["hrm"]], toastError: false },
  );
  const cancel = useAction((id: string) => api.att.staff.leaves.cancel(id), {
    invalidate: [["att"]],
    success: "Leave cancelled; the days are returned",
  });
  const apply = useAction(
    (body: Record<string, unknown>) =>
      api.att.staff.leaves.apply<{ id: string; days: number }>(
        asBody<Body<"/api/v1/att/staff-leaves", "post">>(body),
      ),
    { invalidate: [["att"]], toastError: false },
  );

  return (
    <>
      <PageHeader
        title="Staff leave"
        description="Approval marks the days as leave on the staff register (payroll reads unpaid days from it). Nobody decides their own leave."
        actions={
          can(me, "att.staff_leave.create") && (
            <Button onClick={() => setApplying(true)}>
              <PlusIcon /> Apply for staff
            </Button>
          )
        }
      />
      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
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
                  source={refs.staff}
                  value={staffId}
                  placeholder="All staff"
                  onChange={setStaffId}
                />
              </div>
              <Input
                type="date"
                className="sm:w-44"
                aria-label="From"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <Input
                type="date"
                className="sm:w-44"
                aria-label="To"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <DataTable<StaffLeaveRow>
              rows={leaves.data?.data}
              isPending={leaves.isPending}
              error={leaves.error}
              empty="No leave requests."
              columns={[
                {
                  key: "staffId",
                  label: "Staff",
                  render: (r) => (
                    <RefLabel source={refs.staff} id={r.staffId} />
                  ),
                },
                {
                  key: "leaveCode",
                  label: "Type",
                  render: (r) => (
                    <>
                      <span className="font-medium">{r.leaveCode}</span>
                      {!r.isPaid && (
                        <span className="badge badge-ghost badge-sm ml-2">
                          Unpaid
                        </span>
                      )}
                    </>
                  ),
                },
                {
                  key: "fromDate",
                  label: "From",
                  render: (r) => formatDate(r.fromDate),
                },
                {
                  key: "toDate",
                  label: "To",
                  render: (r) => formatDate(r.toDate),
                },
                {
                  key: "days",
                  label: "Days",
                  render: (r) =>
                    `${Number(r.days)}${r.halfDay ? " (half)" : ""}`,
                },
                { key: "reason", label: "Reason" },
                { key: "status", label: "Status", type: "status" },
              ]}
              actions={(r) => {
                const own = r.staffId === me?.staffId;
                return (
                  <>
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
                    {(r.status === "pending" || r.status === "approved") &&
                      (canApprove || own) && (
                        <ConfirmButton
                          size="xs"
                          destructive
                          title="Cancel this leave?"
                          description="The days are returned to the balance and leave marks are removed."
                          confirmLabel="Cancel leave"
                          onConfirm={() => cancel.mutateAsync(r.id)}
                        >
                          <Undo2Icon /> Cancel
                        </ConfirmButton>
                      )}
                  </>
                );
              }}
            />
          </CardContent>
        </Card>
        {staffId && can(me, "att.staff_leave.view") && (
          <Card>
            <CardHeader>
              <CardTitle>
                Balances {todayISO().slice(0, 4)} ·{" "}
                <RefLabel source={refs.staff} id={staffId} />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LeaveBalances
                staffId={staffId}
                year={Number(todayISO().slice(0, 4))}
              />
            </CardContent>
          </Card>
        )}
      </div>
      <FormDialog
        open={Boolean(deciding)}
        onOpenChange={(open) => !open && setDeciding(null)}
        title={
          deciding?.decision === "approved" ? "Approve leave" : "Reject leave"
        }
        description={
          deciding
            ? `${deciding.row.leaveCode} · ${formatDate(deciding.row.fromDate)} – ${formatDate(deciding.row.toDate)} · ${Number(
                deciding.row.days,
              )} day(s)${deciding.decision === "approved" ? ". The days are marked as leave." : ""}`
            : undefined
        }
        fields={NOTE_FIELDS}
        submitLabel={deciding?.decision === "approved" ? "Approve" : "Reject"}
        successMessage={
          deciding?.decision === "approved"
            ? "Leave approved"
            : "Leave rejected"
        }
        onSubmit={(body) =>
          decide.mutateAsync({
            id: deciding!.row.id,
            decision: deciding!.decision,
            note: typeof body.note === "string" ? body.note : undefined,
          })
        }
      />
      <FormDialog
        open={applying}
        onOpenChange={setApplying}
        title="Apply for leave on behalf of staff"
        fields={APPLY_FOR_FIELDS}
        submitLabel="Apply"
        successMessage="Leave requested"
        onSubmit={(body) => apply.mutateAsync(body)}
      />
    </>
  );
}

/** Dates, ids and URL params are read at request time, so the page streams behind a boundary (Cache Components). */
export default function StaffLeavesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StaffLeavesPageContent />
    </Suspense>
  );
}
