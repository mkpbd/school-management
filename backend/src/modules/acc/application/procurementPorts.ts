import type { AccountKind } from '../domain/journal.js';

export interface VendorRow {
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
}

export interface VendorStats {
  orders: number;
  orderedPaisa: number;
  receipts: number;
  onTimePct: number | null;
  avgRating: number | null;
  billedPaisa: number;
  outstandingPaisa: number;
}

export interface CostCentreRow {
  id: string;
  code: string;
  nameEn: string;
  campusId: string | null;
  departmentId: string | null;
  isActive: boolean;
}

export interface AccountBrief {
  id: string;
  code: string;
  nameEn: string;
  kind: AccountKind;
  isPostable: boolean;
  isActive: boolean;
}

export interface BudgetRow {
  id: string;
  campusId: string;
  academicYearId: string;
  name: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'superseded' | 'closed';
  revisionOfId: string | null;
  submittedBy: string | null;
  submittedAt: Date | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
}

export interface BudgetLineRow {
  accountId: string;
  costCentreId: string | null;
  monthNo: number;
  amountPaisa: number;
}

export interface RequisitionLineRow {
  id: string;
  lineNo: number | null;
  description: string;
  quantity: number;
  estUnitPaisa: number | null;
  accountId: string | null;
  itemVariantId: string | null;
}

export interface RequisitionRow {
  id: string;
  campusId: string;
  prNo: string;
  title: string | null;
  departmentId: string | null;
  costCentreId: string | null;
  requestedBy: string;
  neededBy: string | null;
  justification: string | null;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'ordered' | 'closed' | 'cancelled';
  submittedAt: Date | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  overBudget: boolean;
  overrunReason: string | null;
  overrunApprovedBy: string | null;
  createdAt: Date;
  lines?: RequisitionLineRow[];
}

export interface QuotationRow {
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
}

export interface PoLineRow {
  id: string;
  lineNo: number | null;
  description: string;
  quantity: number;
  unitPaisa: number;
  receivedQty: number;
  billedQty: number;
  accountId: string | null;
  itemVariantId: string | null;
}

export interface PoRow {
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
  status: 'draft' | 'issued' | 'partially_received' | 'received' | 'billed' | 'closed' | 'cancelled';
  terms: string | null;
  issuedBy: string | null;
  cancelledReason: string | null;
  lines?: PoLineRow[];
}

export interface ReceiptRow {
  id: string;
  grnNo: string;
  storeId: string | null;
  receivedOn: string;
  receivedBy: string;
  onTime: boolean;
  rating: number | null;
  note: string | null;
  lines: Array<{ poLineId: string; quantity: number }>;
}

export interface BillRow {
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
  status: 'open' | 'partially_paid' | 'paid' | 'cancelled';
  journalId: string | null;
}

export interface PaymentRow {
  id: string;
  paymentNo: string;
  supplierBillId: string;
  paidOn: string;
  amountPaisa: number;
  method: 'bank' | 'cash' | 'mobile';
  reference: string | null;
  journalId: string | null;
}

export interface ProcurementRepository {
  // vendors and cost centres
  insertVendor(values: Record<string, unknown>): Promise<string>;
  updateVendor(id: string, patch: Record<string, unknown>): Promise<void>;
  vendor(id: string): Promise<VendorRow | null>;
  vendors(f: { q?: string; active?: boolean }): Promise<VendorRow[]>;
  vendorStats(vendorId: string): Promise<VendorStats>;
  costCentres(): Promise<CostCentreRow[]>;
  costCentre(id: string): Promise<CostCentreRow | null>;
  insertCostCentre(values: Record<string, unknown>): Promise<string>;
  accounts(ids: string[]): Promise<Map<string, AccountBrief>>;

  // budgets
  insertBudget(values: Record<string, unknown>): Promise<string>;
  budget(id: string, lock?: boolean): Promise<BudgetRow | null>;
  budgets(f: { campusId?: string | null; academicYearId?: string; status?: string }): Promise<BudgetRow[]>;
  approvedBudget(campusId: string, academicYearId: string): Promise<BudgetRow | null>;
  setBudget(id: string, patch: Record<string, unknown>): Promise<void>;
  replaceBudgetLines(budgetId: string, rows: BudgetLineRow[]): Promise<void>;
  budgetLines(budgetId: string): Promise<BudgetLineRow[]>;
  /** posted journal movements per account x cost centre (campus, date range) */
  actuals(f: {
    campusId: string;
    from: string;
    to: string;
  }): Promise<Array<{ accountId: string; costCentreId: string | null; debitPaisa: number; creditPaisa: number }>>;
  /** ordered but not yet billed, per account x cost centre (POs dated in the range, not cancelled) */
  commitments(f: {
    campusId: string;
    from: string;
    to: string;
  }): Promise<Array<{ accountId: string; costCentreId: string | null; paisa: number }>>;

  // requisitions and quotations
  insertRequisition(values: Record<string, unknown>, lines: Array<Record<string, unknown>>): Promise<string>;
  requisition(id: string, lock?: boolean): Promise<RequisitionRow | null>;
  requisitions(f: { campusId?: string | null; status?: string; requestedBy?: string }): Promise<RequisitionRow[]>;
  setRequisition(id: string, patch: Record<string, unknown>): Promise<void>;
  insertQuotation(values: Record<string, unknown>): Promise<string>;
  quotations(requisitionId: string): Promise<QuotationRow[]>;
  selectQuotation(requisitionId: string, quotationId: string, reason: string | null): Promise<void>;

  // purchase orders, receipts, bills, payments
  insertPo(values: Record<string, unknown>, lines: Array<Record<string, unknown>>): Promise<string>;
  po(id: string, lock?: boolean): Promise<PoRow | null>;
  pos(f: { campusId?: string | null; status?: string; vendorId?: string }): Promise<PoRow[]>;
  setPo(id: string, patch: Record<string, unknown>): Promise<void>;
  setPoLineQuantities(lineId: string, patch: { receivedQty?: number; billedQty?: number }): Promise<void>;
  insertReceipt(values: Record<string, unknown>, lines: Array<{ poLineId: string; quantity: number }>): Promise<string>;
  receipts(poId: string): Promise<ReceiptRow[]>;
  insertBill(
    values: Record<string, unknown>,
    lines: Array<{ poLineId: string; quantity: number; amountPaisa: number }>,
  ): Promise<string>;
  bill(id: string, lock?: boolean): Promise<BillRow | null>;
  bills(f: {
    campusId?: string | null;
    vendorId?: string;
    status?: string;
    purchaseOrderId?: string;
    open?: boolean;
  }): Promise<BillRow[]>;
  setBill(id: string, patch: Record<string, unknown>): Promise<void>;
  insertPayment(values: Record<string, unknown>): Promise<string>;
  payments(billId: string): Promise<PaymentRow[]>;
}
