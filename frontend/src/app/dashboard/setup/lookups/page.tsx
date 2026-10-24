"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";

export default function LookupsPage() {
  return (
    <ResourcePage
      title="Lookups"
      description="Configurable value lists (religions, occupations, leave reasons, ...)."
      queryKey="core.lookups"
      entity="lookup value"
      resource={api.core.lookups}
      permissions={{ create: "core.master.create", edit: "core.master.edit" }}
      filters={[{ name: "isActive", label: "Active", type: "bool" }]}
      columns={[
        { key: "listCode", label: "List", type: "mono" },
        { key: "code", label: "Code", type: "mono" },
        { key: "labelEn", label: "Label" },
        { key: "labelBn", label: "Label (Bangla)" },
        { key: "seq", label: "Order" },
        { key: "isActive", label: "Active", type: "bool" },
      ]}
      fields={[
        {
          name: "listCode",
          label: "List code",
          required: true,
          mode: "create",
          placeholder: "religion",
        },
        { name: "code", label: "Code", required: true, mode: "create" },
        { name: "labelEn", label: "Label (English)", required: true },
        { name: "labelBn", label: "Label (Bangla)", nullable: true },
        { name: "seq", label: "Order", type: "number" },
        { name: "isActive", label: "Active", type: "boolean", mode: "edit" },
      ]}
    />
  );
}
