"use client";

import { useRouter } from "next/navigation";
import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

export default function TimetablesPage() {
  const router = useRouter();
  return (
    <ResourcePage
      title="Timetables"
      description="Draft a timetable, fill its slots, then publish. Click a row to open it."
      queryKey="aca.timetables"
      entity="timetable"
      resource={api.aca.timetables}
      searchable={false}
      permissions={{ create: "aca.timetable.edit", edit: "aca.timetable.edit" }}
      onRowClick={(row) =>
        router.push(`/dashboard/academics/timetables/${String(row.id)}`)
      }
      filters={[
        {
          name: "academicYearId",
          label: "Years",
          type: "ref",
          ref: refs.academicYears,
        },
        {
          name: "campusId",
          label: "Campuses",
          type: "ref",
          ref: refs.campuses,
        },
        {
          name: "status",
          label: "Statuses",
          type: "select",
          options: ["draft", "published", "archived"],
        },
      ]}
      columns={[
        { key: "name", label: "Name" },
        { key: "academicYearId", label: "Year", ref: refs.academicYears },
        { key: "campusId", label: "Campus", ref: refs.campuses },
        { key: "effectiveFrom", label: "From", type: "date" },
        { key: "effectiveTo", label: "To", type: "date" },
        { key: "status", label: "Status", type: "status" },
      ]}
      fields={[
        {
          name: "campusId",
          label: "Campus",
          type: "ref",
          ref: refs.campuses,
          mode: "create",
          help: "Default: active campus",
        },
        {
          name: "academicYearId",
          label: "Academic year",
          type: "ref",
          ref: refs.academicYears,
          required: true,
          mode: "create",
        },
        { name: "name", label: "Name", required: true, wide: true },
        {
          name: "effectiveFrom",
          label: "Effective from",
          type: "date",
          required: true,
          mode: "create",
        },
        {
          name: "effectiveTo",
          label: "Effective to",
          type: "date",
          nullable: true,
        },
      ]}
    />
  );
}
