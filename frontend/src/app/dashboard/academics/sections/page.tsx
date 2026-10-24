"use client";

import { WandSparklesIcon } from "lucide-react";
import { ResourcePage } from "@/components/crud/resource-page";
import { ConfirmButton } from "@/components/page";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

export default function SectionsPage() {
  const { data: me } = useMe();
  const generate = useAction(
    (id: string) =>
      api.aca.sections.generateTeachingGroups<{ created: number }>(id),
    {
      success: (r) => `${r.data.created} teaching group(s) created`,
      invalidate: [["aca.teachingGroups"]],
    },
  );

  return (
    <ResourcePage
      title="Class sections"
      description="A year group in one academic year and campus (Class 6 – A). Holds capacity, class teacher and home room."
      queryKey="aca.sections"
      entity="section"
      resource={api.aca.sections}
      searchable={false}
      permissions={{
        create: "aca.structure.create",
        edit: "aca.structure.edit",
      }}
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
          name: "yearGroupId",
          label: "Year groups",
          type: "ref",
          ref: refs.yearGroups,
        },
      ]}
      columns={[
        { key: "displayName", label: "Section" },
        { key: "yearGroupId", label: "Year group", ref: refs.yearGroups },
        { key: "academicYearId", label: "Year", ref: refs.academicYears },
        { key: "campusId", label: "Campus", ref: refs.campuses },
        { key: "shiftId", label: "Shift", ref: refs.shifts },
        { key: "classTeacherStaffId", label: "Class teacher", ref: refs.staff },
        { key: "capacity", label: "Capacity" },
        { key: "genderPolicy", label: "Gender", type: "enum" },
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
        {
          name: "yearGroupId",
          label: "Year group",
          type: "ref",
          ref: refs.yearGroups,
          required: true,
          mode: "create",
        },
        {
          name: "name",
          label: "Short name",
          required: true,
          mode: "create",
          placeholder: "A",
        },
        {
          name: "displayName",
          label: "Display name",
          required: true,
          placeholder: "Class 6 – A",
        },
        { name: "capacity", label: "Capacity", type: "number", required: true },
        {
          name: "genderPolicy",
          label: "Gender policy",
          type: "select",
          options: ["mixed", "boys", "girls"],
          mode: "create",
        },
        {
          name: "shiftId",
          label: "Shift",
          type: "ref",
          ref: refs.shifts,
          nullable: true,
        },
        {
          name: "classTeacherStaffId",
          label: "Class teacher",
          type: "ref",
          ref: refs.staff,
          nullable: true,
        },
        {
          name: "headOfSectionStaffId",
          label: "Head of section",
          type: "ref",
          ref: refs.staff,
          nullable: true,
        },
        {
          name: "homeRoomId",
          label: "Home room",
          type: "ref",
          ref: refs.rooms,
          nullable: true,
        },
      ]}
      rowActions={(row) =>
        can(me, "aca.allocation.edit") ? (
          <ConfirmButton
            size="xs"
            title={`Generate teaching groups for ${String(row.displayName)}?`}
            description="Creates one whole-section group per compulsory curriculum subject that has none yet. Safe to repeat."
            confirmLabel="Generate"
            onConfirm={() => generate.mutateAsync(String(row.id))}
          >
            <WandSparklesIcon /> Teaching groups
          </ConfirmButton>
        ) : null
      }
    />
  );
}
