"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

export default function ShiftsPage() {
  return (
    <ResourcePage
      title="Shifts"
      description="Morning / day shifts per campus."
      queryKey="core.shifts"
      entity="shift"
      resource={api.core.shifts}
      permissions={{ create: "core.master.create", edit: "core.master.edit" }}
      filters={[
        {
          name: "campusId",
          label: "Campuses",
          type: "ref",
          ref: refs.campuses,
        },
      ]}
      columns={[
        { key: "campusId", label: "Campus", ref: refs.campuses },
        { key: "code", label: "Code", type: "mono" },
        { key: "nameEn", label: "Name" },
        { key: "startsAt", label: "Starts", type: "time" },
        { key: "endsAt", label: "Ends", type: "time" },
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
        { name: "code", label: "Code", required: true, mode: "create" },
        { name: "nameEn", label: "Name (English)", required: true },
        { name: "nameBn", label: "Name (Bangla)", nullable: true },
        { name: "startsAt", label: "Starts at", type: "time", required: true },
        { name: "endsAt", label: "Ends at", type: "time", required: true },
      ]}
    />
  );
}
