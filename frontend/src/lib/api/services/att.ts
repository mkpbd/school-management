import { client, idempotencyKey, unwrap } from "../client";
import type { Body, IdempotencyOptions, Query, Row } from "../types";

/**
 * Attendance (backend/src/modules/att/presentation/AttController.ts: student registers, corrections, leave;
 * StaffAttController.ts: staff register, check-in / out, staff leave).
 */
export const att = {
  daily: {
    /** Register sheet for a section and date (pre-filled with approved leave; edit window, period-wise flag). */
    get: <T = Row>(
      sectionId: string,
      query?: Query<"/api/v1/att/sections/{id}/daily", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/att/sections/{id}/daily", {
          params: { path: { id: sectionId }, query },
        }),
      ),
    /**
     * Mark the section (default date: today). With `markRest: true` only the exceptions are sent and everyone else
     * becomes present (or leave when approved leave covers the day); absent/late changes alert the primary guardian.
     */
    mark: <T = Row>(
      sectionId: string,
      body: Body<"/api/v1/att/sections/{id}/daily", "put">,
      query?: Query<"/api/v1/att/sections/{id}/daily", "put">,
      opts?: IdempotencyOptions,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/att/sections/{id}/daily", {
          params: { path: { id: sectionId }, query },
          body,
          headers: idempotencyKey(opts?.idempotencyKey),
        }),
      ),
    /** Class teacher view of a day: daily mark and every lesson mark per student, missed lessons counted. */
    day: <T = Row>(
      sectionId: string,
      query?: Query<"/api/v1/att/sections/{id}/day", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/att/sections/{id}/day", {
          params: { path: { id: sectionId }, query },
        }),
      ),
  },
  /** Teacher's day: registration classes and the lessons to mark (progress and edit window). */
  myRegisters: <T = Row>(query?: Query<"/api/v1/att/my-registers", "get">) =>
    unwrap<T>(client.GET("/api/v1/att/my-registers", { params: { query } })),
  periods: {
    /** Period register of a lesson, pre-filled from the daily register. */
    get: <T = Row>(
      groupId: string,
      periodId: string,
      query?: Query<
        "/api/v1/att/teaching-groups/{id}/periods/{periodId}",
        "get"
      >,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/att/teaching-groups/{id}/periods/{periodId}", {
          params: { path: { id: groupId, periodId }, query },
        }),
      ),
    /** Mark a lesson; with `markRest` only exceptions are sent (absent from a lesson while at school alerts). */
    mark: <T = Row>(
      groupId: string,
      periodId: string,
      body: Body<"/api/v1/att/teaching-groups/{id}/periods/{periodId}", "put">,
      query?: Query<
        "/api/v1/att/teaching-groups/{id}/periods/{periodId}",
        "put"
      >,
      opts?: IdempotencyOptions,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/att/teaching-groups/{id}/periods/{periodId}", {
          params: { path: { id: groupId, periodId }, query },
          body,
          headers: idempotencyKey(opts?.idempotencyKey),
        }),
      ),
  },
  corrections: {
    /** Correction queue (approvers) or own requests (`mine: "true"`). */
    list: <T = Row[]>(query?: Query<"/api/v1/att/corrections", "get">) =>
      unwrap<T>(client.GET("/api/v1/att/corrections", { params: { query } })),
    /** Ask to change a daily or lesson mark after the edit window (applied when someone else approves). */
    request: <T = Row>(body: Body<"/api/v1/att/corrections", "post">) =>
      unwrap<T>(client.POST("/api/v1/att/corrections", { body })),
    /** Approve (applies the change, audited) or reject; never by the requester. */
    decide: <T = Row>(
      id: string,
      body: Body<"/api/v1/att/corrections/{id}/decide", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/att/corrections/{id}/decide", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Withdraw own pending correction. */
    cancel: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/att/corrections/{id}/cancel", {
          params: { path: { id } },
        }),
      ),
  },
  /** Audit trail of a student's marks on a date (who changed what, when) with corrections. */
  studentHistory: <T = Row>(
    studentId: string,
    query: Query<"/api/v1/att/students/{id}/history", "get">,
  ) =>
    unwrap<T>(
      client.GET("/api/v1/att/students/{id}/history", {
        params: { path: { id: studentId }, query },
      }),
    ),
  /** Attendance % for a student (default: academic year to date). */
  studentSummary: <T = Row>(
    studentId: string,
    query?: Query<"/api/v1/att/students/{id}/summary", "get">,
  ) =>
    unwrap<T>(
      client.GET("/api/v1/att/students/{id}/summary", {
        params: { path: { id: studentId }, query },
      }),
    ),
  leaves: {
    /** Apply for student leave (guardians: own children). */
    apply: <T = Row>(body: Body<"/api/v1/att/student-leaves", "post">) =>
      unwrap<T>(client.POST("/api/v1/att/student-leaves", { body })),
    list: <T = Row[]>(query?: Query<"/api/v1/att/student-leaves", "get">) =>
      unwrap<T>(
        client.GET("/api/v1/att/student-leaves", { params: { query } }),
      ),
    /** Approve or reject (approval marks the school days as leave). */
    decide: <T = Row>(
      id: string,
      body: Body<"/api/v1/att/student-leaves/{id}/decide", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/att/student-leaves/{id}/decide", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  staff: {
    /** Leave types (quota, carry-forward, paid / unpaid). */
    leaveTypes: <T = Row[]>() =>
      unwrap<T>(client.GET("/api/v1/att/staff-leave-types")),
    /** Leave balances of a year (own, or `staffId` with att.staff_leave.view). */
    leaveBalances: <T = Row[]>(
      query: Query<"/api/v1/att/staff-leave-balances", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/att/staff-leave-balances", { params: { query } }),
      ),
    leaves: {
      /** Apply for leave (own; HR may apply for others); days counted on school days. */
      apply: <T = Row>(
        body: Body<"/api/v1/att/staff-leaves", "post">,
        opts?: IdempotencyOptions,
      ) =>
        unwrap<T>(
          client.POST("/api/v1/att/staff-leaves", {
            body,
            headers: idempotencyKey(opts?.idempotencyKey),
          }),
        ),
      /** Leave requests (own, or all with att.staff_leave.view). */
      list: <T = Row[]>(query?: Query<"/api/v1/att/staff-leaves", "get">) =>
        unwrap<T>(
          client.GET("/api/v1/att/staff-leaves", { params: { query } }),
        ),
      /** Approve (marks attendance "leave") or reject; never your own. */
      decide: <T = Row>(
        id: string,
        body: Body<"/api/v1/att/staff-leaves/{id}/decide", "post">,
      ) =>
        unwrap<T>(
          client.POST("/api/v1/att/staff-leaves/{id}/decide", {
            params: { path: { id } },
            body,
          }),
        ),
      /** Cancel (applicant before the leave starts, or the approver); days are returned. */
      cancel: <T = Row>(id: string) =>
        unwrap<T>(
          client.POST("/api/v1/att/staff-leaves/{id}/cancel", {
            params: { path: { id } },
          }),
        ),
    },
    daily: {
      /** Staff register of a campus and date. */
      get: <T = Row>(query: Query<"/api/v1/att/staff-daily", "get">) =>
        unwrap<T>(client.GET("/api/v1/att/staff-daily", { params: { query } })),
      /** Mark the staff register (late / early / overtime computed from times). */
      mark: <T = Row>(
        query: Query<"/api/v1/att/staff-daily", "put">,
        body: Body<"/api/v1/att/staff-daily", "put">,
        opts?: IdempotencyOptions,
      ) =>
        unwrap<T>(
          client.PUT("/api/v1/att/staff-daily", {
            params: { query },
            body,
            headers: idempotencyKey(opts?.idempotencyKey),
          }),
        ),
    },
    /** Check in (location checked against the campus geofence when set). */
    checkIn: <T = Row>(body: Body<"/api/v1/att/staff/me/check-in", "post">) =>
      unwrap<T>(client.POST("/api/v1/att/staff/me/check-in", { body })),
    /** Check out (overtime / early leave computed). */
    checkOut: <T = Row>(body: Body<"/api/v1/att/staff/me/check-out", "post">) =>
      unwrap<T>(client.POST("/api/v1/att/staff/me/check-out", { body })),
    /** Month of a staff member (own without `staffId`): days and payroll summary (unpaid days, overtime). */
    month: <T = Row>(query: Query<"/api/v1/att/staff-month", "get">) =>
      unwrap<T>(client.GET("/api/v1/att/staff-month", { params: { query } })),
  },
};
