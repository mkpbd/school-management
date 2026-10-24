"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";

export default function DesignationsPage() {
  return (
    <ResourcePage
      title="Designations"
      description="Job titles and grades (Assistant Teacher, Senior Teacher, Accountant, ...)."
      queryKey="hrm.designations"
      entity="designation"
      resource={api.hrm.designations}
      searchable={false}
      permissions={{ create: "hrm.staff.create", edit: "hrm.staff.edit" }}
      columns={[
        { key: "code", label: "Code", type: "mono" },
        { key: "nameEn", label: "Name" },
        { key: "nameBn", label: "Name (Bangla)" },
        { key: "grade", label: "Grade" },
      ]}
      fields={[
        { name: "code", label: "Code", required: true, mode: "create" },
        { name: "nameEn", label: "Name (English)", required: true },
        { name: "nameBn", label: "Name (Bangla)", nullable: true },
        { name: "grade", label: "Grade", nullable: true },
      ]}
    />
  );
}
