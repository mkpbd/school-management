"use client";

import { useRouter } from "next/navigation";
import { ResourcePage } from "@/components/crud/resource-page";
import { OWNERSHIP, VEHICLE_KINDS } from "@/components/trn/fleet";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

export default function VehiclesPage() {
  const router = useRouter();
  return (
    <ResourcePage
      title="Vehicles"
      description="School buses and vans. Open a vehicle for its crew, documents, GPS tracker and route history."
      queryKey="trn.vehicles"
      entity="vehicle"
      resource={api.trn.vehicles}
      permissions={{ create: "trn.vehicle.create", edit: "trn.vehicle.edit" }}
      filters={[
        {
          name: "campusId",
          label: "Campuses",
          type: "ref",
          ref: refs.campuses,
        },
        {
          name: "kind",
          label: "Kinds",
          type: "select",
          options: VEHICLE_KINDS,
        },
        { name: "isActive", label: "Active", type: "bool" },
      ]}
      onRowClick={(row) =>
        router.push(`/dashboard/transport/vehicles/${String(row.id)}`)
      }
      columns={[
        { key: "regNo", label: "Reg. no", type: "mono" },
        { key: "kind", label: "Kind", type: "enum" },
        { key: "capacity", label: "Seats" },
        { key: "ownership", label: "Ownership", type: "enum" },
        { key: "campusId", label: "Campus", ref: refs.campuses },
        { key: "gpsDeviceId", label: "GPS tracker", type: "mono" },
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
          name: "regNo",
          label: "Registration no",
          required: true,
          placeholder: "DHAKA METRO-JA-11-2233",
        },
        {
          name: "kind",
          label: "Kind",
          type: "select",
          options: VEHICLE_KINDS,
          required: true,
        },
        {
          name: "capacity",
          label: "Seats",
          type: "number",
          required: true,
          help: "Seat limit for student assignments",
        },
        {
          name: "ownership",
          label: "Ownership",
          type: "select",
          options: OWNERSHIP,
        },
        { name: "isActive", label: "Active", type: "boolean", mode: "edit" },
      ]}
    />
  );
}
