"use client";

import { useQuery } from "@tanstack/react-query";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState, type FormEvent } from "react";
import { DataTable } from "@/components/crud/data-table";
import {
  ITEM_CATEGORIES,
  variantBody,
  VariantLinesEditor,
  type VariantDraft,
} from "@/components/inv/shared";
import { ErrorAlert, PageHeader, StatusBadge } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { ItemCategory, ItemRow } from "@/lib/api/services/inv";
import { humanize } from "@/lib/format";

export default function InventoryItemsPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const [category, setCategory] = useState<ItemCategory | "">("");
  const [active, setActive] = useState<"true" | "false" | "">("true");
  const [creating, setCreating] = useState(false);

  const query = {
    ...(search ? { q: search } : {}),
    ...(category ? { category } : {}),
    ...(active ? { active } : {}),
  };
  const items = useQuery({
    queryKey: ["inv.items", query],
    queryFn: () => api.inv.items.list(query),
  });

  return (
    <>
      <PageHeader
        title="Items"
        description="Item master shared by every store. Variants are sizes or colours (uniforms); items without variants have one standard variant."
        actions={
          can(me, "inv.stock.edit") && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New item
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative sm:w-72">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Name, SKU or barcode"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select
              className="select select-sm h-8 sm:w-48"
              value={category}
              onChange={(e) => setCategory(e.target.value as ItemCategory | "")}
            >
              <option value="">All categories</option>
              {ITEM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </select>
            <select
              className="select select-sm h-8 sm:w-40"
              value={active}
              onChange={(e) =>
                setActive(e.target.value as "true" | "false" | "")
              }
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
              <option value="">All</option>
            </select>
          </div>
          <DataTable<ItemRow>
            rows={items.data?.data}
            isPending={items.isPending}
            error={items.error}
            empty="No items match."
            onRowClick={(i) =>
              router.push(`/dashboard/inventory/items/${i.id}`)
            }
            columns={[
              { key: "sku", label: "SKU", type: "mono" },
              {
                key: "nameEn",
                label: "Name",
                render: (i) => (
                  <div>
                    <div className="font-medium">{i.nameEn}</div>
                    {i.nameBn && (
                      <div className="text-xs text-muted-foreground">
                        {i.nameBn}
                      </div>
                    )}
                  </div>
                ),
              },
              { key: "category", label: "Category", type: "enum" },
              { key: "unit", label: "Unit" },
              {
                key: "variants",
                label: "Variants",
                render: (i) => (
                  <div className="flex max-w-xs flex-wrap gap-1">
                    {(i.variants ?? []).map((v) => (
                      <span
                        key={v.id}
                        className="badge badge-ghost badge-sm font-mono"
                      >
                        {v.code}
                      </span>
                    ))}
                  </div>
                ),
              },
              { key: "isSellable", label: "Sellable", type: "bool" },
              {
                key: "isActive",
                label: "Status",
                render: (i) => (
                  <StatusBadge status={i.isActive ? "active" : "inactive"} />
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
          {creating && (
            <CreateItemForm
              onClose={() => setCreating(false)}
              onCreated={(id) =>
                router.push(`/dashboard/inventory/items/${id}`)
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateItemForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [sku, setSku] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameBn, setNameBn] = useState("");
  const [category, setCategory] = useState<ItemCategory | "">("");
  const [unit, setUnit] = useState("pcs");
  const [barcode, setBarcode] = useState("");
  const [isSellable, setIsSellable] = useState(false);
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const create = useAction(
    () =>
      api.inv.items.create({
        sku: sku.trim(),
        nameEn: nameEn.trim(),
        ...(nameBn.trim() ? { nameBn: nameBn.trim() } : {}),
        category: category as ItemCategory,
        unit: unit.trim(),
        isSellable,
        ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
        ...(variantBody(variants).length
          ? { variants: variantBody(variants) }
          : {}),
      }),
    {
      success: (r) => `Item ${r.data.sku} created`,
      invalidate: [["inv.items"]],
      toastError: false,
      onSuccess: (r) => onCreated(r.data.id),
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(undefined);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>New item</DialogTitle>
        <DialogDescription>
          Leave the variants empty for a single standard variant (STD).
        </DialogDescription>
      </DialogHeader>
      {create.error && <ErrorAlert error={create.error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="item-sku">
            SKU<span className="text-destructive">*</span>
          </Label>
          <Input
            id="item-sku"
            required
            pattern="[A-Za-z0-9_\-]{1,30}"
            title="Letters, digits, - and _ (up to 30)"
            placeholder="SHIRT-WHITE"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="item-category">
            Category<span className="text-destructive">*</span>
          </Label>
          <select
            id="item-category"
            className="select select-sm h-8 w-full"
            required
            value={category}
            onChange={(e) => setCategory(e.target.value as ItemCategory | "")}
          >
            <option value="">Select…</option>
            {ITEM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {humanize(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="item-name">
            Name (English)<span className="text-destructive">*</span>
          </Label>
          <Input
            id="item-name"
            required
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="item-name-bn">Name (Bangla)</Label>
          <Input
            id="item-name-bn"
            maxLength={200}
            value={nameBn}
            onChange={(e) => setNameBn(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="item-unit">
            Unit<span className="text-destructive">*</span>
          </Label>
          <Input
            id="item-unit"
            required
            maxLength={20}
            placeholder="pcs, kg, ream"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="item-barcode">Barcode</Label>
          <Input
            id="item-barcode"
            maxLength={60}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={isSellable}
            onCheckedChange={(c) => setIsSellable(Boolean(c))}
          />
          Sold to students / parents (uniform or book shop)
        </label>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Variants</h3>
        <VariantLinesEditor value={variants} onChange={setVariants} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending || !category}>
          {create.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Create item
        </Button>
      </DialogFooter>
    </form>
  );
}
