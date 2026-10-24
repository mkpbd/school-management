"use client";

import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { PageHeader, StatusBadge } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { CostCentreRow } from "@/lib/api/services/acc-accounting";
import { refs } from "@/lib/refs";

type CostCentreCreate = Parameters<typeof api.acc.costCentres.create>[0];

export default function CostCentresPage() {
  const { data: me } = useMe();
  const [creating, setCreating] = useState(false);
  const centres = useQuery({
    queryKey: ["acc.costCentres"],
    queryFn: () => api.acc.costCentres.list(),
  });
  const create = useAction(
    (body: CostCentreCreate) => api.acc.costCentres.create(body),
    {
      invalidate: [["acc.costCentres"]],
      toastError: false,
    },
  );

  return (
    <>
      <PageHeader
        title="Cost centres"
        description="Budget departments (e.g. SCIENCE, ADMIN, TRANSPORT). Budget lines, requisitions and purchase orders are tracked per account × cost centre."
        actions={
          can(me, "acc.budget.create") && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New cost centre
            </Button>
          )
        }
      />
      <Card>
        <CardContent>
          <DataTable<CostCentreRow>
            rows={centres.data?.data}
            isPending={centres.isPending}
            error={centres.error}
            empty="No cost centres yet."
            columns={[
              { key: "code", label: "Code", type: "mono" },
              {
                key: "nameEn",
                label: "Name",
                render: (c) => <span className="font-medium">{c.nameEn}</span>,
              },
              {
                key: "campusId",
                label: "Campus",
                render: (c) =>
                  c.campusId ? (
                    <RefLabel source={refs.campuses} id={c.campusId} />
                  ) : (
                    <span className="text-muted-foreground">All campuses</span>
                  ),
              },
              {
                key: "departmentId",
                label: "Department",
                ref: refs.departments,
              },
              {
                key: "isActive",
                label: "Status",
                render: (c) => (
                  <StatusBadge status={c.isActive ? "active" : "inactive"} />
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title="New cost centre"
        fields={[
          {
            name: "code",
            label: "Code",
            required: true,
            placeholder: "SCIENCE",
            help: "2–20 letters, digits, - or _ (stored upper-case)",
          },
          { name: "nameEn", label: "Name", required: true },
          {
            name: "campusId",
            label: "Campus",
            type: "ref",
            ref: refs.campuses,
            help: "Empty: shared by all campuses",
          },
          {
            name: "departmentId",
            label: "HR department",
            type: "ref",
            ref: refs.departments,
          },
        ]}
        successMessage="Cost centre created"
        onSubmit={(body) => create.mutateAsync(body as CostCentreCreate)}
      />
    </>
  );
}
