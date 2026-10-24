"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, PencilIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { DataTable } from "@/components/crud/data-table";
import { FormDialog } from "@/components/crud/form-dialog";
import {
  attributesText,
  emptyVariant,
  MoneyOrDash,
  variantBody,
  VariantLinesEditor,
  type VariantDraft,
} from "@/components/inv/shared";
import {
  BoolBadge,
  ConfirmButton,
  DetailList,
  ErrorAlert,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { ItemRow, VariantRow } from "@/lib/api/services/inv";
import { humanize } from "@/lib/format";

type ItemPatch = Parameters<typeof api.inv.items.update>[1];

export default function InventoryItemPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  const item = useQuery({
    queryKey: ["inv.items", "get", id],
    queryFn: async () => (await api.inv.items.get(id)).data,
  });
  const update = useAction(
    (body: ItemPatch) => api.inv.items.update(id, body),
    {
      invalidate: [["inv.items"]],
      toastError: false,
    },
  );
  const setActive = useAction(
    (isActive: boolean) => api.inv.items.update(id, { isActive }),
    {
      success: (r) =>
        r.data.isActive ? "Item reactivated" : "Item deactivated",
      invalidate: [["inv.items"]],
    },
  );

  if (item.isPending) return <Loading />;
  if (item.isError) return <ErrorAlert error={item.error} />;
  const i: ItemRow = item.data;
  const editable = can(me, "inv.stock.edit");

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href="/dashboard/inventory/items" />}
      >
        <ArrowLeftIcon /> Items
      </Button>
      <PageHeader
        title={i.nameEn}
        description={i.nameBn ?? undefined}
        actions={
          editable && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <PencilIcon /> Edit
              </Button>
              {i.isActive ? (
                <ConfirmButton
                  size="default"
                  title="Deactivate this item?"
                  description="Stock on hand can still be issued, transferred and counted, but no new receipts are accepted."
                  confirmLabel="Deactivate"
                  destructive
                  onConfirm={() => setActive.mutateAsync(false)}
                >
                  Deactivate
                </ConfirmButton>
              ) : (
                <ConfirmButton
                  size="default"
                  title="Reactivate this item?"
                  confirmLabel="Reactivate"
                  onConfirm={() => setActive.mutateAsync(true)}
                >
                  Reactivate
                </ConfirmButton>
              )}
              <Button onClick={() => setAdding(true)}>
                <PlusIcon /> Add variants
              </Button>
            </>
          )
        }
      />

      <div className="space-y-6">
        <Card>
          <CardContent>
            <DetailList
              items={[
                [
                  "SKU",
                  <span key="sku" className="font-mono">
                    {i.sku}
                  </span>,
                ],
                ["Category", humanize(i.category)],
                ["Unit", i.unit],
                ["Barcode", i.barcode ?? "—"],
                ["Sellable", <BoolBadge key="sell" value={i.isSellable} />],
                [
                  "Status",
                  <StatusBadge
                    key="st"
                    status={i.isActive ? "active" : "inactive"}
                  />,
                ],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Variants</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable<VariantRow>
              rows={i.variants}
              empty="No variants."
              columns={[
                { key: "code", label: "Code", type: "mono" },
                {
                  key: "attributes",
                  label: "Attributes",
                  render: (v) => attributesText(v.attributes) || "—",
                },
                { key: "barcode", label: "Barcode", type: "mono" },
                {
                  key: "salePricePaisa",
                  label: "Sale price",
                  render: (v) => <MoneyOrDash paisa={v.salePricePaisa} />,
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <FormDialog
        open={editing}
        onOpenChange={setEditing}
        title={`Edit ${i.sku}`}
        description="The SKU and category cannot change."
        row={i}
        fields={[
          { name: "nameEn", label: "Name (English)", required: true },
          { name: "nameBn", label: "Name (Bangla)", nullable: true },
          { name: "unit", label: "Unit", required: true },
          { name: "barcode", label: "Barcode", nullable: true },
          { name: "isSellable", label: "Sellable", type: "boolean" },
        ]}
        onSubmit={(body) => update.mutateAsync(body as ItemPatch)}
      />
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
          {adding && (
            <AddVariantsForm item={i} onClose={() => setAdding(false)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AddVariantsForm({
  item,
  onClose,
}: {
  item: ItemRow;
  onClose: () => void;
}) {
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant()]);
  const add = useAction(
    () =>
      api.inv.items.addVariants(item.id, { variants: variantBody(variants) }),
    {
      success: "Variants added",
      invalidate: [["inv.items"]],
      toastError: false,
      onSuccess: onClose,
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate(undefined);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Add variants to {item.sku}</DialogTitle>
        <DialogDescription>
          Existing codes:{" "}
          {(item.variants ?? []).map((v) => v.code).join(", ") || "none"}. Codes
          are stored in upper case.
        </DialogDescription>
      </DialogHeader>
      {add.error && <ErrorAlert error={add.error} />}
      <VariantLinesEditor
        value={variants}
        onChange={setVariants}
        existing={item.variants}
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={add.isPending || variantBody(variants).length === 0}
        >
          {add.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Add variants
        </Button>
      </DialogFooter>
    </form>
  );
}
