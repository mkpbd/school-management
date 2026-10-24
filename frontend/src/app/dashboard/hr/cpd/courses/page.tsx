"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { CPD_CATEGORIES, CPD_DELIVERY, hours } from "@/components/hrm/cpd";
import { api } from "@/lib/api";

export default function CpdCoursesPage() {
  return (
    <ResourcePage
      title="CPD courses"
      description="Catalogue of in-house professional development courses. Schedule sessions of a course from CPD sessions."
      queryKey="hrm.cpdCourses"
      entity="course"
      resource={api.hrm.cpdCourses}
      permissions={{ create: "hrm.cpd.create", edit: "hrm.cpd.create" }}
      filters={[
        {
          name: "category",
          label: "Categories",
          type: "select",
          options: CPD_CATEGORIES,
        },
        { name: "isActive", label: "Active", type: "bool" },
      ]}
      columns={[
        { key: "title", label: "Title" },
        { key: "provider", label: "Provider" },
        {
          key: "hours",
          label: "Hours",
          render: (r) => (
            <span className="tabular-nums">{hours(r.hours as string)}</span>
          ),
        },
        { key: "category", label: "Category", type: "enum" },
        { key: "delivery", label: "Delivery", type: "enum" },
        { key: "isActive", label: "Active", type: "bool" },
      ]}
      fields={[
        { name: "title", label: "Title", required: true, wide: true },
        {
          name: "provider",
          label: "Provider",
          help: "Trainer or organisation (optional)",
        },
        {
          name: "hours",
          label: "CPD hours",
          type: "number",
          required: true,
          help: "In half hours, e.g. 2.5",
        },
        {
          name: "category",
          label: "Category",
          type: "select",
          options: CPD_CATEGORIES,
          required: true,
        },
        {
          name: "delivery",
          label: "Delivery",
          type: "select",
          options: CPD_DELIVERY,
          required: true,
          defaultValue: "in_person",
        },
        { name: "description", label: "Description", type: "textarea" },
        {
          name: "isActive",
          label: "Active",
          type: "boolean",
          mode: "edit",
          help: "Inactive courses cannot be scheduled",
        },
      ]}
    />
  );
}
