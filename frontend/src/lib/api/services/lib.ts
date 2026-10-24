import { client, idempotencyKey, unwrap } from "../client";
import { deletableResource, resource } from "../resource";
import type { Body, IdempotencyOptions, Query, Row } from "../types";

// Response shapes (backend/src/modules/lib/application/ports.ts, LibraryUseCases.ts). Type aliases, so they are
// assignable to Row.

export type LibMemberType =
  "staff" | "student_junior" | "student_senior" | "teacher";
export type BorrowerType = "student" | "staff";
export type CopyStatus =
  | "available"
  | "on_loan"
  | "reserved"
  | "lost"
  | "damaged"
  | "withdrawn"
  | "in_repair";
export type ReturnCondition = "good" | "damaged" | "lost";
export type ReservationStatus =
  "waiting" | "ready" | "fulfilled" | "cancelled" | "expired";
export type DigitalKind = "ebook" | "past_paper" | "journal" | "video";

export type TitleSummary = {
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
};

export type CopyRow = {
  id: string;
  campusId: string;
  bookTitleId: string;
  title: string;
  accessionNo: string;
  barcode: string;
  shelfLocation: string | null;
  pricePaisa: number | null;
  status: CopyStatus;
};

export type TitleDetail = TitleSummary & { copiesList: CopyRow[] };

export type LoanRow = {
  id: string;
  campusId: string;
  bookCopyId: string;
  bookTitleId: string;
  title: string;
  accessionNo: string;
  borrowerType: BorrowerType;
  borrowerId: string;
  issuedAt: string;
  dueOn: string;
  renewCount: number;
  returnedAt: string | null;
  returnCondition: ReturnCondition | null;
  finePaisa: number;
  fineInvoiceLineId: string | null;
  borrowerName?: string;
  overdueDays?: number;
};

export type ReservationRow = {
  id: string;
  campusId: string;
  bookTitleId: string;
  title: string;
  borrowerType: BorrowerType;
  borrowerId: string;
  reservedAt: string;
  readyCopyId: string | null;
  expiresAt: string | null;
  status: ReservationStatus;
};

export type MemberPolicy = {
  memberType: LibMemberType;
  maxLoans: number;
  loanDays: number;
  maxRenewals: number;
  finePerDayPaisa: number;
};

export type BorrowerAccount = {
  borrower: {
    type: BorrowerType;
    id: string;
    name: string;
    memberType: LibMemberType;
    active: boolean;
  };
  policy: MemberPolicy | null;
  activeLoans: LoanRow[];
  history: LoanRow[];
  reservations: ReservationRow[];
  totals: { active: number; overdue: number; finesPaisa: number };
};

export type IssueResult = {
  loanId: string;
  title: string;
  accessionNo: string;
  borrower: {
    type: BorrowerType;
    id: string;
    name: string;
    memberType: LibMemberType;
  };
  dueOn: string;
  activeLoans: number;
  maxLoans: number;
  reservationFulfilled: string | null;
};

export type ReturnResult = {
  loanId: string;
  title: string;
  accessionNo: string;
  borrower: { type: BorrowerType; id: string; name: string };
  overdueDays: number;
  fine: {
    overduePaisa: number;
    replacementPaisa: number;
    damagePaisa: number;
    totalPaisa: number;
    waived: boolean;
  };
  feeInvoiceNo: string | null;
  copyStatus: string;
  heldForReservation: string | null;
};

export type StockTakeReport = {
  id: string;
  campusId: string;
  status: "in_progress" | "completed";
  startedOn: string;
  completedOn: string | null;
  expected: number;
  scanned: number;
  missing: Array<{
    copyId: string;
    accessionNo: string;
    title: string;
    status: CopyStatus;
    shelfLocation: string | null;
  }>;
  unexpected: Array<{
    copyId: string;
    accessionNo: string;
    title: string;
    status: CopyStatus;
  }>;
};

export type DigitalItemRow = {
  id: string;
  title: string;
  kind: DigitalKind;
  fileId: string | null;
  url: string | null;
  programmeId: string | null;
  yearGroupIds: string[];
  subjectId: string | null;
};

