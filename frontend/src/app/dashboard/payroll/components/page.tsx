"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";

const KINDS = ["earning", "deduction", "employer_contribution"] as const;
const CALCS = ["fixed", "percent_of_basic", "per_unit"] as const;

export default function SalaryComponentsPage() {
  return (
    <ResourcePage
      title="Salary components"
      description="Earnings, deductions and employer contributions used in contracts and payslips. Code and calculation cannot change after creation."
      queryKey="hrm.salaryComponents"
      entity="component"
      resource={api.hrm.salaryComponents}
      permissions={{ create: "hrm.payroll.create", edit: "hrm.payroll.create" }}
      columns={[
        { key: "code", label: "Code", type: "mono" },
        { key: "nameEn", label: "Name" },
        { key: "kind", label: "Kind", type: "enum" },
        { key: "calc", label: "Calculation", type: "enum" },
        { key: "taxable", label: "Taxable", type: "bool" },
        { key: "seq", label: "Order" },
      ]}
      fields={[
        {
          name: "code",
          label: "Code",
          required: true,
          mode: "create",
          placeholder: "TRANSPORT",
          help: "UPPER_SNAKE, e.g. TIFFIN",
        },
        { name: "nameEn", label: "Name", required: true },
        {
          name: "kind",
          label: "Kind",
          type: "select",
          options: KINDS,
          required: true,
          mode: "create",
        },
        {
          name: "calc",
          label: "Calculation",
          type: "select",
          options: CALCS,
          required: true,
          mode: "create",
          help: "Fixed ৳ / % of basic / ৳ per unit (cover period, overtime minute)",
        },
        {
          name: "taxable",
          label: "Taxable",
          type: "boolean",
          defaultValue: true,
        },
        { name: "seq", label: "Order on payslip", type: "number" },
      ]}
    />
  );
}
