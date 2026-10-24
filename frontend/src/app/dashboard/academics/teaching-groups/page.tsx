"use client";

import { UserPlusIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { MembersDialog } from "@/components/aca/members-dialog";
import { TeachersDialog } from "@/components/aca/teachers-dialog";
import { FormDialog } from "@/components/crud/form-dialog";
import { ResourcePage } from "@/components/crud/resource-page";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type Row } from "@/lib/api";
import { todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function TeachingGroupsPage() {
  const { data: me } = useMe();
  const [allocating, setAllocating] = useState<Row | null>(null);
  const [members, setMembers] = useState<Row | null>(null);
  const [teachers, setTeachers] = useState<Row | null>(null);
  const canAllocate = can(me, "aca.allocation.edit");

  const allocate = useAction(
    ({ id, body }: { id: string; body: Row }) =>
      api.aca.teachingGroups.setTeachers(id, body as never),
    {
      invalidate: [
        ["aca.teachingGroups"],
        ["aca.teacherLoad"],
        ["aca.groupTeachers"],
      ],
      toastError: false,
    },
  );

  return (
    <>
      <ResourcePage
        title="Teaching groups"
        description="Who is taught what: a whole section for a subject, or an explicit elective set across sections."
        queryKey="aca.teachingGroups"
        entity="teaching group"
        resource={api.aca.teachingGroups}
        searchable={false}
        permissions={{
          create: "aca.allocation.edit",
          edit: "aca.allocation.edit",
        }}
        filters={[
          {
            name: "academicYearId",
            label: "Years",
            type: "ref",
            ref: refs.academicYears,
          },
          {
            name: "yearGroupId",
            label: "Year groups",
            type: "ref",
            ref: refs.yearGroups,
          },
          {
            name: "classSectionId",
            label: "Sections",
            type: "ref",
            ref: refs.sections,
          },
          {
            name: "subjectId",
            label: "Subjects",
            type: "ref",
            ref: refs.subjects,
          },
        ]}
        columns={[
          { key: "name", label: "Name" },
          { key: "subjectId", label: "Subject", ref: refs.subjects },
          { key: "yearGroupId", label: "Year group", ref: refs.yearGroups },
          { key: "classSectionId", label: "Section", ref: refs.sections },
          { key: "membership", label: "Membership", type: "enum" },
          { key: "academicYearId", label: "Year", ref: refs.academicYears },
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
            name: "subjectId",
            label: "Subject",
            type: "ref",
            ref: refs.subjects,
            required: true,
            mode: "create",
          },
          {
            name: "membership",
            label: "Membership",
            type: "select",
            options: ["whole_section", "explicit"],
            required: true,
            mode: "create",
          },
          {
            name: "classSectionId",
            label: "Section",
            type: "ref",
            ref: refs.sections,
            mode: "create",
            help: "Required for whole-section groups",
            refFilter: (s, v) =>
              (!v.yearGroupId || s.yearGroupId === v.yearGroupId) &&
              (!v.academicYearId || s.academicYearId === v.academicYearId),
          },
          {
            name: "name",
            label: "Name",
            required: true,
            wide: true,
            placeholder: "Class 6 – A Mathematics",
          },
        ]}
        rowActions={(row) => (
          <>
            <Button
              variant="outline"
              size="xs"
              onClick={() => setTeachers(row)}
            >
              <UserPlusIcon /> Teachers
            </Button>
            {canAllocate && row.membership === "explicit" && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => setMembers(row)}
              >
                <UsersIcon /> Members
              </Button>
            )}
          </>
        )}
      />
      <FormDialog
        open={allocating !== null}
        onOpenChange={(open) => !open && setAllocating(null)}
        title={`Allocate a teacher to ${String(allocating?.name ?? "")}`}
        description="Replaces the current teacher in the same role from the chosen date (ACA-03)."
        fields={[
          {
            name: "staffId",
            label: "Teacher",
            type: "ref",
            ref: refs.staff,
            required: true,
            refFilter: (s) => s.staffType === "teaching",
          },
          {
            name: "role",
            label: "Role",
            type: "select",
            options: ["main", "assistant"],
            defaultValue: "main",
          },
          {
            name: "periodsPerWeek",
            label: "Periods per week",
            type: "number",
            defaultValue: "0",
            help: "0–40",
          },
          {
            name: "validFrom",
            label: "From",
            type: "date",
            defaultValue: todayISO(),
          },
        ]}
        submitLabel="Allocate"
        successMessage="Teacher allocated"
        onSubmit={(body) =>
          allocate.mutateAsync({ id: String(allocating!.id), body })
        }
      />
      <TeachersDialog
        group={teachers}
        canEdit={canAllocate}
        onClose={() => setTeachers(null)}
        onAllocate={(group) => {
          setTeachers(null);
          setAllocating(group);
        }}
      />
      <MembersDialog group={members} onClose={() => setMembers(null)} />
    </>
  );
}
