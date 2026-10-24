"use client";

import type { FieldDef } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { asBody, DAILY_STATUSES } from "@/components/sis/shared";
import { useAction } from "@/hooks/use-action";
import { api, type Body } from "@/lib/api";
import { todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

export type CorrectionPrefill = {
  kind?: "daily" | "period";
  studentId?: string;
  date?: string;
  periodDefinitionId?: string;
  newStatus?: string;
};

function correctionFields(p: CorrectionPrefill): FieldDef[] {
  return [
    {
      name: "kind",
      label: "Register",
      type: "select",
      options: ["daily", "period"],
      required: true,
      defaultValue: p.kind ?? "daily",
    },
    {
      name: "date",
      label: "Date",
      type: "date",
      required: true,
      defaultValue: p.date ?? todayISO(),
    },
    {
      name: "studentId",
      label: "Student",
      type: "ref",
      ref: refs.students,
      required: true,
      wide: true,
      defaultValue: p.studentId ?? "",
    },
    {
      name: "periodDefinitionId",
      label: "Period",
      type: "ref",
      ref: refs.periods,
      defaultValue: p.periodDefinitionId ?? "",
      help: "Lesson (period) corrections only",
    },
    {
      name: "newStatus",
      label: "New status",
      type: "select",
      options: DAILY_STATUSES,
      required: true,
      defaultValue: p.newStatus ?? "",
      help: "A lesson mark is present, absent, late or excused",
    },
    {
      name: "reason",
      label: "Reason",
      type: "textarea",
      required: true,
      help: "At least 5 characters; the approver sees it",
    },
  ];
}

/**
 * Request a change to a daily or lesson mark after the edit window closed (POST /att/corrections). It is applied
 * when someone else approves it.
 */
export function CorrectionDialog({
  prefill,
  onClose,
}: {
  /** null = closed */
  prefill: CorrectionPrefill | null;
  onClose: () => void;
}) {
  const request = useAction(
    (body: Record<string, unknown>) => {
      const { periodDefinitionId, ...rest } = body;
      return api.att.corrections.request(
        asBody<Body<"/api/v1/att/corrections", "post">>(
          rest.kind === "period" ? { ...rest, periodDefinitionId } : rest,
        ),
      );
    },
    {
      invalidate: [
        ["att", "corrections"],
        ["att", "history"],
      ],
      toastError: false,
    },
  );
  return (
    <FormDialog
      open={Boolean(prefill)}
      onOpenChange={(open) => !open && onClose()}
      title="Request a correction"
      description="The edit window of this date has closed. Someone with approval rights applies the change."
      fields={correctionFields(prefill ?? {})}
      submitLabel="Send request"
      successMessage="Correction requested"
      onSubmit={(body) => request.mutateAsync(body)}
    />
  );
}
