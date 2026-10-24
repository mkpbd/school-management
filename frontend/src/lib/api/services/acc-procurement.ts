import { client, unwrap, unwrapFile } from "../client";
import type { Body, Query } from "../types";

// Response shapes (backend/src/modules/acc/application/ProcurementUseCases.ts, procurementPorts.ts). Type aliases,
// so they are assignable to Row. Money is integer paisa; quantities have up to 3 decimals.

export type VendorRow = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  tin: string | null;
  binVat: string | null;
  tdsRatePct: number | null;
  vatRatePct: number | null;
  paymentTermsDays: number;
  performanceNote: string | null;
  isActive: boolean;
};

export type VendorStats = {
  orders: number;
  orderedPaisa: number;
  receipts: number;
  onTimePct: number | null;
  avgRating: number | null;
  billedPaisa: number;
  outstandingPaisa: number;
};

export type VendorDetail = VendorRow & { performance: VendorStats };

export type RequisitionStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "ordered"
  | "closed"
  | "cancelled";

export type RequisitionLine = {
  id: string;
  lineNo: number | null;
  description: string;
  quantity: number;
  estUnitPaisa: number | null;
  accountId: string | null;
  itemVariantId: string | null;
};

export type RequisitionRow = {
  id: string;
  campusId: string;
  prNo: string;
  title: string | null;
  departmentId: string | null;
  costCentreId: string | null;
  requestedBy: string;
  neededBy: string | null;
  justification: string | null;
  status: RequisitionStatus;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  overBudget: boolean;
  overrunReason: string | null;
  overrunApprovedBy: string | null;
  createdAt: string;
  lines?: RequisitionLine[];
};

/** Spending beyond what the budget line (account x cost centre) has left; `key` = "accountId|costCentreId". */
export type BudgetOverrun = {
  key: string;
  accountCode: string;
  requestedPaisa: number;
  availablePaisa: number;
  overPaisa: number;
};

export type QuotationRow = {
  id: string;
  requisitionId: string;
  vendorId: string;
  vendorName: string;
  totalPaisa: number;
  validUntil: string | null;
  deliveryDays: number | null;
  quoteRef: string | null;
  note: string | null;
  fileId: string | null;
  isSelected: boolean;
  selectionReason: string | null;
};

/** Comparison sheet row: valid quotes ranked by price then delivery; expired ones last (rank null). */
export type RankedQuotation = QuotationRow & {
  rank: number | null;
  lowest: boolean;
  expired: boolean;
  aboveLowestPaisa: number | null;
};

export type RequisitionDetail = RequisitionRow & {
  estimatedPaisa: number;
  quotationsRequired: number;
  quotations: RankedQuotation[];
  /** While draft / submitted: the budget check of the estimated lines. */
  budgetCheck: { budgetId: string | null; overruns: BudgetOverrun[] } | null;
};

export type PoStatus =
  | "draft"
  | "issued"
  | "partially_received"
  | "received"
  | "billed"
  | "closed"
  | "cancelled";

export type PoLine = {
  id: string;
  lineNo: number | null;
  description: string;
  quantity: number;
  unitPaisa: number;
  receivedQty: number;
  billedQty: number;
  accountId: string | null;
  itemVariantId: string | null;
};

export type PoRow = {
  id: string;
  campusId: string;
  poNo: string;
  vendorId: string;
  vendorName: string;
  requisitionId: string | null;
  quotationId: string | null;
  costCentreId: string | null;
  orderDate: string;
  expectedOn: string | null;
  totalPaisa: number;
  status: PoStatus;
  terms: string | null;
  issuedBy: string | null;
  cancelledReason: string | null;
  lines?: PoLine[];
};

export type ReceiptRow = {
  id: string;
  grnNo: string;
  storeId: string | null;
  receivedOn: string;
  receivedBy: string;
  onTime: boolean;
  rating: number | null;
  note: string | null;
  lines: Array<{ poLineId: string; quantity: number }>;
};

