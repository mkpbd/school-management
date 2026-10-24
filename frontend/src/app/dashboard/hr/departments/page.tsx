"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

export default function DepartmentsPage() {
  return (
    <ResourcePage
      title="Departments"
      description="Academic and administrative departments, each with an optional head."
      queryKey="hrm.departments"
      entity="department"
      resource={api.hrm.departments}
      searchable={false}
      permissions={{ create: "hrm.staff.create", edit: "hrm.staff.edit" }}
      columns={[
        { key: "code", label: "Code", type: "mono" },
        { key: "nameEn", label: "Name" },
        { key: "headStaffId", label: "Head", ref: refs.staff },
      ]}
      fields={[
        { name: "code", label: "Code", required: true, mode: "create" },
        { name: "nameEn", label: "Name", required: true },
        {
          name: "headStaffId",
          label: "Head of department",
          type: "ref",
          ref: refs.staff,
          nullable: true,
        },
      ]}
    />
  );
}
