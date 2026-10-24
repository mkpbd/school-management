"use client";

import { useQuery } from "@tanstack/react-query";
import { PencilIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { vendorFields } from "@/components/acc/procurement-vendor";
import { DataTable } from "@/components/crud/data-table";
import { FormDialog } from "@/components/crud/form-dialog";
import { PageHeader, StatusBadge } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { VendorRow } from "@/lib/api/services/acc-procurement";

type VendorCreate = Parameters<typeof api.acc.vendors.create>[0];
type VendorPatch = Parameters<typeof api.acc.vendors.update>[1];

const pct = (v: number | null) =>
  v === null || v === undefined ? "—" : `${Number(v)}%`;

export default function VendorsPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const [active, setActive] = useState<"true" | "">("true");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<VendorRow | null>(null);

  const query = {
    ...(search ? { q: search } : {}),
    ...(active ? { active } : {}),
  };
  const vendors = useQuery({
    queryKey: ["acc.vendors", query],
    queryFn: () => api.acc.vendors.list(query),
  });
  const create = useAction(
    (body: VendorCreate) => api.acc.vendors.create(body),
    {
      invalidate: [["acc.vendors"]],
      toastError: false,
      onSuccess: (r) =>
        router.push(`/dashboard/procurement/vendors/${r.data.id}`),
    },
  );
  const update = useAction(
    ({ id, body }: { id: string; body: VendorPatch }) =>
      api.acc.vendors.update(id, body),
    {
      invalidate: [["acc.vendors"], ["acc.vendor"]],
      toastError: false,
    },
  );
  const editable = can(me, "acc.procurement.create");

  return (
    <>
      <PageHeader
        title="Vendors"
        description="Supplier master: TIN, BIN / VAT registration, VAT and income-tax (TDS) deduction rates, payment terms and performance."
        actions={
          editable && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New vendor
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative sm:w-72">
              <SearchIcon className="pointer-events-none absolute top-2 left-2 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search name or code"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div role="tablist" className="tabs tabs-box tabs-sm w-fit">
              <button
                type="button"
                role="tab"
                className={`tab ${active ? "tab-active" : ""}`}
                onClick={() => setActive("true")}
              >
                Active
              </button>
              <button
                type="button"
                role="tab"
                className={`tab ${!active ? "tab-active" : ""}`}
                onClick={() => setActive("")}
              >
                All
              </button>
            </div>
          </div>
          <DataTable<VendorRow>
            rows={vendors.data?.data}
            isPending={vendors.isPending}
            error={vendors.error}
            onRowClick={(v) =>
              router.push(`/dashboard/procurement/vendors/${v.id}`)
            }
            empty={search ? "No vendor matches." : "No vendors yet."}
            columns={[
              { key: "code", label: "Code", type: "mono" },
              {
                key: "name",
                label: "Name",
                render: (v) => <span className="font-medium">{v.name}</span>,
              },
              { key: "phone", label: "Phone" },
              { key: "tin", label: "TIN", type: "mono" },
              { key: "binVat", label: "BIN", type: "mono" },
              {
                key: "vatRatePct",
                label: "VAT",
                render: (v) => pct(v.vatRatePct),
              },
              {
                key: "tdsRatePct",
                label: "TDS",
                render: (v) => pct(v.tdsRatePct),
              },
              {
                key: "paymentTermsDays",
                label: "Terms",
                render: (v) => `${v.paymentTermsDays} days`,
              },
              {
                key: "isActive",
                label: "Status",
                render: (v) => (
                  <StatusBadge status={v.isActive ? "active" : "inactive"} />
                ),
              },
            ]}
            actions={
              editable
                ? (v) => (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit"
                      onClick={() => setEditing(v)}
                    >
                      <PencilIcon />
                    </Button>
                  )
                : undefined
            }
          />
        </CardContent>
      </Card>

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title="New vendor"
        fields={vendorFields}
        successMessage="Vendor added"
        onSubmit={(body) => create.mutateAsync(body as VendorCreate)}
      />
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={`Edit ${editing?.code ?? "vendor"}`}
        description="The code cannot change. New rates apply to bills recorded from now on."
        row={editing ?? undefined}
        fields={vendorFields}
        onSubmit={(body) =>
          update.mutateAsync({ id: editing!.id, body: body as VendorPatch })
        }
      />
    </>
  );
}
