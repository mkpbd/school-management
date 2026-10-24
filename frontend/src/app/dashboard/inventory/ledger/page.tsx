"use client";

import { useQuery } from "@tanstack/react-query";
import { BoxesIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import {
  formatDelta,
  formatQty,
  invStoresRef,
  MoneyOrDash,
} from "@/components/inv/shared";
import { stockLabel } from "@/components/inv/stock-actions";
import { Empty, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { MovementRow, MovementType } from "@/lib/api/services/inv";
import { humanize } from "@/lib/format";

const TYPE_TONE: Partial<Record<MovementType, string>> = {
  opening: "badge-info",
  receipt: "badge-success",
  transfer_in: "badge-success",
  sale_return: "badge-success",
  issue: "badge-warning",
  transfer_out: "badge-warning",
  sale: "badge-warning",
  write_off: "badge-error",
  adjustment: "badge-ghost",
};

export default function InventoryLedgerPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LedgerView />
    </Suspense>
  );
}

function LedgerView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const storeId = params.get("storeId") ?? "";
  const variantId = params.get("variantId") ?? "";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const go = (next: { storeId?: string; variantId?: string }) => {
    const s = next.storeId ?? storeId;
    const v = next.variantId ?? (next.storeId !== undefined ? "" : variantId);
    const qs = new URLSearchParams({
      ...(s ? { storeId: s } : {}),
      ...(s && v ? { variantId: v } : {}),
    }).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  // item filter options: what the store holds (shared with the stock page)
  const stock = useQuery({
    queryKey: ["inv.stock", storeId, {}],
    enabled: Boolean(storeId),
    queryFn: () => api.inv.stores.stock(storeId, {}),
  });
  const query = {
    ...(variantId ? { variantId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const movements = useQuery({
    queryKey: ["inv.movements", storeId, query],
    enabled: Boolean(storeId),
    queryFn: () => api.inv.stores.movements(storeId, query),
  });
  const store = stock.data?.data.store;
  const rows = movements.data?.data;

  return (
    <>
      <PageHeader
        title={store ? `Ledger — ${store.name}` : "Stock ledger"}
        description="Every movement of a store, newest first, with the balance after it. Up to 1000 rows; narrow by item or dates."
        actions={
          storeId && (
            <Button
              nativeButton={false}
              variant="outline"
              render={
                <Link href={`/dashboard/inventory/stock?storeId=${storeId}`} />
              }
            >
              <BoxesIcon /> Stock
            </Button>
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
                onChange={(id) => go({ storeId: id })}
              />
            </div>
            <select
              className="select select-sm h-8 sm:w-72"
              value={variantId}
              disabled={!storeId}
              onChange={(e) => go({ variantId: e.target.value })}
            >
              <option value="">All items</option>
              {(stock.data?.data.rows ?? []).map((r) => (
                <option key={r.variantId} value={r.variantId}>
                  {stockLabel(r)}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              From
              <Input
                type="date"
                className="w-40"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              To
              <Input
                type="date"
                className="w-40"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>

          {!storeId ? (
            <Empty>Choose a store to see its ledger.</Empty>
          ) : (
            <DataTable<MovementRow>
              rows={rows}
              isPending={movements.isPending}
              error={movements.error}
              rowKey={(m) => String(m.id)}
              empty="No movements in this period."
              columns={[
                { key: "movedAt", label: "When", type: "datetime" },
                {
                  key: "itemName",
                  label: "Item",
                  render: (m) => (
                    <div>
                      <div className="font-medium">{m.itemName}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {m.sku}
                        {m.variantCode !== "STD" ? ` · ${m.variantCode}` : ""}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "movementType",
                  label: "Type",
                  render: (m) => (
                    <span
                      className={`badge badge-soft badge-sm whitespace-nowrap ${TYPE_TONE[m.movementType] ?? "badge-ghost"}`}
                    >
                      {humanize(m.movementType)}
                    </span>
                  ),
                },
                {
                  key: "qtyDelta",
                  label: "Qty",
                  className: "text-right",
                  render: (m) => (
                    <span
                      className={`tabular-nums font-medium ${m.qtyDelta < 0 ? "text-error" : "text-success"}`}
                    >
                      {formatDelta(m.qtyDelta)}
                    </span>
                  ),
                },
                {
                  key: "balanceQty",
                  label: "Balance",
                  className: "text-right",
                  render: (m) => (
                    <span className="tabular-nums">
                      {formatQty(m.balanceQty)}
                    </span>
                  ),
                },
                {
                  key: "unitCostPaisa",
                  label: "Unit cost",
                  className: "text-right",
                  render: (m) => <MoneyOrDash paisa={m.unitCostPaisa} />,
                },
                { key: "issuedTo", label: "Issued to" },
                {
                  key: "reason",
                  label: "Reason",
                  className: "max-w-56 whitespace-normal",
                },
                {
                  key: "refType",
                  label: "Reference",
                  render: (m) =>
                    m.refType ? (
                      <span className="text-xs">
                        {humanize(m.refType)}
                        {m.refId && (
                          <span className="font-mono text-muted-foreground">
                            {" "}
                            {m.refId.slice(0, 8)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    ),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
