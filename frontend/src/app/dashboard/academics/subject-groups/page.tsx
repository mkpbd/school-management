"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

export default function SubjectGroupsPage() {
  return (
    <ResourcePage
      title="Subject groups"
      description="Elective option blocks of a programme: students choose between min and max subjects from a block."
      queryKey="aca.subjectGroups"
      entity="subject group"
      resource={api.aca.subjectGroups}
      permissions={{
        create: "aca.structure.create",
        edit: "aca.structure.edit",
      }}
      filters={[
        {
          name: "programmeId",
          label: "Programmes",
          type: "ref",
          ref: refs.programmes,
        },
      ]}
      columns={[
        { key: "programmeId", label: "Programme", ref: refs.programmes },
        { key: "code", label: "Code", type: "mono" },
        { key: "nameEn", label: "Name" },
        { key: "minChoose", label: "Choose at least" },
        { key: "maxChoose", label: "Choose at most" },
      ]}
      fields={[
        {
          name: "programmeId",
          label: "Programme",
          type: "ref",
          ref: refs.programmes,
          required: true,
          mode: "create",
        },
        { name: "code", label: "Code", required: true, mode: "create" },
        { name: "nameEn", label: "Name", required: true, wide: true },
        {
          name: "minChoose",
          label: "Choose at least",
          type: "number",
          defaultValue: "1",
        },
        {
          name: "maxChoose",
          label: "Choose at most",
          type: "number",
          defaultValue: "1",
        },
        {
          name: "rules",
          label: "Rules (JSON)",
          type: "json",
          help: 'Incompatibilities / prerequisites, e.g. {"incompatible":[["PHY","BIO"]]}',
        },
      ]}
    />
  );
}
