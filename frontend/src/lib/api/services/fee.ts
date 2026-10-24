import { client, idempotencyKey, unwrap } from "../client";
import { deletableResource, readOnlyResource, resource } from "../resource";
import type { Body, IdempotencyOptions, Query, Row } from "../types";

// ---- response shapes (backend/src/modules/fee/application/ports.ts, FeeUseCases.ts) ----

export type InvoiceStatus =
  "draft" | "issued" | "partially_paid" | "paid" | "void";

export type InvoiceLine = {
  id: string;
  feeHeadId: string;
  description: string;
  amountPaisa: number;
  discountPaisa: number;
  netPaisa: number;
  paidPaisa: number;
  source: string;
};

export type Invoice = {
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
  status: InvoiceStatus;
  payToken: string | null;
  lines?: InvoiceLine[];
};

export type StructureLine = {
  id: string;
  feeHeadId: string;
  amountPaisa: number;
  billingMonths?: number[] | null;
  dueDay?: number;
  appliesTo?: "all" | "new_admission" | "continuing";
  headCode: string;
  headName: string;
};

export type FeeStructure = {
  id: string;
  campusId: string;
  academicYearId: string;
  yearGroupId: string;
  name: string;
  status: "draft" | "active" | "retired";
  version: number;
  lines: StructureLine[];
};

export type Payment = {
  id: string;
  paymentNo: string;
  receiptNo: string | null;
  channel: string;
  amountPaisa: number;
  receivedAt: string;
  status: string;
};

export type FamilyStatement = {
  familyId: string;
  invoices: Invoice[];
  payments: Payment[];
  totals: {
    netPaisa: number;
    paidPaisa: number;
    outstandingPaisa: number;
    overduePaisa: number;
    creditPaisa: number;
  };
};

export type BillingPreview = {
  invoices: number;
  totalNetPaisa: number;
  skipped: Record<string, number>;
  sample: Array<{ studentId: string; netPaisa: number; lines: number }>;
};

export type BillingRunResult = {
  billingRunId: string;
  invoices: number;
  totalNetPaisa: number;
  skipped: Record<string, number>;
};

export type CounterPaymentResult = {
  paymentId: string;
  paymentNo: string;
  receiptNo: string;
  verificationCode: string;
  amountPaisa: number;
  allocatedPaisa: number;
  creditPaisa: number;
  allocations: Array<{
    invoiceId: string;
    invoiceNo: string;
    amountPaisa: number;
  }>;
};

export type CashSessionClose = {
  expectedCashPaisa: number;
  countedCashPaisa: number;
  variancePaisa: number;
};

export type Decision = { id: string; status: string };

/** Fees (backend/src/modules/fee/presentation/FeeController.ts). Amounts are integer paisa. */
export const fee = {
  heads: resource("/api/v1/fee/heads", "/api/v1/fee/heads/{id}"),
  concessionTypes: readOnlyResource(
    "/api/v1/fee/concession-types",
    "/api/v1/fee/concession-types/{id}",
  ),
  structures: {
    list: <T = Row[]>(query?: Query<"/api/v1/fee/structures", "get">) =>
      unwrap<T>(client.GET("/api/v1/fee/structures", { params: { query } })),
    /** Draft structure (campus, year, year group) with lines. */
    create: <T = FeeStructure>(body: Body<"/api/v1/fee/structures", "post">) =>
      unwrap<T>(client.POST("/api/v1/fee/structures", { body })),
    get: <T = FeeStructure>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/fee/structures/{id}", { params: { path: { id } } }),
      ),
    /** Activate (retires the previous active structure for the same campus/year/year group). */
    activate: <T = FeeStructure>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/fee/structures/{id}/activate", {
          params: { path: { id } },
        }),
      ),
  },
  studentItems: deletableResource(
    "/api/v1/fee/student-items",
    "/api/v1/fee/student-items/{id}",
  ),
  concessions: {
    /** Pending when the concession type requires approval. */
    grant: <T = Decision>(body: Body<"/api/v1/fee/concessions", "post">) =>
      unwrap<T>(client.POST("/api/v1/fee/concessions", { body })),
    decide: <T = Decision>(
      id: string,
      body: Body<"/api/v1/fee/concessions/{id}/decide", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/fee/concessions/{id}/decide", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  billing: {
    /** Dry run of a monthly billing run (nothing written). */
    preview: <T = BillingPreview>(
      body: Body<"/api/v1/fee/billing/preview", "post">,
    ) => unwrap<T>(client.POST("/api/v1/fee/billing/preview", { body })),
    /** One invoice per active enrolment; never double-bills. */
    run: <T = BillingRunResult>(
      body: Body<"/api/v1/fee/billing-runs", "post">,
      opts?: IdempotencyOptions,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/fee/billing-runs", {
          body,
          headers: idempotencyKey(opts?.idempotencyKey),
        }),
      ),
  },
  invoices: {
    /** Guardians must pass the familyId of their own children. Offset paging (limit/offset), no meta. */
    list: <T = Invoice[]>(query?: Query<"/api/v1/fee/invoices", "get">) =>
      unwrap<T>(client.GET("/api/v1/fee/invoices", { params: { query } })),
    /** Create and issue an ad-hoc invoice for a student. */
    create: <T = Invoice>(
      body: Body<"/api/v1/fee/invoices", "post">,
      opts?: IdempotencyOptions,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/fee/invoices", {
          body,
          headers: idempotencyKey(opts?.idempotencyKey),
        }),
      ),
    get: <T = Invoice>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/fee/invoices/{id}", { params: { path: { id } } }),
      ),
    /** Only when nothing has been paid. */
    void: <T = Invoice>(
      id: string,
      body: Body<"/api/v1/fee/invoices/{id}/void", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/fee/invoices/{id}/void", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  payments: {
    /** Counter payment (cash needs an open cash session); surplus becomes family credit. */
    counter: <T = CounterPaymentResult>(
      body: Body<"/api/v1/fee/payments/counter", "post">,
      opts?: IdempotencyOptions,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/fee/payments/counter", {
          body,
          headers: idempotencyKey(opts?.idempotencyKey),
        }),
      ),
  },
  cashSessions: {
    /** Open my cash session with an opening float. */
    open: <T = { id: string }>(
      body: Body<"/api/v1/fee/cash-sessions", "post">,
    ) => unwrap<T>(client.POST("/api/v1/fee/cash-sessions", { body })),
    /** Close: expected vs counted, variance. */
    close: <T = CashSessionClose>(
      id: string,
      body: Body<"/api/v1/fee/cash-sessions/{id}/close", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/fee/cash-sessions/{id}/close", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  /** Invoices, payments, outstanding, overdue, credit. */
  familyStatement: <T = FamilyStatement>(
    familyId: string,
    query?: Query<"/api/v1/fee/families/{id}/statement", "get">,
  ) =>
    unwrap<T>(
      client.GET("/api/v1/fee/families/{id}/statement", {
        params: { path: { id: familyId }, query },
      }),
    ),
};
