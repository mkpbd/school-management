"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

export default function YearGroupsPage() {
  return (
    <ResourcePage
      title="Year groups"
      description="Classes within a programme (Play, Nursery, Class 1 … Class 10). Promotion follows “next year group”."
      queryKey="aca.yearGroups"
      entity="year group"
      resource={api.aca.yearGroups}
      searchable={false}
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
        { key: "seq", label: "#" },
        { key: "code", label: "Code", type: "mono" },
        { key: "nameEn", label: "Name" },
        { key: "nameBn", label: "Name (Bangla)" },
        { key: "nextYearGroupId", label: "Promotes to", ref: refs.yearGroups },
        {
          key: "minAgeMonths",
          label: "Age (months)",
          render: (r) =>
            r.minAgeMonths || r.maxAgeMonths
              ? `${String(r.minAgeMonths ?? "?")}–${String(r.maxAgeMonths ?? "?")}`
              : "—",
        },
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
          name: "nextYearGroupId",
          label: "Promotes to",
          type: "ref",
          ref: refs.yearGroups,
          nullable: true,
        },
        {
          name: "minAgeMonths",
          label: "Min age (months)",
          type: "number",
          nullable: true,
        },
        {
          name: "maxAgeMonths",
          label: "Max age (months)",
          type: "number",
          nullable: true,
        },
      ]}
    />
  );
}
