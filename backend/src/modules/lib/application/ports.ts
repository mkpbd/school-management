import type { BorrowerType, CopyStatus, MemberPolicy, MemberType, ReturnCondition } from '../domain/library.js';

export interface CopyRow {
  id: string;
  campusId: string;
  bookTitleId: string;
  title: string;
  accessionNo: string;
  barcode: string;
  shelfLocation: string | null;
  pricePaisa: number | null;
  status: CopyStatus;
}

export interface LoanRow {
  id: string;
  campusId: string;
  bookCopyId: string;
  bookTitleId: string;
  title: string;
  accessionNo: string;
  borrowerType: BorrowerType;
  borrowerId: string;
  issuedAt: Date;
  dueOn: string;
  renewCount: number;
  returnedAt: Date | null;
  returnCondition: ReturnCondition | null;
  finePaisa: number;
  fineInvoiceLineId: string | null;
}

export interface ReservationRow {
  id: string;
  campusId: string;
  bookTitleId: string;
  title: string;
  borrowerType: BorrowerType;
  borrowerId: string;
  reservedAt: Date;
  readyCopyId: string | null;
  expiresAt: Date | null;
  status: 'waiting' | 'ready' | 'fulfilled' | 'cancelled' | 'expired';
}

export interface TitleSummary {
  id: string;
  isbn: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  categoryCode: string | null;
  mediaType: string;
  copies: number;
  available: number;
  waiting: number;
}

export interface LoanFilter {
  status?: 'active' | 'overdue' | 'returned';
  today: string;
  campusId?: string;
  borrowerType?: BorrowerType;
  borrowerId?: string;
  titleId?: string;
  limit: number;
  offset: number;
}

export interface StockTakeReport {
  id: string;
  campusId: string;
  status: 'in_progress' | 'completed';
  startedOn: string;
  completedOn: string | null;
  /** copies expected on the shelf (available / reserved / in repair / damaged) */
  expected: number;
  scanned: number;
  missing: Array<{
    copyId: string;
    accessionNo: string;
    title: string;
    status: CopyStatus;
    shelfLocation: string | null;
  }>;
  /** scanned although the system says it is on loan, lost or withdrawn */
  unexpected: Array<{ copyId: string; accessionNo: string; title: string; status: CopyStatus }>;
}

export interface DigitalItemRow {
  id: string;
  title: string;
  kind: 'ebook' | 'past_paper' | 'journal' | 'video';
  fileId: string | null;
  url: string | null;
  programmeId: string | null;
  yearGroupIds: string[];
  subjectId: string | null;
}

export interface LibRepository {
  // catalogue
  titleExists(id: string): Promise<boolean>;
  setTitleCover(id: string, fileId: string | null): Promise<boolean>;
  titleSummaries(f: {
    ids?: string[];
    q?: string;
    campusId?: string;
    availableOnly?: boolean;
    limit: number;
    offset: number;
  }): Promise<TitleSummary[]>;
  copiesOfTitle(titleId: string): Promise<CopyRow[]>;
  insertCopies(rows: Array<Record<string, unknown>>): Promise<CopyRow[]>;
  copyByBarcode(barcode: string, forUpdate: boolean): Promise<CopyRow | null>;
  copyForUpdate(id: string): Promise<CopyRow | null>;
  setCopyStatus(id: string, status: CopyStatus): Promise<void>;
  // policy
  policy(memberType: MemberType): Promise<MemberPolicy | null>;
  policies(): Promise<MemberPolicy[]>;
  upsertPolicy(orgId: string, p: MemberPolicy): Promise<void>;
  // circulation
  insertLoan(values: Record<string, unknown>): Promise<string>;
  loan(id: string, forUpdate: boolean): Promise<LoanRow | null>;
  activeLoanOfCopy(copyId: string): Promise<LoanRow | null>;
  activeLoanCount(type: BorrowerType, id: string, today: string): Promise<{ active: number; overdue: number }>;
  hasActiveLoanOfTitle(type: BorrowerType, id: string, titleId: string): Promise<boolean>;
  closeLoan(
    id: string,
    v: { returnedAt: Date; condition: ReturnCondition; finePaisa: number; receivedBy: string | null },
  ): Promise<void>;
  setFineLine(id: string, invoiceLineId: string): Promise<void>;
  renewLoan(id: string, dueOn: string): Promise<void>;
  loans(f: LoanFilter): Promise<LoanRow[]>;
  /** active loans whose due date is before `today` (overdue reminder job) */
  overdueLoans(today: string, limit: number): Promise<LoanRow[]>;
  // reservations
  insertReservation(values: Record<string, unknown>): Promise<string>;
  reservation(id: string, forUpdate: boolean): Promise<ReservationRow | null>;
  openReservation(type: BorrowerType, id: string, titleId: string): Promise<ReservationRow | null>;
  /** oldest waiting reservation of the title at the campus, row-locked */
  nextWaiting(titleId: string, campusId: string): Promise<ReservationRow | null>;
  readyReservationForCopy(copyId: string): Promise<ReservationRow | null>;
  updateReservation(
    id: string,
    patch: { status: ReservationRow['status']; readyCopyId?: string | null; expiresAt?: Date | null },
  ): Promise<void>;
  expiredReady(now: Date, limit: number): Promise<ReservationRow[]>;
  reservations(f: {
    campusId?: string;
    status?: string;
    borrowerType?: BorrowerType;
    borrowerId?: string;
    limit: number;
    offset: number;
  }): Promise<ReservationRow[]>;
  // stock take
  inProgressStockTake(campusId: string): Promise<{ id: string } | null>;
  insertStockTake(values: Record<string, unknown>): Promise<string>;
  stockTake(
    id: string,
    forUpdate: boolean,
  ): Promise<{ id: string; campusId: string; status: 'in_progress' | 'completed' } | null>;
  copiesByBarcodes(campusId: string, barcodes: string[]): Promise<Array<{ id: string; barcode: string }>>;
  addScans(stockTakeId: string, copyIds: string[], condition: string | null): Promise<number>;
  stockTakeReport(id: string): Promise<StockTakeReport | null>;
  completeStockTake(id: string, on: string): Promise<void>;
  // digital library
  insertDigitalItem(values: Record<string, unknown>): Promise<DigitalItemRow>;
  digitalItems(f: {
    q?: string;
    kind?: string;
    subjectId?: string;
    /** only items open to every class or to this year group */
    yearGroupId?: string;
    limit: number;
    offset: number;
  }): Promise<DigitalItemRow[]>;
}
