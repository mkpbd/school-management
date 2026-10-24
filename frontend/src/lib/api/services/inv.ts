import { client, unwrap } from "../client";
import type { Body, Query } from "../types";

// Response shapes (backend/src/modules/inv/application/InventoryUseCases.ts). Type aliases, so they are assignable
// to Row.

export type ItemCategory =
  | "uniform"
  | "book"
  | "stationery"
  | "lab_consumable"
  | "lab_equipment"
  | "ict"
  | "cleaning"
  | "furniture"
  | "sports"
  | "other";
export type StoreKind =
  "central" | "uniform_shop" | "book_shop" | "lab" | "ict" | "sports";
export type MovementType =
  | "receipt"
  | "issue"
  | "transfer_out"
  | "transfer_in"
  | "sale"
  | "sale_return"
  | "adjustment"
  | "write_off"
  | "opening";

export type VariantRow = {
  id: string;
  itemId: string;
  code: string;
  attributes: Record<string, string>;
  barcode: string | null;
  salePricePaisa: number | null;
};

export type ItemRow = {
  id: string;
  sku: string;
  nameEn: string;
  nameBn: string | null;
  category: ItemCategory;
  unit: string;
  isSellable: boolean;
  barcode: string | null;
  isActive: boolean;
  variants?: VariantRow[];
};

export type StoreRow = {
  id: string;
  campusId: string;
  code: string;
  name: string;
  kind: StoreKind;
  keeperStaffId: string | null;
  isActive: boolean;
};

export type StockRow = {
  variantId: string;
  itemId: string;
  sku: string;
  itemName: string;
  variantCode: string;
  category: ItemCategory;
  unit: string;
  onHand: number;
  avgCostPaisa: number;
  valuePaisa: number;
  minQty: number | null;
  maxQty: number | null;
  low: boolean;
};

export type StoreStock = {
  store: StoreRow;
  rows: StockRow[];
  totalValuePaisa: number;
  lowCount: number;
};

export type MovementRow = {
  id: number;
  variantId: string;
  sku: string;
  itemName: string;
  variantCode: string;
  movementType: MovementType;
  qtyDelta: number;
  balanceQty: number | null;
  unitCostPaisa: number | null;
  refType: string | null;
  refId: string | null;
  issuedTo: string | null;
  reason: string | null;
  movedBy: string;
  movedAt: string;
};

export type ReorderLevel = {
  storeId: string;
  variantId: string;
  minQty: number;
  maxQty: number | null;
};

/**
 * Inventory (backend/src/modules/inv/presentation/InvController.ts): item master with variants, stores, stock
 * ledger (receipt, issue, transfer, count) and reorder levels. Costs and prices are integer paisa; quantities have
 * up to 3 decimals.
 */
export const inv = {
  items: {
    /** Item master with variants (search by name, SKU or barcode). */
    list: <T = ItemRow[]>(query?: Query<"/api/v1/inv/items", "get">) =>
      unwrap<T>(client.GET("/api/v1/inv/items", { params: { query } })),
    get: <T = ItemRow>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/inv/items/{id}", { params: { path: { id } } }),
      ),
    /** Without variants the item gets one standard variant STD. */
    create: <T = ItemRow>(body: Body<"/api/v1/inv/items", "post">) =>
      unwrap<T>(client.POST("/api/v1/inv/items", { body })),
    /** Deactivate (isActive false) to stop new receipts. */
    update: <T = ItemRow>(
      id: string,
      body: Body<"/api/v1/inv/items/{id}", "patch">,
    ) =>
      unwrap<T>(
        client.PATCH("/api/v1/inv/items/{id}", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Add variants (sizes / colours); returns the item with all its variants. */
    addVariants: <T = ItemRow>(
      id: string,
      body: Body<"/api/v1/inv/items/{id}/variants", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/inv/items/{id}/variants", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  stores: {
    /** Stores of the active campus. */
    list: <T = StoreRow[]>() => unwrap<T>(client.GET("/api/v1/inv/stores")),
    create: <T = StoreRow>(body: Body<"/api/v1/inv/stores", "post">) =>
      unwrap<T>(client.POST("/api/v1/inv/stores", { body })),
    /** Rename, change keeper or close (isActive false) a store. */
    update: <T = StoreRow>(
      id: string,
      body: Body<"/api/v1/inv/stores/{id}", "patch">,
    ) =>
      unwrap<T>(
        client.PATCH("/api/v1/inv/stores/{id}", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Stock on hand with average cost, value and reorder level; totals cover the whole store. */
    stock: <T = StoreStock>(
      id: string,
      query?: Query<"/api/v1/inv/stores/{id}/stock", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/inv/stores/{id}/stock", {
          params: { path: { id }, query },
        }),
      ),
    /** Stock ledger, newest first, with the balance after each movement (up to 1000 rows). */
    movements: <T = MovementRow[]>(
      id: string,
      query?: Query<"/api/v1/inv/stores/{id}/movements", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/inv/stores/{id}/movements", {
          params: { path: { id }, query },
        }),
      ),
    /** Opening balance or receipt without a purchase order. */
    receive: <T = { movements: number }>(
      id: string,
      body: Body<"/api/v1/inv/stores/{id}/receipts", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/inv/stores/{id}/receipts", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Issue note to a department or person (409 INSUFFICIENT_STOCK beyond what is on hand). */
    issue: <T = { movements: number; issueId: string }>(
      id: string,
      body: Body<"/api/v1/inv/stores/{id}/issues", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/inv/stores/{id}/issues", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Stock count: counted quantities replace the book quantities (needs inv.stock.approve). */
    count: <
      T = {
        movements: number;
        differences: Array<{ variantId: string; delta: number }>;
      },
    >(
      id: string,
      body: Body<"/api/v1/inv/stores/{id}/counts", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/inv/stores/{id}/counts", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Reorder level (minimum / maximum) of a variant in the store. */
    setLevel: <T = ReorderLevel>(
      id: string,
      variantId: string,
      body: Body<"/api/v1/inv/stores/{id}/levels/{variantId}", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/inv/stores/{id}/levels/{variantId}", {
          params: { path: { id, variantId } },
          body,
        }),
      ),
  },
  /** Move stock between stores at average cost (out and in in one transaction). */
  transfer: <T = { transferId: string; movements: number }>(
    body: Body<"/api/v1/inv/transfers", "post">,
  ) => unwrap<T>(client.POST("/api/v1/inv/transfers", { body })),
};
