export interface ChargeRequest {
  studentId: string;
  /** fee head code, e.g. LIB_FINE, UNIFORM */
  feeHeadCode: string;
  amountPaisa: number;
  description: string;
  /** invoice_line.source of the owning module */
  source: 'library' | 'pos' | 'external_exam' | 'fine';
  /** idempotency: the same source + sourceRef never creates a second charge */
  sourceRef: string;
  dueDate?: string;
}

export interface ChargeResult {
  invoiceId: string;
  invoiceNo: string;
  invoiceLineId: string;
  created: boolean;
}

export interface StudentFeeItemRequest {
  enrolmentId: string;
  campusId: string;
  /** fee head code, e.g. HOSTEL, MEAL, TRANSPORT */
  feeHeadCode: string;
  amountPaisa: number;
  validFrom: string;
  /** owning module and record: the item is ended through the same pair */
  sourceModule: string;
  sourceRef: string;
}

/** Public API of FEE (used by SIS withdrawal clearance, EXM admit cards, PRT portal). */
export interface FeeModuleApi {
  /** Bills a one-off charge to the student's family as an issued invoice (LIB fines, POS on account, ...). */
  raiseCharge(charge: ChargeRequest): Promise<ChargeResult>;
  /** Recurring monthly charge picked up by billing runs (student fee item). */
  addStudentFeeItem(item: StudentFeeItemRequest): Promise<{ id: string }>;
  /** Ends the open items of a source on a date (billing stops after it). Returns how many were ended. */
  endStudentFeeItems(sourceModule: string, sourceRef: string, validTo: string): Promise<number>;
  familyDues(familyId: string): Promise<{ outstandingPaisa: number; overduePaisa: number }>;
  /** Fee clearance for TC / admit cards: nothing overdue for the student's family. */
  clearanceStatus(studentId: string): Promise<{ cleared: boolean; overduePaisa: number }>;
}
