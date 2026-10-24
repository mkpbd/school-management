"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState, Suspense } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel, RefSelect, type FieldDef } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { ConfirmButton, PageHeader, Loading } from "@/components/page";
import { asBody, lookups, type LeaveRow } from "@/components/sis/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type Body } from "@/lib/api";
import { formatDate, humanize, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

const STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;

const APPLY_FIELDS: FieldDef[] = [
  {
    name: "studentId",
    label: "Student",
    type: "ref",
    ref: refs.students,
    required: true,
    wide: true,
  },
  {
    name: "fromDate",
    label: "From",
    type: "date",
    required: true,
    defaultValue: todayISO(),
  },
  {
    name: "toDate",
    label: "To",
    type: "date",
    required: true,
    defaultValue: todayISO(),
  },
  {
    name: "reasonCode",
    label: "Reason",
    type: "ref",
    ref: lookups.leaveReasons,
    required: true,
  },
  { name: "reasonNote", label: "Note", type: "textarea" },
];

function LeavesPageContent() {
  const { data: me } = useMe();
  const [status, setStatus] = useState<(typeof STATUSES)[number] | "">(
    "pending",
  );
  const [studentId, setStudentId] = useState("");
  const [applying, setApplying] = useState(false);

  const query = {
    ...(status ? { status } : {}),
    ...(studentId ? { studentId } : {}),
  };
  const leaves = useQuery({
    queryKey: ["att", "leaves", query],
    queryFn: () => api.att.leaves.list<LeaveRow[]>(query),
  });

  const apply = useAction(
    (body: Record<string, unknown>) =>
      api.att.leaves.apply(
        asBody<Body<"/api/v1/att/student-leaves", "post">>(body),
      ),
    { invalidate: [["att", "leaves"]], toastError: false },
  );
  const decide = useAction(
    ({ id, decision }: { id: string; decision: "approved" | "rejected" }) =>
      api.att.leaves.decide<{ status: string; daysMarked: number }>(id, {
        decision,
      }),
    {
      invalidate: [
        ["att", "leaves"],
        ["att", "daily"],
      ],
      success: (r) =>
        r.data.status === "approved"
          ? `Approved: ${r.data.daysMarked} school day(s) marked as leave`
          : "Rejected",
    },
  );
  const canApprove = can(me, "att.student_leave.approve");

  return (
    <>
      <PageHeader
        title="Leave requests"
        description="Approval marks the school days in the range as leave on the register."
        actions={
          can(me, "att.student_leave.create") && (
            <Button onClick={() => setApplying(true)}>
              <PlusIcon /> Apply for leave
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              aria-label="Status"
              className="select select-sm h-8 sm:w-44"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
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
          </div>
          <DataTable<LeaveRow>
            rows={leaves.data?.data}
            isPending={leaves.isPending}
            error={leaves.error}
            empty="No leave requests."
            columns={[
              {
                key: "studentId",
                label: "Student",
                render: (r) => (
                  <Link
                    href={`/dashboard/students/${r.studentId}`}
                    className="link link-hover"
                  >
                    <RefLabel source={refs.students} id={r.studentId} />
                  </Link>
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
                key: "reasonCode",
                label: "Reason",
                render: (r) => (
                  <RefLabel source={lookups.leaveReasons} id={r.reasonCode} />
                ),
              },
              { key: "reasonNote", label: "Note" },
              { key: "status", label: "Status", type: "status" },
            ]}
            actions={
              canApprove
                ? (r) =>
                    r.status === "pending" ? (
                      <>
                        <ConfirmButton
                          size="xs"
                          title="Approve this leave?"
                          description="The school days in the range are marked as leave."
                          confirmLabel="Approve"
                          onConfirm={() =>
                            decide.mutateAsync({
                              id: r.id,
                              decision: "approved",
                            })
                          }
                        >
                          <CheckIcon /> Approve
                        </ConfirmButton>
                        <ConfirmButton
                          size="xs"
                          destructive
                          title="Reject this leave?"
                          confirmLabel="Reject"
                          onConfirm={() =>
                            decide.mutateAsync({
                              id: r.id,
                              decision: "rejected",
                            })
                          }
                        >
                          <XIcon /> Reject
                        </ConfirmButton>
                      </>
                    ) : null
                : undefined
            }
          />
        </CardContent>
      </Card>
      <FormDialog
        open={applying}
        onOpenChange={setApplying}
        title="Apply for leave"
        fields={APPLY_FIELDS}
        submitLabel="Apply"
        successMessage="Leave requested"
        onSubmit={(body) => apply.mutateAsync(body)}
      />
    </>
  );
}

/** Dates, ids and URL params are read at request time, so the page streams behind a boundary (Cache Components). */
export default function LeavesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LeavesPageContent />
    </Suspense>
  );
}
