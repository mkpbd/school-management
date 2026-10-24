"use client";

import { StarIcon } from "lucide-react";
import { ResourcePage } from "@/components/crud/resource-page";
import { ConfirmButton } from "@/components/page";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";

const STATUSES = ["planned", "open", "closing", "locked", "archived"] as const;

export default function AcademicYearsPage() {
  const { data: me } = useMe();
  const makeCurrent = useAction(
    (id: string) => api.core.academicYears.makeCurrent(id),
    {
      success: "Current academic year changed",
      invalidate: [["core.academicYears"]],
    },
  );

  return (
    <ResourcePage
      title="Academic years"
      description="Only an open year can be made current."
      queryKey="core.academicYears"
      entity="academic year"
      resource={api.core.academicYears}
      permissions={{ create: "core.year.create", edit: "core.year.edit" }}
      filters={[
        { name: "status", label: "Status", type: "select", options: STATUSES },
      ]}
      columns={[
        { key: "code", label: "Code", type: "mono" },
        { key: "startsOn", label: "Starts", type: "date" },
        { key: "endsOn", label: "Ends", type: "date" },
        { key: "status", label: "Status", type: "status" },
        { key: "isCurrent", label: "Current", type: "bool" },
      ]}
      fields={[
        { name: "code", label: "Code", required: true, placeholder: "2026" },
        { name: "status", label: "Status", type: "select", options: STATUSES },
        { name: "startsOn", label: "Starts on", type: "date", required: true },
        { name: "endsOn", label: "Ends on", type: "date", required: true },
      ]}
      rowActions={(row) =>
        !row.isCurrent &&
        row.status === "open" &&
        can(me, "core.year.approve") ? (
          <ConfirmButton
            size="xs"
            title={`Make ${String(row.code)} the current year?`}
            description="Attendance, billing and enrolment defaults switch to this year."
            onConfirm={() => makeCurrent.mutateAsync(String(row.id))}
          >
            <StarIcon /> Make current
          </ConfirmButton>
        ) : null
      }
    />
  );
}
