"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

const ROOM_TYPES = [
  "classroom",
  "lab",
  "ict_lab",
  "hall",
  "library",
  "playground",
  "office",
  "other",
] as const;

export default function RoomsPage() {
  return (
    <ResourcePage
      title="Rooms"
      description="Classrooms, labs and halls used by timetables and exams."
      queryKey="core.rooms"
      entity="room"
      resource={api.core.rooms}
      permissions={{
        create: "core.master.create",
        edit: "core.master.edit",
        delete: "core.master.delete",
      }}
      filters={[
        {
          name: "campusId",
          label: "Campuses",
          type: "ref",
          ref: refs.campuses,
        },
        {
          name: "roomType",
          label: "Types",
          type: "select",
          options: ROOM_TYPES,
        },
      ]}
      columns={[
        { key: "campusId", label: "Campus", ref: refs.campuses },
        { key: "code", label: "Code", type: "mono" },
        { key: "name", label: "Name" },
        { key: "roomType", label: "Type", type: "enum" },
        { key: "capacity", label: "Capacity" },
        { key: "examCapacity", label: "Exam capacity" },
        { key: "isBookable", label: "Bookable", type: "bool" },
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
        { name: "name", label: "Name", required: true },
        {
          name: "roomType",
          label: "Type",
          type: "select",
          options: ROOM_TYPES,
          required: true,
        },
        { name: "capacity", label: "Capacity", type: "number", nullable: true },
        {
          name: "examCapacity",
          label: "Exam capacity",
          type: "number",
          nullable: true,
        },
        { name: "isBookable", label: "Bookable", type: "boolean" },
      ]}
    />
  );
}
