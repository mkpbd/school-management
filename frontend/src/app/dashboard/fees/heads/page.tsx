"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";

const KINDS = [
  "tuition",
  "admission",
  "session",
  "exam",
  "lab",
  "transport",
  "activity",
  "uniform",
  "external_exam",
  "fine",
  "service",
  "opening_balance",
  "misc",
] as const;
const FREQUENCIES = [
  "one_time",
  "monthly",
  "termly",
  "annual",
  "on_demand",
] as const;

export default function FeeHeadsPage() {
  return (
    <ResourcePage
      title="Fee heads"
      description="Charge types used by fee structures, student items and invoices. Lower priority is paid first."
      queryKey="fee.heads"
      entity="fee head"
      resource={api.fee.heads}
      permissions={{
        create: "fee.structure.create",
        edit: "fee.structure.edit",
      }}
      filters={[
        { name: "kind", label: "Kinds", type: "select", options: KINDS },
        { name: "isActive", label: "Active", type: "bool" },
      ]}
      columns={[
        { key: "code", label: "Code", type: "mono" },
        { key: "nameEn", label: "Name" },
        { key: "kind", label: "Kind", type: "enum" },
        { key: "frequency", label: "Frequency", type: "enum" },
        { key: "priority", label: "Priority" },
        { key: "isRefundable", label: "Refundable", type: "bool" },
        { key: "isDiscountable", label: "Discountable", type: "bool" },
        { key: "isActive", label: "Active", type: "bool" },
      ]}
      fields={[
        { name: "code", label: "Code", required: true, mode: "create" },
        { name: "nameEn", label: "Name (English)", required: true },
        { name: "nameBn", label: "Name (Bangla)", nullable: true },
        {
          name: "kind",
          label: "Kind",
          type: "select",
          options: KINDS,
          required: true,
          mode: "create",
        },
        {
          name: "frequency",
          label: "Frequency",
          type: "select",
          options: FREQUENCIES,
          required: true,
          mode: "create",
        },
        {
          name: "priority",
          label: "Priority",
          type: "number",
          help: "1–999, lower is allocated first",
        },
        {
          name: "isRefundable",
          label: "Refundable",
          type: "boolean",
          mode: "create",
        },
        { name: "isDiscountable", label: "Discountable", type: "boolean" },
        { name: "isActive", label: "Active", type: "boolean", mode: "edit" },
      ]}
    />
  );
}
