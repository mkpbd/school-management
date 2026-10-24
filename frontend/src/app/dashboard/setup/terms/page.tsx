"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

export default function TermsPage() {
  return (
    <ResourcePage
      title="Terms"
      description="Up to six terms per academic year."
      queryKey="core.terms"
      entity="term"
      resource={api.core.terms}
      permissions={{
        create: "core.year.create",
        edit: "core.year.edit",
        delete: "core.year.edit",
      }}
      filters={[
        {
          name: "academicYearId",
          label: "Years",
          type: "ref",
          ref: refs.academicYears,
        },
      ]}
      columns={[
        { key: "academicYearId", label: "Year", ref: refs.academicYears },
        { key: "seq", label: "#" },
        { key: "code", label: "Code", type: "mono" },
        { key: "nameEn", label: "Name" },
        { key: "startsOn", label: "Starts", type: "date" },
        { key: "endsOn", label: "Ends", type: "date" },
      ]}
      fields={[
        {
          name: "academicYearId",
          label: "Academic year",
          type: "ref",
          ref: refs.academicYears,
          required: true,
          mode: "create",
        },
        {
          name: "seq",
          label: "Sequence",
          type: "number",
          required: true,
          mode: "create",
          help: "1–6",
        },
        { name: "code", label: "Code", required: true, mode: "create" },
        { name: "nameEn", label: "Name (English)", required: true },
        { name: "nameBn", label: "Name (Bangla)", nullable: true },
        { name: "startsOn", label: "Starts on", type: "date", required: true },
        { name: "endsOn", label: "Ends on", type: "date", required: true },
      ]}
    />
  );
}