export type BillStatus = "open" | "partially_paid" | "paid" | "cancelled";

export type BillRow = {
  id: string;
  campusId: string;
  vendorId: string;
  vendorName: string;
  purchaseOrderId: string | null;
  billNo: string;
  billDate: string;
  dueDate: string;
  grossPaisa: number;
  vatPaisa: number;
  tdsPaisa: number;
  netPayablePaisa: number;
  paidPaisa: number;
  status: BillStatus;
  journalId: string | null;
};

export type PaymentMethod = "bank" | "cash" | "mobile";

export type PaymentRow = {
  id: string;
  paymentNo: string;
  supplierBillId: string;
  paidOn: string;
  amountPaisa: number;
  method: PaymentMethod;
  reference: string | null;
  journalId: string | null;
};

export type PoDetail = PoRow & {
  lines: PoLine[];
  receipts: ReceiptRow[];
  bills: BillRow[];
};
export type BillDetail = BillRow & { payments: PaymentRow[] };

export type AgingRow = {
  vendorId: string;
  vendorName: string;
  currentPaisa: number;
  d1to30Paisa: number;
  d31to60Paisa: number;
  d61to90Paisa: number;
  over90Paisa: number;
  totalPaisa: number;
};

export type PayablesAging = {
  asOf: string;
  vendors: AgingRow[];
  totalPaisa: number;
};

/**
 * Procurement (backend/src/modules/acc/presentation/ProcurementController.ts): supplier master, purchase
 * requisitions with budget check and quotation comparison, purchase orders, goods receipts, supplier bills
 * (three-way match, VAT / TDS withheld), payments and payables aging.
 */
