import { client, ifMatch, unwrap, unwrapFile } from "../client";
import { resource } from "../resource";
import type { Body, CursorMeta, Query, Row, UpdateOptions } from "../types";

type TaxYearCode = string; // "2025-26"

/** HRM staff (StaffController), payroll (PayrollController) and CPD (CpdController) in backend/src/modules/hrm/presentation. */
export const hrm = {
  staff: {
    /** Search by name / staff no / phone, or exact NID (blind index). Keyset paging. */
    search: <T = Row>(query?: Query<"/api/v1/hrm/staff", "get">) =>
      unwrap<T[], CursorMeta>(
        client.GET("/api/v1/hrm/staff", { params: { query } }),
      ),
    get: <T = Row>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/hrm/staff/{id}", { params: { path: { id } } }),
      ),
    create: <T = Row>(body: Body<"/api/v1/hrm/staff", "post">) =>
      unwrap<T>(client.POST("/api/v1/hrm/staff", { body })),
    update: <T = Row>(
      id: string,
      body: Body<"/api/v1/hrm/staff/{id}", "patch">,
      opts?: UpdateOptions,
    ) =>
      unwrap<T>(
        client.PATCH("/api/v1/hrm/staff/{id}", {
          params: { path: { id } },
          body,
          headers: ifMatch(opts),
        }),
      ),
    /** Create the staff login with a role (campus-scoped unless campusId is null). */
    createAccount: <T = Row>(
      id: string,
      body: Body<"/api/v1/hrm/staff/{id}/account", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/staff/{id}/account", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Contracts with salary components. */
    contracts: <T = Row[]>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/hrm/staff/{id}/contracts", {
          params: { path: { id } },
        }),
      ),
    /** Basic pay + components (fixed / percent of basic / per-unit rate). */
    createContract: <T = Row>(
      id: string,
      body: Body<"/api/v1/hrm/staff/{id}/contracts", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/staff/{id}/contracts", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Salary bank account (stored encrypted; `account: null` removes it). */
    setBankAccount: <T = Row>(
      id: string,
      body: Body<"/api/v1/hrm/staff/{id}/bank-account", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/hrm/staff/{id}/bank-account", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Loan or salary advance, recovered in monthly installments by payroll. */
    grantLoan: <T = Row>(
      id: string,
      body: Body<"/api/v1/hrm/staff/{id}/loans", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/staff/{id}/loans", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Tax category, declared investment (rebate), disabled children and first-time taxpayer for an income year. */
    setTaxProfile: <T = Row>(
      id: string,
      body: Body<"/api/v1/hrm/staff/{id}/tax-profile", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/hrm/staff/{id}/tax-profile", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  departments: resource(
    "/api/v1/hrm/departments",
    "/api/v1/hrm/departments/{id}",
  ),
  designations: resource(
    "/api/v1/hrm/designations",
    "/api/v1/hrm/designations/{id}",
  ),

  // ---- payroll ----

  salaryComponents: resource(
    "/api/v1/hrm/salary-components",
    "/api/v1/hrm/salary-components/{id}",
  ),
  contracts: {
    /** Salary revision from a date (the current contract ends the day before). */
    revise: <T = Row>(
      id: string,
      body: Body<"/api/v1/hrm/contracts/{id}/revise", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/contracts/{id}/revise", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  /** Loans and advances with outstanding balance. */
  loans: <T = Row[]>(query?: Query<"/api/v1/hrm/loans", "get">) =>
    unwrap<T>(client.GET("/api/v1/hrm/loans", { params: { query } })),
  payrollRuns: {
    list: <T = Row[]>(query?: Query<"/api/v1/hrm/payroll-runs", "get">) =>
      unwrap<T>(client.GET("/api/v1/hrm/payroll-runs", { params: { query } })),
    /** Monthly payroll of a campus (`includeComponents` e.g. a festival bonus). */
    create: <T = Row>(body: Body<"/api/v1/hrm/payroll-runs", "post">) =>
      unwrap<T>(client.POST("/api/v1/hrm/payroll-runs", { body })),
    /** Payroll sheet: every payslip with totals. */
    get: <T = Row>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/hrm/payroll-runs/{id}", {
          params: { path: { id } },
        }),
      ),
    /** Monthly inputs per staff: unpaid leave days, overtime minutes, cover periods, adjustments. */
    setInputs: <T = Row>(
      id: string,
      body: Body<"/api/v1/hrm/payroll-runs/{id}/inputs", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/hrm/payroll-runs/{id}/inputs", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Unpaid days and overtime from staff attendance and leave (keeps cover periods, adjustments). */
    inputsFromAttendance: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/payroll-runs/{id}/inputs/from-attendance", {
          params: { path: { id } },
        }),
      ),
    /** Compute (or recompute) all payslips. */
    compute: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/payroll-runs/{id}/compute", {
          params: { path: { id } },
        }),
      ),
    submit: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/payroll-runs/{id}/submit", {
          params: { path: { id } },
        }),
      ),
    /** Approve or reject (not by the submitter). */
    decide: <T = Row>(
      id: string,
      body: Body<"/api/v1/hrm/payroll-runs/{id}/decision", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/payroll-runs/{id}/decision", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Payslips frozen, loan installments taken, staff notified. */
    lock: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/payroll-runs/{id}/lock", {
          params: { path: { id } },
        }),
      ),
    /** Cancel an unapproved run. */
    cancel: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/payroll-runs/{id}/cancel", {
          params: { path: { id } },
        }),
      ),
    /** Record that salaries were transferred. */
    markPaid: <T = Row>(
      id: string,
      body: Body<"/api/v1/hrm/payroll-runs/{id}/paid", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/payroll-runs/{id}/paid", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Bank advice CSV (locked or paid payroll). */
    bankAdvice: (id: string) =>
      unwrapFile(
        client.GET("/api/v1/hrm/payroll-runs/{id}/bank-advice", {
          params: { path: { id } },
          parseAs: "blob",
        }),
        "bank-advice.csv",
      ),
    /** All payslips of the run in one PDF (one page each). */
    payslipsPdf: (id: string) =>
      unwrapFile(
        client.GET("/api/v1/hrm/payroll-runs/{id}/payslips-pdf", {
          params: { path: { id } },
          parseAs: "blob",
        }),
        "payslips.pdf",
      ),
  },
  payslips: {
    /** Payslip with lines (payroll staff, or the staff member once locked). */
    get: <T = Row>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/hrm/payslips/{id}", { params: { path: { id } } }),
      ),
    /** A4 PDF; DRAFT watermark until the payroll is locked. */
    pdf: (id: string) =>
      unwrapFile(
        client.GET("/api/v1/hrm/payslips/{id}/pdf", {
          params: { path: { id } },
          parseAs: "blob",
        }),
        "payslip.pdf",
      ),
    /** My payslips (locked / paid months). */
    mine: <T = Row[]>() => unwrap<T>(client.GET("/api/v1/hrm/me/payslips")),
  },
  taxYears: {
    /** Income-tax tables per income year (monthly TDS). */
    list: <T = Row[]>() => unwrap<T>(client.GET("/api/v1/hrm/tax-years")),
    /** Save the rules of an income year (clears its verification). */
    save: <T = Row>(
      code: TaxYearCode,
      body: Body<"/api/v1/hrm/tax-years/{code}", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/hrm/tax-years/{code}", {
          params: { path: { code } },
          body,
        }),
      ),
    /** Confirm the table matches the Finance Act (removes the payroll warning). */
    verify: <T = Row>(code: TaxYearCode) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/tax-years/{code}/verify", {
          params: { path: { code } },
        }),
      ),
  },

  // ---- CPD (CpdController) ----

  /** CPD course catalogue (title, provider, hours, category, delivery). */
  cpdCourses: resource(
    "/api/v1/hrm/cpd-courses",
    "/api/v1/hrm/cpd-courses/{id}",
  ),
  cpdSessions: {
    /** Sessions with registered / capacity (any staff member can browse to register). */
    list: <T = Row[]>(query?: Query<"/api/v1/hrm/cpd-sessions", "get">) =>
      unwrap<T>(client.GET("/api/v1/hrm/cpd-sessions", { params: { query } })),
    /** Schedule a session of a course (capacity, venue, trainer). */
    schedule: <T = Row>(body: Body<"/api/v1/hrm/cpd-sessions", "post">) =>
      unwrap<T>(client.POST("/api/v1/hrm/cpd-sessions", { body })),
    /** Register yourself, or `staffId` (needs hrm.cpd.create). */
    register: <T = Row>(
      id: string,
      body: Body<"/api/v1/hrm/cpd-sessions/{id}/register", "post"> = {},
    ) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/cpd-sessions/{id}/register", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Registered staff of a session with their attendance mark. */
    registrations: <T = Row[]>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/hrm/cpd-sessions/{id}/registrations", {
          params: { path: { id } },
        }),
      ),
    /** Mark registered staff attended / absent. */
    setAttendance: <T = Row>(
      id: string,
      body: Body<"/api/v1/hrm/cpd-sessions/{id}/attendance", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/hrm/cpd-sessions/{id}/attendance", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Attendees get verified CPD hours and a certificate number. */
    complete: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/cpd-sessions/{id}/complete", {
          params: { path: { id } },
        }),
      ),
    /** Cancel a scheduled session; registered staff are notified with the reason. */
    cancel: <T = Row>(
      id: string,
      body: Body<"/api/v1/hrm/cpd-sessions/{id}/cancel", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/cpd-sessions/{id}/cancel", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  cpdRecords: {
    /** Log external training (yourself, or `staffId` with hrm.cpd.create); HR verifies it. */
    logExternal: <T = Row>(body: Body<"/api/v1/hrm/cpd-records", "post">) =>
      unwrap<T>(client.POST("/api/v1/hrm/cpd-records", { body })),
    /** Verify an external record (counts towards the target; not your own). */
    verify: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/hrm/cpd-records/{id}/verify", {
          params: { path: { id } },
        }),
      ),
    /** External records of a year waiting for verification. */
    pending: <T = Row[]>(
      query: Query<"/api/v1/hrm/cpd-records/pending", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/hrm/cpd-records/pending", { params: { query } }),
      ),
    /** Certificate PDF of a completed in-house session record. */
    certificate: (id: string) =>
      unwrapFile(
        client.GET("/api/v1/hrm/cpd-records/{id}/certificate", {
          params: { path: { id } },
          parseAs: "blob",
        }),
        "cpd-certificate.pdf",
      ),
  },
  cpd: {
    /** CPD records and hours vs target of a year (own, or `staffId` with hrm.cpd.view). */
    get: <T = Row>(query: Query<"/api/v1/hrm/cpd", "get">) =>
      unwrap<T>(client.GET("/api/v1/hrm/cpd", { params: { query } })),
    /** Verified / pending hours per staff member against the yearly target. */
    summary: <T = Row>(query: Query<"/api/v1/hrm/cpd/summary", "get">) =>
      unwrap<T>(client.GET("/api/v1/hrm/cpd/summary", { params: { query } })),
  },
};
