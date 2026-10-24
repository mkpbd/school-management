"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRightIcon,
  ClipboardCheckIcon,
  PackageMinusIcon,
  PackagePlusIcon,
  ScrollTextIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { formatQty, invStoresRef } from "@/components/inv/shared";
import {
  StockActionDialog,
  stockLabel,
  type StockAction,
} from "@/components/inv/stock-actions";
import { Empty, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { StockRow } from "@/lib/api/services/inv";
import { formatMoney } from "@/lib/format";

export default function InventoryStockPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StockView />
    </Suspense>
  );
}

function StockView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const storeId = params.get("storeId") ?? "";
  const { data: me } = useMe();
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const [lowOnly, setLowOnly] = useState(false);
  const [action, setAction] = useState<StockAction | null>(null);
  const [level, setLevel] = useState<StockRow | null>(null);

  const query = {
    ...(search ? { q: search } : {}),
    ...(lowOnly ? { lowOnly: "true" as const } : {}),
  };
  const stock = useQuery({
    queryKey: ["inv.stock", storeId, query],
    enabled: Boolean(storeId),
    queryFn: () => api.inv.stores.stock(storeId, query),
  });
  const setLevelAction = useAction(
    ({
      variantId,
      minQty,
      maxQty,
    }: {
      variantId: string;
      minQty: number;
      maxQty: number | null;
    }) => api.inv.stores.setLevel(storeId, variantId, { minQty, maxQty }),
    { invalidate: [["inv.stock"]], toastError: false },
  );

  const data = stock.data?.data;
  const store = data?.store;
  const canMove = Boolean(store?.isActive) && can(me, "inv.stock.create");

  return (
    <>
      <PageHeader
        title={store ? `Stock — ${store.name}` : "Stock"}
        description="On hand, average cost and value per item; low = at or below the reorder minimum."
        actions={
          store && (
            <>
              <Button
                nativeButton={false}
                variant="outline"
                render={
                  <Link
                    href={`/dashboard/inventory/ledger?storeId=${store.id}`}
                  />
                }
              >
                <ScrollTextIcon /> Ledger
              </Button>
              {canMove && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setAction("receive")}
                  >
                    <PackagePlusIcon /> Receive
                  </Button>
                  <Button variant="outline" onClick={() => setAction("issue")}>
                    <PackageMinusIcon /> Issue
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setAction("transfer")}
                  >
                    <ArrowLeftRightIcon /> Transfer
                  </Button>
                </>
              )}
              {store.isActive && can(me, "inv.stock.approve") && (
                <Button variant="outline" onClick={() => setAction("count")}>
                  <ClipboardCheckIcon /> Stock count
                </Button>
              )}
            </>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="sm:w-64">
              <RefSelect
                source={invStoresRef}
                value={storeId}
                placeholder="Choose a store"
                onChange={(id) =>
                  router.replace(id ? `${pathname}?storeId=${id}` : pathname)
                }
              />
            </div>
            <div className="relative sm:w-72">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Item name or SKU"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={lowOnly}
                onChange={(e) => setLowOnly(e.target.checked)}
              />
              Low only
            </label>
          </div>

          {!storeId ? (
            <Empty>Choose a store to see its stock.</Empty>
          ) : (
            <>
              {data && (
                <div className="stats stats-vertical w-full border bg-card sm:stats-horizontal">
                  <div className="stat">
                    <div className="stat-title">Stock value</div>
                    <div className="stat-value text-2xl tabular-nums">
                      {formatMoney(data.totalValuePaisa)}
                    </div>
                    <div className="stat-desc">
                      whole store, at average cost
                    </div>
                  </div>
                  <div className="stat">
                    <div className="stat-title">Low on stock</div>
                    <div
                      className={`stat-value text-2xl ${data.lowCount ? "text-error" : ""}`}
                    >
                      {data.lowCount}
                    </div>
                    <div className="stat-desc">at or below minimum</div>
                  </div>
                  <div className="stat">
                    <div className="stat-title">Lines shown</div>
                    <div className="stat-value text-2xl">
                      {data.rows.length}
                    </div>
                    {!store?.isActive && (
                      <div className="stat-desc text-error">store closed</div>
                    )}
                  </div>
                </div>
              )}
              <DataTable<StockRow>
                rows={data?.rows}
                isPending={stock.isPending}
                error={stock.error}
                rowKey={(r) => r.variantId}
                empty={
                  lowOnly
                    ? "Nothing is low on stock."
                    : "No stock in this store yet."
                }
                columns={[
                  { key: "sku", label: "SKU", type: "mono" },
                  {
                    key: "itemName",
                    label: "Item",
                    render: (r) => (
                      <div>
                        <div className="font-medium">{r.itemName}</div>
                        {r.variantCode !== "STD" && (
                          <div className="font-mono text-xs text-muted-foreground">
                            {r.variantCode}
                          </div>
                        )}
                      </div>
                    ),
                  },
                  { key: "category", label: "Category", type: "enum" },
                  {
                    key: "onHand",
                    label: "On hand",
                    className: "text-right",
                    render: (r) => (
                      <span className="tabular-nums">
                        {formatQty(r.onHand, r.unit)}
                      </span>
                    ),
                  },
                  {
                    key: "avgCostPaisa",
                    label: "Avg cost",
                    type: "money",
                    className: "text-right",
                  },
                  {
                    key: "valuePaisa",
                    label: "Value",
                    type: "money",
                    className: "text-right",
                  },
                  {
                    key: "minQty",
                    label: "Min / max",
                    className: "text-right",
                    render: (r) =>
                      r.minQty === null && r.maxQty === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="tabular-nums">
                          {formatQty(r.minQty)} / {formatQty(r.maxQty)}
                        </span>
                      ),
                  },
                  {
                    key: "low",
                    label: "",
                    render: (r) =>
                      r.low ? (
                        <span className="badge badge-soft badge-error badge-sm">
                          Low
                        </span>
                      ) : null,
                  },
                ]}
                actions={(r) => (
                  <>
                    <Button
                      nativeButton={false}
                      variant="ghost"
                      size="xs"
                      render={
                        <Link
                          href={`/dashboard/inventory/ledger?storeId=${storeId}&variantId=${r.variantId}`}
                        />
                      }
                    >
                      <ScrollTextIcon /> Ledger
                    </Button>
                    {can(me, "inv.stock.edit") && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setLevel(r)}
                      >
                        <SlidersHorizontalIcon /> Level
                      </Button>
                    )}
                  </>
                )}
              />
            </>
          )}
        </CardContent>
      </Card>

      {store && (
        <StockActionDialog
          action={action}
          store={store}
          onOpenChange={(open) => !open && setAction(null)}
        />
      )}
      <FormDialog
        open={level !== null}
        onOpenChange={(open) => !open && setLevel(null)}
        title="Reorder level"
        description={
          level
            ? `${stockLabel(level)} in ${store?.name ?? "this store"}. Low when on hand is at or below the minimum.`
            : undefined
        }
        row={level ? { minQty: level.minQty, maxQty: level.maxQty } : undefined}
        fields={[
          { name: "minQty", label: "Minimum", type: "number", required: true },
          {
            name: "maxQty",
            label: "Maximum",
            type: "number",
            nullable: true,
            help: "Optional; not below the minimum",
          },
        ]}
        successMessage="Reorder level saved"
        // PUT replaces the level: send both values, not only the changed one.
        onSubmit={(_body, values) =>
          setLevelAction.mutateAsync({
            variantId: level!.variantId,
            minQty: Number(values.minQty),
            maxQty: values.maxQty === "" ? null : Number(values.maxQty),
          })
        }
      />
    </>
  );
}
