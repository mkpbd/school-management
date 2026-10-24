"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type Row } from "@/lib/api";
import type {
  ItemCategory,
  MovementType,
  StoreKind,
  VariantRow,
} from "@/lib/api/services/inv";
import { formatMoney, toPaisa } from "@/lib/format";
import type { RefSource } from "@/lib/refs";

export const ITEM_CATEGORIES: ItemCategory[] = [
  "uniform",
  "book",
  "stationery",
  "lab_consumable",
  "lab_equipment",
  "ict",
  "cleaning",
  "furniture",
  "sports",
  "other",
];
export const STORE_KINDS: StoreKind[] = [
  "central",
  "uniform_shop",
  "book_shop",
  "lab",
  "ict",
  "sports",
];
export const MOVEMENT_TYPES: MovementType[] = [
  "opening",
  "receipt",
  "issue",
  "transfer_out",
  "transfer_in",
  "sale",
  "sale_return",
  "adjustment",
  "write_off",
];

/** SKU / variant / store code rule of the backend. */
export const CODE_RE = /^[A-Za-z0-9_-]{1,30}$/;

const qtyFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

/** Quantities carry up to 3 decimals (kg, litres, metres). */
export function formatQty(n: unknown, unit?: string): string {
  const v = typeof n === "number" ? n : Number(n);
  if (n === null || n === undefined || !Number.isFinite(v)) return "—";
  return `${qtyFormat.format(v)}${unit ? ` ${unit}` : ""}`;
}

/** Signed quantity for the ledger (+12 / −3). */
export function formatDelta(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${qtyFormat.format(Math.abs(n))}`;
}

export function attributesText(
  a: Record<string, string> | undefined | null,
): string {
  return a && Object.keys(a).length
    ? Object.entries(a)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")
    : "";
}

/** "size=M, colour=white" -> { size: "M", colour: "white" } */
function parseAttributes(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const part of text.split(",")) {
    const [k, ...rest] = part.split("=");
    const key = k?.trim();
    const value = rest.join("=").trim();
    if (key && value) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Stores of the active campus as a select source (["ref", "invStores"]). */
export const invStoresRef: RefSource = {
  key: "invStores",
  load: async () => (await api.inv.stores.list()).data,
  label: (r) =>
    `${String(r.name)} (${String(r.code)})${r.isActive ? "" : " — closed"}`,
};

/** Variants of active items as a select source (["ref", "invVariants"]); row id = variant id. */
export const invVariantsRef: RefSource = {
  key: "invVariants",
  load: async () => {
    const { data } = await api.inv.items.list({ active: "true" });
    return data.flatMap((item) =>
      (item.variants ?? []).map((v): Row => ({
        id: v.id,
        label: `${item.sku} ${item.nameEn}${(item.variants?.length ?? 0) > 1 || v.code !== "STD" ? ` · ${v.code}` : ""} (${item.unit})`,
      })),
    );
  },
  label: (r) => String(r.label),
};

// ---- variant lines (create item / add variants) ----

export interface VariantDraft {
  code: string;
  attributes: string;
  barcode: string;
  salePrice: string;
}

export const emptyVariant = (): VariantDraft => ({
  code: "",
  attributes: "",
  barcode: "",
  salePrice: "",
});

/** Drafts -> request variants (blank lines are skipped). */
export function variantBody(drafts: VariantDraft[]) {
  return drafts
    .filter((d) => d.code.trim())
    .map((d) => ({
      code: d.code.trim(),
      ...(parseAttributes(d.attributes)
        ? { attributes: parseAttributes(d.attributes) }
        : {}),
      ...(d.barcode.trim() ? { barcode: d.barcode.trim() } : {}),
      ...(d.salePrice.trim() ? { salePricePaisa: toPaisa(d.salePrice) } : {}),
    }));
}

/** Variant lines with a quick "sizes" helper (S, M, L -> one variant per size). */
export function VariantLinesEditor({
  value,
  onChange,
  existing = [],
}: {
  value: VariantDraft[];
  onChange: (v: VariantDraft[]) => void;
  /** Variants the item already has (codes must stay unique). */
  existing?: VariantRow[];
}) {
  const [sizes, setSizes] = useState("");
  const update = (i: number, patch: Partial<VariantDraft>) =>
    onChange(value.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const taken = new Set([
    ...existing.map((v) => v.code.toUpperCase()),
    ...value.map((d) => d.code.trim().toUpperCase()),
  ]);

  function addSizes() {
    const fresh = sizes
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && CODE_RE.test(s) && !taken.has(s.toUpperCase()))
      .map((s): VariantDraft => ({
        ...emptyVariant(),
        code: s.toUpperCase(),
        attributes: `size=${s}`,
      }));
    if (!fresh.length) return;
    onChange([
      ...value.filter(
        (d) =>
          d.code.trim() ||
          d.attributes.trim() ||
          d.barcode.trim() ||
          d.salePrice.trim(),
      ),
      ...fresh,
    ]);
    setSizes("");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label
            htmlFor="variant-sizes"
            className="text-xs text-muted-foreground"
          >
            Quick add sizes (comma separated)
          </Label>
          <Input
            id="variant-sizes"
            placeholder="S, M, L, XL, 28, 30"
            value={sizes}
            onChange={(e) => setSizes(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSizes();
              }
            }}
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addSizes}>
          Add sizes
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...value, emptyVariant()])}
        >
          <PlusIcon /> Add line
        </Button>
      </div>
      {value.map((d, i) => (
        <div
          key={i}
          className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_2fr_1.5fr_1fr_auto] sm:items-end"
        >
          <div className="space-y-1.5">
            <Label className="text-xs">Code</Label>
            <Input
              placeholder="M"
              pattern="[A-Za-z0-9_\-]{1,30}"
              title="Letters, digits, - and _ (up to 30)"
              value={d.code}
              onChange={(e) => update(i, { code: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Attributes</Label>
            <Input
              placeholder="size=M, colour=white"
              value={d.attributes}
              onChange={(e) => update(i, { attributes: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Barcode</Label>
            <Input
              maxLength={60}
              value={d.barcode}
              onChange={(e) => update(i, { barcode: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Sale price (৳)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={d.salePrice}
              onChange={(e) => update(i, { salePrice: e.target.value })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove variant"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2Icon className="text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Money cell for nullable paisa values. */
export function MoneyOrDash({ paisa }: { paisa: number | null | undefined }) {
  return paisa === null || paisa === undefined ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className="tabular-nums">{formatMoney(paisa)}</span>
  );
}
