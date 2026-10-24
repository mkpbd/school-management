"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { FormDialog } from "@/components/crud/form-dialog";
import { ResourcePage } from "@/components/crud/resource-page";
import { StudentPicker, useStudent360 } from "@/components/fee/student-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type StudentListItem } from "@/lib/api";
import { todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

/**
 * Per-student charges on top of the fee structure (transport, hostel, ...), billed with the monthly run.
 * Items hang off an enrolment: pick a student to see and add items for their current enrolment.
 */
export default function StudentFeeItemsPage() {
  const { data: me } = useMe();
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [creating, setCreating] = useState(false);
  const s360 = useStudent360(student?.id);
  // current placement, or the latest active one (future-dated enrolments)
  const enrolmentId =
    s360.data?.currentEnrolment?.id ??
    s360.data?.enrolmentHistory.find((e) => e.status === "active")?.id;

  const create = useAction(
    (body: Record<string, unknown>) =>
      api.fee.studentItems.create({
        ...(body as {
          feeHeadId: string;
          amountPaisa: number;
          validFrom: string;
        }),
        enrolmentId: enrolmentId!,
      }),
    { invalidate: [["fee.studentItems"]], toastError: false },
  );
  const canEdit = can(me, "fee.structure.edit");

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 sm:grid-cols-[minmax(0,24rem)_1fr] sm:items-end">
          <div className="space-y-1.5">
            <Label>Student</Label>
            <StudentPicker value={student} onChange={setStudent} />
          </div>
          <p className="text-sm text-muted-foreground">
            {!student
              ? "Showing all items. Pick a student to filter and to add items."
              : s360.isPending
                ? "Loading enrolment…"
                : enrolmentId
                  ? "Showing items of the active enrolment."
                  : "This student has no active enrolment."}
          </p>
        </CardContent>
      </Card>

      <ResourcePage
        key={enrolmentId ?? "all"}
        title="Student fee items"
        description="Extra recurring or one-off charges for one student, added to their monthly invoices."
        queryKey="fee.studentItems"
        entity="student fee item"
        searchable={false}
        resource={{
          list: api.fee.studentItems.list,
          update: api.fee.studentItems.update,
          remove: api.fee.studentItems.remove,
        }}
        baseQuery={enrolmentId ? { enrolmentId } : {}}
        permissions={{
          edit: "fee.structure.edit",
          delete: "fee.structure.edit",
        }}
        filters={[
          {
            name: "feeHeadId",
            label: "Fee heads",
            type: "ref",
            ref: refs.feeHeads,
          },
        ]}
        columns={[
          {
            key: "enrolmentId",
            label: "Enrolment",
            type: "mono",
            render: (r) => (
              <span className="font-mono text-xs">
                {String(r.enrolmentId).slice(0, 8)}…
              </span>
            ),
          },
          { key: "feeHeadId", label: "Fee head", ref: refs.feeHeads },
          {
            key: "amountPaisa",
            label: "Amount",
            type: "money",
            className: "text-right",
          },
          {
            key: "billingMonths",
            label: "Months",
            render: (r) =>
              Array.isArray(r.billingMonths) && r.billingMonths.length
                ? r.billingMonths.join(", ")
                : "Every month",
          },
          { key: "validFrom", label: "From", type: "date" },
          { key: "validTo", label: "To", type: "date" },
          { key: "sourceModule", label: "Source", type: "mono" },
        ]}
        fields={[
          {
            name: "amountPaisa",
            label: "Amount",
            type: "money",
            required: true,
          },
          { name: "validTo", label: "Valid to", type: "date", nullable: true },
        ]}
        actions={
          canEdit && (
            <Button disabled={!enrolmentId} onClick={() => setCreating(true)}>
              <PlusIcon /> New student fee item
            </Button>
          )
        }
      />

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title="New student fee item"
        description={
          student
            ? `For ${student.fullNameEn} (${student.admissionNo}), active enrolment.`
            : undefined
        }
        fields={[
          {
            name: "feeHeadId",
            label: "Fee head",
            type: "ref",
            ref: refs.feeHeads,
            required: true,
          },
          {
            name: "amountPaisa",
            label: "Amount",
            type: "money",
            required: true,
          },
          {
            name: "validFrom",
            label: "Valid from",
            type: "date",
            required: true,
            defaultValue: todayISO(),
          },
          { name: "validTo", label: "Valid to", type: "date" },
          {
            name: "billingMonths",
            label: "Billing months",
            type: "numbers",
            wide: true,
            placeholder: "e.g. 1, 2, 3",
            help: "Months of the academic year (1–12). Empty: every month.",
          },
        ]}
        onSubmit={(body) => create.mutateAsync(body)}
      />
    </div>
  );
}