export const procurement = {
  vendors: {
    /** Supplier master (search by name / code, active filter). */
    list: <T = VendorRow[]>(query?: Query<"/api/v1/acc/vendors", "get">) =>
      unwrap<T>(client.GET("/api/v1/acc/vendors", { params: { query } })),
    /** Supplier with performance: orders, on-time deliveries, rating, billed, outstanding. */
    get: <T = VendorDetail>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/acc/vendors/{id}", { params: { path: { id } } }),
      ),
    create: <T = VendorRow>(body: Body<"/api/v1/acc/vendors", "post">) =>
      unwrap<T>(client.POST("/api/v1/acc/vendors", { body })),
    /** Rates, terms, performance note, active (the code cannot change). */
    update: <T = VendorRow>(
      id: string,
      body: Body<"/api/v1/acc/vendors/{id}", "patch">,
    ) =>
      unwrap<T>(
        client.PATCH("/api/v1/acc/vendors/{id}", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  requisitions: {
    /** Procurement staff: the campus (or `mine`); others: their own. */
    list: <T = RequisitionRow[]>(
      query?: Query<"/api/v1/acc/requisitions", "get">,
    ) =>
      unwrap<T>(client.GET("/api/v1/acc/requisitions", { params: { query } })),
    /** With lines, the quotation comparison and (while undecided) the budget check. */
    get: <T = RequisitionDetail>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/acc/requisitions/{id}", {
          params: { path: { id } },
        }),
      ),
    /** Raise a requisition for a cost centre (`submit: true` submits it at once). */
    create: <T = RequisitionRow>(
      body: Body<"/api/v1/acc/requisitions", "post">,
    ) => unwrap<T>(client.POST("/api/v1/acc/requisitions", { body })),
    /** Submit own draft (or rejected) requisition for approval. */
    submit: <T = RequisitionRow>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/acc/requisitions/{id}/submit", {
          params: { path: { id } },
        }),
      ),
    /**
     * Approve or reject (not by the requester). Beyond the budget: 422 BUDGET_EXCEEDED with `details.overruns`
     * unless the approver also holds acc.budget.approve and gives an `overrunReason`.
     */
    decide: <T = RequisitionRow & { overruns: BudgetOverrun[] }>(
      id: string,
      body: Body<"/api/v1/acc/requisitions/{id}/decide", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/acc/requisitions/{id}/decide", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Cancel a requisition that is not yet ordered. */
    cancel: <T = RequisitionRow>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/acc/requisitions/{id}/cancel", {
          params: { path: { id } },
        }),
      ),
    /** Vendor quotation for an approved requisition. */
    addQuotation: <T = QuotationRow>(
      id: string,
      body: Body<"/api/v1/acc/requisitions/{id}/quotations", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/acc/requisitions/{id}/quotations", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Choose a quotation; a reason is needed when it is not the lowest or there are too few valid quotes. */
    selectQuotation: <T = RankedQuotation[]>(
      id: string,
      quotationId: string,
      body: Body<
        "/api/v1/acc/requisitions/{id}/quotations/{quotationId}/select",
        "post"
      >,
    ) =>
      unwrap<T>(
        client.POST(
          "/api/v1/acc/requisitions/{id}/quotations/{quotationId}/select",
          {
            params: { path: { id, quotationId } },
            body,
          },
        ),
      ),
    /** Issue the PO to the selected vendor; the line total must equal the quoted price and fit the budget. */
    issuePurchaseOrder: <T = PoRow>(
      id: string,
      body: Body<"/api/v1/acc/requisitions/{id}/purchase-order", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/acc/requisitions/{id}/purchase-order", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  purchaseOrders: {
    /** Purchase orders of the active campus. */
    list: <T = PoRow[]>(query?: Query<"/api/v1/acc/purchase-orders", "get">) =>
      unwrap<T>(
        client.GET("/api/v1/acc/purchase-orders", { params: { query } }),
      ),
    /** Lines (ordered / received / billed), receipts and bills. */
    get: <T = PoDetail>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/acc/purchase-orders/{id}", {
          params: { path: { id } },
        }),
      ),
    /** Purchase order PDF for the supplier. */
    pdf: (id: string) =>
      unwrapFile(
        client.GET("/api/v1/acc/purchase-orders/{id}/pdf", {
          params: { path: { id } },
          parseAs: "blob",
        }),
        "purchase-order.pdf",
      ),
    /** Cancel an issued order with nothing received (the requisition reopens). */
    cancel: <T = PoRow>(
      id: string,
      body: Body<"/api/v1/acc/purchase-orders/{id}/cancel", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/acc/purchase-orders/{id}/cancel", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Goods receipt note (partial deliveries, rating 1-5); stock items go into `storeId`. */
    receive: <T = ReceiptRow & { poStatus: PoStatus }>(
      id: string,
      body: Body<"/api/v1/acc/purchase-orders/{id}/receipts", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/acc/purchase-orders/{id}/receipts", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Supplier bill for received, unbilled goods (default: all of it); VAT / TDS withheld; posts the journal. */
    bill: <T = BillRow>(
      id: string,
      body: Body<"/api/v1/acc/purchase-orders/{id}/bills", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/acc/purchase-orders/{id}/bills", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  bills: {
    /** Supplier bills of the active campus. */
    list: <T = BillRow[]>(query?: Query<"/api/v1/acc/supplier-bills", "get">) =>
      unwrap<T>(
        client.GET("/api/v1/acc/supplier-bills", { params: { query } }),
      ),
    /** Bill with its payments. */
    get: <T = BillDetail>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/acc/supplier-bills/{id}", {
          params: { path: { id } },
        }),
      ),
    /** Pay in full (no amount) or in part; posts Dr payable, Cr bank / cash / mobile. */
    pay: <T = { bill: BillRow; payment: PaymentRow }>(
      id: string,
      body: Body<"/api/v1/acc/supplier-bills/{id}/payments", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/acc/supplier-bills/{id}/payments", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  payables: {
    /** Accounts payable per vendor: not due, 1-30, 31-60, 61-90, over 90 days. */
    aging: <T = PayablesAging>(
      query?: Query<"/api/v1/acc/payables/aging", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/acc/payables/aging", { params: { query } }),
      ),
  },
};
