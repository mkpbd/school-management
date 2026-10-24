"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";

export default function HousesPage() {
  return (
    <ResourcePage
      title="Houses"
      description="School houses. Place students in a house on their profile; notices can target a house."
      queryKey="cca.houses"
      entity="house"
      resource={api.cca.houses}
      permissions={{ create: "cca.house.create", edit: "cca.house.edit" }}
      filters={[
        {
          name: "isActive",
          label: "Status",
          type: "select",
          options: ["true", "false"],
        },
      ]}
      columns={[
        { key: "code", label: "Code", type: "mono" },
        { key: "nameEn", label: "Name" },
        { key: "nameBn", label: "Name (Bangla)" },
        { key: "colourHex", label: "Colour", type: "mono" },
        { key: "isActive", label: "Active", type: "bool" },
      ]}
      fields={[
        { name: "code", label: "Code", required: true, mode: "create" },
        { name: "nameEn", label: "Name", required: true },
        { name: "nameBn", label: "Name (Bangla)", nullable: true },
        {
          name: "colourHex",
          label: "Colour (#RRGGBB)",
          nullable: true,
          placeholder: "#C62828",
        },
        { name: "isActive", label: "Active", type: "boolean", mode: "edit" },
      ]}
    />
  );
}
