"use client";

import { useRouter } from "next/navigation";
import { ResourcePage } from "@/components/crud/resource-page";
import { vehiclesRef } from "@/components/trn/fleet";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

export default function RoutesPage() {
  const router = useRouter();
  return (
    <ResourcePage
      title="Routes"
      description="Bus routes. Open a route to order its stops and manage the students who ride it."
      queryKey="trn.routes"
      entity="route"
      resource={api.trn.routes}
      permissions={{ create: "trn.route.create", edit: "trn.route.edit" }}
      filters={[
        {
          name: "campusId",
          label: "Campuses",
          type: "ref",
          ref: refs.campuses,
        },
        { name: "vehicleId", label: "Vehicles", type: "ref", ref: vehiclesRef },
        { name: "isActive", label: "Active", type: "bool" },
      ]}
      onRowClick={(row) =>
        router.push(`/dashboard/transport/routes/${String(row.id)}`)
      }
      columns={[
        { key: "code", label: "Code", type: "mono" },
        { key: "name", label: "Name" },
        { key: "campusId", label: "Campus", ref: refs.campuses },
        { key: "shiftId", label: "Shift", ref: refs.shifts },
        { key: "vehicleId", label: "Vehicle", ref: vehiclesRef },
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
          placeholder: "R1",
        },
        {
          name: "name",
          label: "Name",
          required: true,
          placeholder: "Gulshan - Banani",
        },
        {
          name: "shiftId",
          label: "Shift",
          type: "ref",
          ref: refs.shifts,
          nullable: true,
        },
        {
          name: "vehicleId",
          label: "Vehicle",
          type: "ref",
          ref: vehiclesRef,
          nullable: true,
        },
        { name: "isActive", label: "Active", type: "boolean", mode: "edit" },
      ]}
    />
  );
}