/** Library (backend/src/modules/lib/presentation/LibController.ts). Fines and prices are integer paisa. */
export const lib = {
  /** Title / subtitle / ISBN / author search with copies, available and waiting per campus. */
  catalogue: <T = TitleSummary[]>(
    query?: Query<"/api/v1/lib/catalogue", "get">,
  ) => unwrap<T>(client.GET("/api/v1/lib/catalogue", { params: { query } })),
  titles: {
    ...resource("/api/v1/lib/titles", "/api/v1/lib/titles/{id}"),
    /** Title with copies (status, shelf) and availability. */
    get: <T = TitleDetail>(
      id: string,
      query?: Query<"/api/v1/lib/titles/{id}", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/lib/titles/{id}", {
          params: { path: { id }, query },
        }),
      ),
    /** Cover image: a file uploaded with purpose library_cover (null clears it). */
    setCover: <T = Row>(
      id: string,
      body: Body<"/api/v1/lib/titles/{id}/cover", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/lib/titles/{id}/cover", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Accession copies (accession number per campus). */
    addCopies: <T = CopyRow[]>(
      id: string,
      body: Body<"/api/v1/lib/titles/{id}/copies", "post">,
      opts?: IdempotencyOptions,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/lib/titles/{id}/copies", {
          params: { path: { id } },
          body,
          headers: idempotencyKey(opts?.idempotencyKey),
        }),
      ),
  },
  copies: {
    ...resource("/api/v1/lib/copies", "/api/v1/lib/copies/{id}"),
    /** Withdraw, repair, damaged, lost, or back on the shelf. */
    setStatus: <T = Row>(
      id: string,
      body: Body<"/api/v1/lib/copies/{id}/status", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/lib/copies/{id}/status", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  circulation: {
    /** Issue a copy (barcode) to a student or staff member. */
    issue: <T = IssueResult>(
      body: Body<"/api/v1/lib/issue", "post">,
      opts?: IdempotencyOptions,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/lib/issue", {
          body,
          headers: idempotencyKey(opts?.idempotencyKey),
        }),
      ),
    /** Return a copy; overdue / lost / damage fines are billed through FEE. */
    return: <T = ReturnResult>(
      body: Body<"/api/v1/lib/return", "post">,
      opts?: IdempotencyOptions,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/lib/return", {
          body,
          headers: idempotencyKey(opts?.idempotencyKey),
        }),
      ),
    renew: <T = { loanId: string; dueOn: string; renewCount: number }>(
      loanId: string,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/lib/loans/{id}/renew", {
          params: { path: { id: loanId } },
        }),
      ),
    loans: <T = LoanRow[]>(query?: Query<"/api/v1/lib/loans", "get">) =>
      unwrap<T>(client.GET("/api/v1/lib/loans", { params: { query } })),
  },
  /** Reader account: loans, history, reservations, fines. */
  borrower: <T = BorrowerAccount>(type: BorrowerType, id: string) =>
    unwrap<T>(
      client.GET("/api/v1/lib/borrowers/{type}/{id}", {
        params: { path: { type, id } },
      }),
    ),
  /** My library account (signed-in staff member or student); 404 NOT_A_MEMBER otherwise. */
  me: <T = BorrowerAccount>() => unwrap<T>(client.GET("/api/v1/lib/me")),
  reservations: {
    create: <T = { reservationId: string; position: number }>(
      body: Body<"/api/v1/lib/reservations", "post">,
    ) => unwrap<T>(client.POST("/api/v1/lib/reservations", { body })),
    list: <T = ReservationRow[]>(
      query?: Query<"/api/v1/lib/reservations", "get">,
    ) =>
      unwrap<T>(client.GET("/api/v1/lib/reservations", { params: { query } })),
    cancel: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/lib/reservations/{id}/cancel", {
          params: { path: { id } },
        }),
      ),
  },
  tasks: {
    overdueReminders: <T = { overdue: number; reminded: number }>() =>
      unwrap<T>(client.POST("/api/v1/lib/tasks/overdue-reminders")),
    expireReservations: <T = { expired: number; passedOn: number }>() =>
      unwrap<T>(client.POST("/api/v1/lib/tasks/expire-reservations")),
  },
  stockTakes: {
    start: <T = { id: string }>(
      body: Body<"/api/v1/lib/stock-takes", "post">,
    ) => unwrap<T>(client.POST("/api/v1/lib/stock-takes", { body })),
    /** Repeat scans are ignored. */
    scan: <T = { scanned: number; alreadyScanned: number; unknown: string[] }>(
      id: string,
      body: Body<"/api/v1/lib/stock-takes/{id}/scans", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/lib/stock-takes/{id}/scans", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Expected vs scanned, missing and unexpected copies. */
    report: <T = StockTakeReport>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/lib/stock-takes/{id}", {
          params: { path: { id } },
        }),
      ),
    complete: <
      T = {
        expected: number;
        scanned: number;
        missing: number;
        markedLost: number;
        recovered: number;
      },
    >(
      id: string,
      body: Body<"/api/v1/lib/stock-takes/{id}/complete", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/lib/stock-takes/{id}/complete", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  policies: {
    /** Loan limits, loan days, renewals and daily fine per member type. */
    list: <T = MemberPolicy[]>() =>
      unwrap<T>(client.GET("/api/v1/lib/policies")),
    set: <T = MemberPolicy>(
      memberType: LibMemberType,
      body: Body<"/api/v1/lib/policies/{memberType}", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/lib/policies/{memberType}", {
          params: { path: { memberType } },
          body,
        }),
      ),
  },
  /** E-books, past papers, journals, videos (uploaded file with purpose library_digital, or https link). */
  digitalItems: {
    ...deletableResource(
      "/api/v1/lib/digital-items",
      "/api/v1/lib/digital-items/{id}",
    ),
    list: <T = DigitalItemRow[]>(
      query?: Query<"/api/v1/lib/digital-items", "get">,
    ) =>
      unwrap<T>(client.GET("/api/v1/lib/digital-items", { params: { query } })),
  },
};
