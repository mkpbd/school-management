import type { ConcessionSource, FeeLineSource, OpenLine } from '../domain/billing.js';

export interface StructureLineInput {
  feeHeadId: string;
  amountPaisa: number;
  billingMonths?: number[] | null;
  dueDay?: number;
  appliesTo?: 'all' | 'new_admission' | 'continuing';
}

export interface StructureView {
  id: string;
  campusId: string;
  academicYearId: string;
  yearGroupId: string;
  name: string;
  status: 'draft' | 'active' | 'retired';
  version: number;
  lines: Array<StructureLineInput & { id: string; headCode: string; headName: string }>;
}

export interface InvoiceView {
  id: string;
  invoiceNo: string;
  campusId: string;
  familyId: string;
  studentId: string | null;
  enrolmentId: string | null;
  billingPeriod: string | null;
  issueDate: string;
  dueDate: string;
  grossPaisa: number;
  discountPaisa: number;
  netPaisa: number;
  paidPaisa: number;
  outstandingPaisa: number;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void';
  payToken: string | null;
  lines?: Array<{
    id: string;
    feeHeadId: string;
    description: string;
    amountPaisa: number;
    discountPaisa: number;
    netPaisa: number;
    paidPaisa: number;
    source: string;
  }>;
}

export interface PaymentView {
  id: string;
  paymentNo: string;
  receiptNo: string | null;
  channel: string;
  amountPaisa: number;
  receivedAt: Date;
  status: string;
}

export interface FeeRepository {
  // structures
  insertStructure(header: Record<string, unknown>, lines: Array<StructureLineInput>): Promise<string>;
  getStructure(id: string): Promise<StructureView | null>;
  activateStructure(id: string): Promise<void>;
  activeStructureSources(
    campusId: string,
    academicYearId: string,
    yearGroupId: string,
  ): Promise<{ structureId: string; dueDay: number; sources: FeeLineSource[] } | null>;
  studentItemSources(enrolmentId: string, onDate: string): Promise<FeeLineSource[]>;
  // concessions
  approvedConcessions(studentId: string, onDate: string): Promise<ConcessionSource[]>;
  concessionType(id: string): Promise<{ id: string; calc: 'percent' | 'amount'; requiresApproval: boolean } | null>;
  insertConcession(values: Record<string, unknown>): Promise<{ id: string; status: string }>;
  concessionForUpdate(id: string): Promise<{ id: string; campusId: string; status: string } | null>;
  setConcessionStatus(id: string, status: 'approved' | 'rejected' | 'revoked'): Promise<void>;
  // invoices
  invoiceExistsFor(enrolmentId: string, period: string): Promise<boolean>;
  hasInvoiceInYear(enrolmentId: string): Promise<boolean>;
  insertInvoice(values: Record<string, unknown>): Promise<string>;
  insertInvoiceLines(
    invoiceId: string,
    orgId: string,
    campusId: string,
    lines: Array<Record<string, unknown>>,
  ): Promise<void>;
  issueInvoice(id: string): Promise<InvoiceView>;
  getInvoice(id: string, withLines: boolean): Promise<InvoiceView | null>;
  listInvoices(f: {
    familyId?: string;
    studentId?: string;
    campusId?: string;
    status?: string;
    period?: string;
    overdueOn?: string;
    limit: number;
    offset: number;
  }): Promise<InvoiceView[]>;
  voidInvoice(id: string, reason: string): Promise<void>;
  insertStudentFeeItem(values: Record<string, unknown>): Promise<string>;
  endStudentFeeItems(sourceModule: string, sourceRef: string, validTo: string): Promise<number>;
  feeHeadByCode(code: string): Promise<{ id: string; priority: number } | null>;
  /** non-void invoice line raised earlier for this source + reference */
  chargeLine(
    source: string,
    sourceRef: string,
  ): Promise<{ invoiceId: string; invoiceNo: string; lineId: string } | null>;
  // payments
  lockOpenLines(f: { familyId: string; campusId: string; invoiceIds?: string[] }): Promise<OpenLine[]>;
  insertPayment(values: Record<string, unknown>): Promise<string>;
  insertAllocations(rows: Array<Record<string, unknown>>): Promise<void>;
  insertReceipt(values: Record<string, unknown>): Promise<void>;
  familyPayments(familyId: string): Promise<PaymentView[]>;
  familyCreditPaisa(familyId: string): Promise<number>;
  invoiceNumbers(ids: string[]): Promise<Map<string, string>>;
  // cash sessions
  openCashSession(userId: string): Promise<{ id: string; campusId: string; openingFloatPaisa: number } | null>;
  insertCashSession(values: Record<string, unknown>): Promise<{ id: string }>;
  cashSessionForUpdate(
    id: string,
  ): Promise<{ id: string; cashierUserId: string; status: string; openingFloatPaisa: number } | null>;
  cashCollected(sessionId: string): Promise<number>;
  closeCashSession(id: string, expected: number, counted: number, handedOverTo: string | null, at: Date): Promise<void>;
  // billing runs
  /** Inserts or joins (row-locked) the campus's run for the period. */
  lockBillingRun(values: {
    orgId: string;
    campusId: string;
    academicYearId: string;
    billingPeriod: string;
  }): Promise<{ id: string; academicYearId: string }>;
  billingRunForUpdate(
    id: string,
  ): Promise<{ id: string; campusId: string; academicYearId: string; billingPeriod: string; status: string } | null>;
  /** Marks the run posted and adds this pass's invoice count and total. */
  finishBillingRun(id: string, count: number, totalNet: number, postedBy: string, at: Date): Promise<void>;
}
