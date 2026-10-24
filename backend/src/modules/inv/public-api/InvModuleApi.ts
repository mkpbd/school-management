export interface VariantInfo {
  id: string;
  itemId: string;
  sku: string;
  name: string;
  code: string;
  unit: string;
  isActive: boolean;
}

export interface StoreInfo {
  id: string;
  campusId: string;
  code: string;
  name: string;
  isActive: boolean;
}

/** Public API of INV (stores and stock ledger). Callers check their own permissions first. */
export interface InvModuleApi {
  variants(ids: string[]): Promise<Map<string, VariantInfo>>;
  store(id: string): Promise<StoreInfo | null>;
  /** stock received against a purchase (goods receipt): receipt movements at the purchase price */
  receivePurchase(i: {
    storeId: string;
    refType: string;
    refId: string;
    reason: string;
    lines: Array<{ variantId: string; qty: number; unitCostPaisa: number }>;
  }): Promise<void>;
}
