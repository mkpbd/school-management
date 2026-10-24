"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

export default function ProgrammesPage() {
  return (
    <ResourcePage
      title="Programmes"
      description="Streams of study (Bangla medium, English version, Cambridge, Madrasah, ...)."
      queryKey="aca.programmes"
      entity="programme"
      resource={api.aca.programmes}
      searchable={false}
      permissions={{
        create: "aca.structure.create",
        edit: "aca.structure.edit",
      }}
      columns={[
        { key: "seq", label: "#" },
        { key: "code", label: "Code", type: "mono" },
        { key: "nameEn", label: "Name" },
        { key: "nameBn", label: "Name (Bangla)" },
        { key: "awardingBody", label: "Awarding body" },
        {
          key: "defaultGradingSchemeId",
          label: "Default grading",
          ref: refs.gradingSchemes,
        },
      ]}
      fields={[
        { name: "code", label: "Code", required: true, mode: "create" },
        {
          name: "seq",
          label: "Order",
          type: "number",
          required: true,
          mode: "create",
        },
        { name: "nameEn", label: "Name (English)", required: true },
        { name: "nameBn", label: "Name (Bangla)", nullable: true },
        {
          name: "awardingBody",
          label: "Awarding body",
          mode: "create",
          placeholder: "NCTB / Cambridge / ...",
        },
        {
          name: "defaultGradingSchemeId",
          label: "Default grading scheme",
          type: "ref",
          ref: refs.gradingSchemes,
          mode: "edit",
          nullable: true,
        },
      ]}
    />
  );
}
