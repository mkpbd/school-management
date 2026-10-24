"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

const KINDS = [
  "holiday_national",
  "holiday_islamic",
  "holiday_school",
  "exam_window",
  "ptm",
  "event",
  "term_break",
  "ramadan_routine",
] as const;

export default function CalendarPage() {
  return (
    <ResourcePage
      title="Calendar"
      description="Holidays, exam windows and events. Non-instructional days are skipped by attendance and billing."
      queryKey="core.calendarEvents"
      entity="event"
      resource={api.core.calendarEvents}
      permissions={{
        create: "core.calendar.create",
        edit: "core.calendar.edit",
        delete: "core.calendar.delete",
      }}
      filters={[
        {
          name: "academicYearId",
          label: "Years",
          type: "ref",
          ref: refs.academicYears,
        },
        { name: "kind", label: "Kinds", type: "select", options: KINDS },
        {
          name: "campusId",
          label: "Campuses",
          type: "ref",
          ref: refs.campuses,
        },
      ]}
      columns={[
        { key: "titleEn", label: "Title" },
        { key: "kind", label: "Kind", type: "enum" },
        { key: "startsOn", label: "From", type: "date" },
        { key: "endsOn", label: "To", type: "date" },
        { key: "campusId", label: "Campus", ref: refs.campuses },
        { key: "isInstructional", label: "Instructional", type: "bool" },
        { key: "isTentative", label: "Tentative", type: "bool" },
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
          name: "kind",
          label: "Kind",
          type: "select",
          options: KINDS,
          required: true,
          mode: "create",
        },
        {
          name: "campusId",
          label: "Campus",
          type: "ref",
          ref: refs.campuses,
          mode: "create",
          help: "Empty: all campuses",
        },
        {
          name: "audience",
          label: "Audience",
          type: "select",
          options: ["all", "staff", "students"],
          mode: "create",
        },
        { name: "titleEn", label: "Title (English)", required: true },
        { name: "titleBn", label: "Title (Bangla)", nullable: true },
        { name: "startsOn", label: "From", type: "date", required: true },
        { name: "endsOn", label: "To", type: "date", required: true },
        {
          name: "isInstructional",
          label: "Instructional day",
          type: "boolean",
        },
        { name: "isTentative", label: "Tentative", type: "boolean" },
        { name: "publishToWeb", label: "Publish to website", type: "boolean" },
      ]}
    />
  );
}
