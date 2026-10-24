"use client";

import { useQuery } from "@tanstack/react-query";
import { BoxesIcon, PencilIcon, PlusIcon, ScrollTextIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { FormDialog } from "@/components/crud/form-dialog";
import { STORE_KINDS } from "@/components/inv/shared";
import { ConfirmButton, PageHeader, StatusBadge } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { StoreRow } from "@/lib/api/services/inv";
import { refs } from "@/lib/refs";

type StoreCreate = Parameters<typeof api.inv.stores.create>[0];
type StorePatch = Parameters<typeof api.inv.stores.update>[1];

export default function InventoryStoresPage() {
  const { data: me } = useMe();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StoreRow | null>(null);

  const stores = useQuery({
    queryKey: ["inv.stores"],
    queryFn: () => api.inv.stores.list(),
  });
  const create = useAction((body: StoreCreate) => api.inv.stores.create(body), {
    invalidate: [["inv.stores"]],
    toastError: false,
  });
  const update = useAction(
    ({ id, body }: { id: string; body: StorePatch }) =>
      api.inv.stores.update(id, body),
    {
      invalidate: [["inv.stores"], ["inv.stock"]],
      toastError: false,
    },
  );
  const setActive = useAction(
    ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.inv.stores.update(id, { isActive }),
    {
      success: (r) =>
        r.data.isActive ? `${r.data.name} reopened` : `${r.data.name} closed`,
      invalidate: [["inv.stores"], ["inv.stock"]],
    },
  );
  const editable = can(me, "inv.stock.edit");

  return (
    <>
      <PageHeader
        title="Stores"
        description="Stores of the active campus: central store, uniform and book shops, labs, ICT and sports. A closed store accepts no movements."
        actions={
          editable && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New store
            </Button>
          )
        }
      />
      <Card>
        <CardContent>
          <DataTable<StoreRow>
            rows={stores.data?.data}
            isPending={stores.isPending}
            error={stores.error}
            empty="No stores yet."
            columns={[
              { key: "code", label: "Code", type: "mono" },
              {
                key: "name",
                label: "Name",
                render: (s) => <span className="font-medium">{s.name}</span>,
              },
              { key: "kind", label: "Kind", type: "enum" },
              { key: "campusId", label: "Campus", ref: refs.campuses },
              { key: "keeperStaffId", label: "Keeper", ref: refs.staff },
              {
                key: "isActive",
                label: "Status",
                render: (s) => (
                  <StatusBadge status={s.isActive ? "active" : "inactive"} />
                ),
              },
            ]}
            actions={(s) => (
              <>
                <Button
                  nativeButton={false}
                  variant="ghost"
                  size="xs"
                  render={
                    <Link href={`/dashboard/inventory/stock?storeId=${s.id}`} />
                  }
                >
                  <BoxesIcon /> Stock
                </Button>
                <Button
                  nativeButton={false}
                  variant="ghost"
                  size="xs"
                  render={
                    <Link
                      href={`/dashboard/inventory/ledger?storeId=${s.id}`}
                    />
                  }
                >
                  <ScrollTextIcon /> Ledger
                </Button>
                {editable && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit"
                      onClick={() => setEditing(s)}
                    >
                      <PencilIcon />
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      size="xs"
                      title={
                        s.isActive ? `Close ${s.name}?` : `Reopen ${s.name}?`
                      }
                      description={
                        s.isActive
                          ? "No receipts, issues, transfers or counts can be posted to a closed store. Its stock and ledger stay visible."
                          : undefined
                      }
                      confirmLabel={s.isActive ? "Close store" : "Reopen"}
                      destructive={s.isActive}
                      onConfirm={() =>
                        setActive.mutateAsync({
                          id: s.id,
                          isActive: !s.isActive,
                        })
                      }
                    >
                      {s.isActive ? "Close" : "Reopen"}
                    </ConfirmButton>
                  </>
                )}
              </>
            )}
          />
        </CardContent>
      </Card>

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title="New store"
        fields={[
          {
            name: "campusId",
            label: "Campus",
            type: "ref",
            ref: refs.campuses,
            help: "Default: active campus",
          },
          {
            name: "code",
            label: "Code",
            required: true,
            placeholder: "CENTRAL",
            help: "Letters, digits, - and _ (up to 30)",
          },
          { name: "name", label: "Name", required: true },
          {
            name: "kind",
            label: "Kind",
            type: "select",
            options: STORE_KINDS,
            required: true,
          },
          {
            name: "keeperStaffId",
            label: "Store keeper",
            type: "ref",
            ref: refs.staff,
          },
        ]}
        successMessage="Store created"
        onSubmit={(body) => create.mutateAsync(body as StoreCreate)}
      />
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={`Edit ${editing?.code ?? "store"}`}
        description="The code, kind and campus cannot change."
        row={editing ?? undefined}
        fields={[
          { name: "name", label: "Name", required: true },
          {
            name: "keeperStaffId",
            label: "Store keeper",
            type: "ref",
            ref: refs.staff,
            nullable: true,
          },
        ]}
        onSubmit={(body) =>
          update.mutateAsync({ id: editing!.id, body: body as StorePatch })
        }
      />
    </>
  );
}
