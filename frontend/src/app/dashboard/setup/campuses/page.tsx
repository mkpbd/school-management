"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";

export default function CampusesPage() {
  return (
    <ResourcePage
      title="Campuses"
      description="Branches of the school. Most records belong to one campus."
      queryKey="core.campuses"
      entity="campus"
      resource={api.core.campuses}
      permissions={{ create: "core.master.create", edit: "core.master.edit" }}
      columns={[
        { key: "code", label: "Code", type: "mono" },
        { key: "nameEn", label: "Name" },
        { key: "nameBn", label: "Name (Bangla)" },
        { key: "phone", label: "Phone" },
        { key: "email", label: "Email" },
        { key: "isActive", label: "Active", type: "bool" },
      ]}
      fields={[
        {
          name: "code",
          label: "Code",
          required: true,
          mode: "create",
          help: "Letters, digits, _ . -",
        },
        { name: "nameEn", label: "Name (English)", required: true },
        { name: "nameBn", label: "Name (Bangla)", nullable: true },
        { name: "phone", label: "Phone", type: "phone", nullable: true },
        { name: "email", label: "Email", type: "email", nullable: true },
        {
          name: "addressEn",
          label: "Address (English)",
          type: "textarea",
          nullable: true,
        },
        {
          name: "addressBn",
          label: "Address (Bangla)",
          type: "textarea",
          nullable: true,
        },
        {
          name: "isActive",
          label: "Active",
          type: "boolean",
          defaultValue: true,
        },
      ]}
    />
  );
}
