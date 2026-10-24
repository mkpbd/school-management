"use client";

import { useQuery } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { useState, Suspense } from "react";
import {
  APPLY_LEAVE_FIELDS,
  LeaveBalances,
  LeaveTypesTable,
} from "@/components/att/leave";
import { explain, type StaffLeaveRow } from "@/components/att/shared";
import { DataTable } from "@/components/crud/data-table";
import { FormDialog } from "@/components/crud/form-dialog";
import { ConfirmButton, Loading, PageHeader } from "@/components/page";
import { asBody } from "@/components/sis/shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { useMe } from "@/hooks/use-me";
import { api, type Body } from "@/lib/api";
import { formatDate, todayISO } from "@/lib/format";

/** Applicant may cancel before the leave starts. */
const cancellable = (r: StaffLeaveRow) =>
  r.status === "pending" ||
  (r.status === "approved" && r.fromDate > todayISO());

function MyLeavePageContent() {
  const { data: me } = useMe();
  const [year, setYear] = useState(() => Number(todayISO().slice(0, 4)));
  const [applying, setApplying] = useState(false);
  const staffId = me?.staffId;

  const leaves = useQuery({
    queryKey: ["att", "staffLeaves", "mine", staffId],
    // with att.staff_leave.view the list is org-wide, so narrow it to the own staff record
    queryFn: () =>
      api.att.staff.leaves.list<StaffLeaveRow[]>(staffId ? { staffId } : {}),
    enabled: Boolean(me),
    retry: false,
  });

  const apply = useAction(
    (body: Record<string, unknown>) =>
      api.att.staff.leaves.apply<{ id: string; days: number }>(
        asBody<Body<"/api/v1/att/staff-leaves", "post">>(body),
      ),
    { invalidate: [["att"]], toastError: false },
  );
  const cancel = useAction((id: string) => api.att.staff.leaves.cancel(id), {
    invalidate: [["att"]],
    success: "Leave cancelled; the days are returned",
  });

  return (
    <>
      <PageHeader
        title="My leave"
        description="Balances per leave type, your requests and new applications. Days are counted on working days."
        actions={
          <Button onClick={() => setApplying(true)}>
            <PlusIcon /> Apply for leave
          </Button>
        }
      />
      <div className="space-y-6">
        <Card>
          <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Balances</CardTitle>
              <CardDescription>
                Entitlement + carried forward − taken − pending.
              </CardDescription>
            </div>
            <Input
              type="number"
              className="w-28"
              aria-label="Year"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </CardHeader>
          <CardContent>
            <LeaveBalances year={year} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>My requests</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable<StaffLeaveRow>
              rows={leaves.data?.data}
              isPending={leaves.isPending}
              error={leaves.error ? new Error(explain(leaves.error)) : null}
              empty="No leave requests yet."
              columns={[
                {
                  key: "leaveCode",
                  label: "Type",
                  render: (r) => (
                    <span className="font-medium">{r.leaveCode}</span>
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
                { key: "isPaid", label: "Paid", type: "bool" },
                { key: "reason", label: "Reason" },
                { key: "status", label: "Status", type: "status" },
              ]}
              actions={(r) =>
                cancellable(r) ? (
                  <ConfirmButton
                    size="xs"
                    destructive
                    title="Cancel this leave?"
                    description="The days are returned to your balance."
                    confirmLabel="Cancel leave"
                    onConfirm={() => cancel.mutateAsync(r.id)}
                  >
                    <XIcon /> Cancel
                  </ConfirmButton>
                ) : null
              }
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Leave types</CardTitle>
          </CardHeader>
          <CardContent>
            <LeaveTypesTable />
          </CardContent>
        </Card>
      </div>
      <FormDialog
        open={applying}
        onOpenChange={setApplying}
        title="Apply for leave"
        description="Approval marks the days as leave on the staff register."
        fields={APPLY_LEAVE_FIELDS}
        submitLabel="Apply"
        successMessage="Leave requested"
        onSubmit={(body) => apply.mutateAsync(body)}
      />
    </>
  );
}

/** Dates, ids and URL params are read at request time, so the page streams behind a boundary (Cache Components). */
export default function MyLeavePage() {
  return (
    <Suspense fallback={<Loading />}>
      <MyLeavePageContent />
    </Suspense>
  );
}
