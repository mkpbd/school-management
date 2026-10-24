"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";

export default function ConcessionTypesPage() {
  return (
    <ResourcePage
      title="Concession types"
      description="Discount rules (seeded configuration). Grant them to students under Concessions."
      queryKey="fee.concessionTypes"
      entity="concession type"
      resource={api.fee.concessionTypes}
      columns={[
        { key: "code", label: "Code", type: "mono" },
        { key: "nameEn", label: "Name" },
        { key: "calc", label: "Calculation", type: "enum" },
        {
          key: "defaultValue",
          label: "Default",
          render: (r) =>
            r.calc === "percent"
              ? `${String(r.defaultValue)}%`
              : String(r.defaultValue ?? "—"),
        },
        { key: "stacking", label: "Stacking", type: "enum" },
        {
          key: "maxPercentCap",
          label: "Cap",
          render: (r) =>
            r.maxPercentCap ? `${String(r.maxPercentCap)}%` : "—",
        },
        { key: "requiresApproval", label: "Needs approval", type: "bool" },
        {
          key: "autoRule",
          label: "Auto rule",
          render: (r) =>
            r.autoRule && typeof r.autoRule === "object"
              ? Object.entries(r.autoRule as Record<string, unknown>)
                  .map(([k, v]) => `${humanize(k)}: ${String(v)}`)
                  .join(", ")
              : "—",
        },
      ]}
    />
  );
}
