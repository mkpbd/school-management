"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";

const KINDS = [
  "core",
  "optional",
  "elective",
  "co_curricular",
  "religious",
  "language",
] as const;

export default function SubjectsPage() {
  return (
    <ResourcePage
      title="Subjects"
      description="Subject master. Year-group specifics (periods per week, grading) live in the curriculum."
      queryKey="aca.subjects"
      entity="subject"
      resource={api.aca.subjects}
      permissions={{
        create: "aca.structure.create",
        edit: "aca.structure.edit",
      }}
      filters={[
        { name: "kind", label: "Kinds", type: "select", options: KINDS },
      ]}
      columns={[
        { key: "code", label: "Code", type: "mono" },
        { key: "nameEn", label: "Name" },
        { key: "nameBn", label: "Name (Bangla)" },
        { key: "kind", label: "Kind", type: "enum" },
        { key: "externalCode", label: "Board code", type: "mono" },
        { key: "isGraded", label: "Graded", type: "bool" },
      ]}
      fields={[
        { name: "code", label: "Code", required: true, mode: "create" },
        {
          name: "kind",
          label: "Kind",
          type: "select",
          options: KINDS,
          required: true,
          mode: "create",
        },
        { name: "nameEn", label: "Name (English)", required: true },
        { name: "nameBn", label: "Name (Bangla)", nullable: true },
        {
          name: "externalCode",
          label: "Board code",
          nullable: true,
          help: "e.g. NCTB / Cambridge subject code",
        },
        {
          name: "isGraded",
          label: "Graded",
          type: "boolean",
          defaultValue: true,
        },
      ]}
    />
  );
}
