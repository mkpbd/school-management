"use client";

import { BedDoubleIcon, DoorOpenIcon } from "lucide-react";
import Link from "next/link";
import { ResourcePage } from "@/components/crud/resource-page";
import { HOSTEL_GENDERS } from "@/components/hst/shared";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

export default function HostelsPage() {
  return (
    <ResourcePage
      title="Hostels"
      description="Hostel buildings per campus with their warden. Boys' hostels take male students, girls' hostels female students."
      queryKey="hst.hostels"
      entity="hostel"
      resource={api.hst.hostels}
      searchable={false}
      permissions={{ create: "hst.hostel.create", edit: "hst.hostel.edit" }}
      filters={[
        {
          name: "campusId",
          label: "Campuses",
          type: "ref",
          ref: refs.campuses,
        },
        {
          name: "gender",
          label: "Genders",
          type: "select",
          options: HOSTEL_GENDERS,
        },
        { name: "isActive", label: "Active", type: "bool" },
      ]}
      rowActions={(row) => (
        <>
          <Button
            size="xs"
            variant="ghost"
            nativeButton={false}
            render={
              <Link
                href={`/dashboard/hostel/rooms?hostelId=${String(row.id)}`}
              />
            }
          >
            <DoorOpenIcon /> Rooms
          </Button>
          <Button
            size="xs"
            variant="ghost"
            nativeButton={false}
            render={
              <Link
                href={`/dashboard/hostel/occupancy?hostelId=${String(row.id)}`}
              />
            }
          >
            <BedDoubleIcon /> Occupancy
          </Button>
        </>
      )}
      columns={[
        { key: "code", label: "Code", type: "mono" },
        { key: "name", label: "Name" },
        { key: "gender", label: "For", type: "enum" },
        { key: "wardenStaffId", label: "Warden", ref: refs.staff },
        { key: "phone", label: "Phone" },
        { key: "campusId", label: "Campus", ref: refs.campuses },
        { key: "isActive", label: "Active", type: "bool" },
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
          name: "code",
          label: "Code",
          required: true,
          mode: "create",
          placeholder: "BH1",
        },
        {
          name: "name",
          label: "Name",
          required: true,
          placeholder: "Boys' Hostel 1",
        },
        {
          name: "gender",
          label: "For",
          type: "select",
          options: HOSTEL_GENDERS,
          required: true,
          mode: "create",
        },
        {
          name: "wardenStaffId",
          label: "Warden",
          type: "ref",
          ref: refs.staff,
          nullable: true,
        },
        {
          name: "phone",
          label: "Phone",
          type: "phone",
          nullable: true,
          help: "Hostel office; shown to guardians",
        },
        { name: "address", label: "Address", type: "textarea", nullable: true },
        {
          name: "isActive",
          label: "Active",
          type: "boolean",
          mode: "edit",
          help: "A closed hostel takes no new residents",
        },
      ]}
    />
  );
}
