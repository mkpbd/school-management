"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

const KINDS = [
  "teaching",
  "break",
  "prayer",
  "assembly",
  "registration",
] as const;
const SCHEDULES = ["regular", "ramadan"] as const;

export default function PeriodsPage() {
  return (
    <ResourcePage
      title="Bell schedule"
      description="Periods per shift. Ramadan routine uses its own schedule code."
      queryKey="aca.periods"
      entity="period"
      resource={api.aca.periods}
      searchable={false}
      permissions={{
        create: "aca.timetable.edit",
        edit: "aca.timetable.edit",
        delete: "aca.timetable.edit",
      }}
      filters={[
        {
          name: "campusId",
          label: "Campuses",
          type: "ref",
          ref: refs.campuses,
        },
        { name: "shiftId", label: "Shifts", type: "ref", ref: refs.shifts },
        {
          name: "scheduleCode",
          label: "Schedules",
          type: "select",
          options: SCHEDULES,
        },
      ]}
      columns={[
        { key: "shiftId", label: "Shift", ref: refs.shifts },
        { key: "scheduleCode", label: "Schedule", type: "enum" },
        { key: "periodNo", label: "#" },
        { key: "label", label: "Label" },
        { key: "kind", label: "Kind", type: "enum" },
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
        {
          name: "shiftId",
          label: "Shift",
          type: "ref",
          ref: refs.shifts,
          required: true,
          mode: "create",
        },
        {
          name: "scheduleCode",
          label: "Schedule",
          type: "select",
          options: SCHEDULES,
          mode: "create",
          help: "Default: regular",
        },
        {
          name: "periodNo",
          label: "Period no",
          type: "number",
          required: true,
          mode: "create",
          help: "0–20",
        },
        {
          name: "kind",
          label: "Kind",
          type: "select",
          options: KINDS,
          required: true,
          mode: "create",
        },
        { name: "label", label: "Label", required: true, placeholder: "1st" },
        { name: "startsAt", label: "Starts at", type: "time", required: true },
        { name: "endsAt", label: "Ends at", type: "time", required: true },
      ]}
    />
  );
}
