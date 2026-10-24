import { client, idempotencyKey, ifMatch, unwrap } from "../client";
import type {
  Body,
  CursorMeta,
  IdempotencyOptions,
  Query,
  Row,
  StudentListItem,
  UpdateOptions,
} from "../types";

/** Students (backend/src/modules/sis/presentation/SisController.ts). */
export const sis = {
  students: {
    /** Register with guardians (family auto-linked by guardian phone) and optional enrolment. */
    register: <T = Row>(
      body: Body<"/api/v1/sis/students", "post">,
      opts?: IdempotencyOptions,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/sis/students", {
          body,
          headers: idempotencyKey(opts?.idempotencyKey),
        }),
      ),
    /** Scope-filtered search (campus, own classes/subjects, own children). Keyset paging. */
    search: (query?: Query<"/api/v1/sis/students", "get">) =>
      unwrap<StudentListItem[], CursorMeta>(
        client.GET("/api/v1/sis/students", { params: { query } }),
      ),
    /** Student 360: profile, guardians, placement history, documents. */
    get: <T = Row>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/sis/students/{id}", { params: { path: { id } } }),
      ),
    update: <T = Row>(
      id: string,
      body: Body<"/api/v1/sis/students/{id}", "patch">,
      opts?: UpdateOptions,
    ) =>
      unwrap<T>(
        client.PATCH("/api/v1/sis/students/{id}", {
          params: { path: { id } },
          body,
          headers: ifMatch(opts),
        }),
      ),
    /** Add or link a guardian (same family only). */
    addGuardian: <T = Row>(
      id: string,
      body: Body<"/api/v1/sis/students/{id}/guardians", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/sis/students/{id}/guardians", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Enrol in a class section (capacity + roll number). */
    enrol: <T = Row>(
      id: string,
      body: Body<"/api/v1/sis/students/{id}/enrolments", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/sis/students/{id}/enrolments", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Transfer to another section/campus from a date (history kept). */
    transfer: <T = Row>(
      id: string,
      body: Body<"/api/v1/sis/students/{id}/transfer", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/sis/students/{id}/transfer", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Attach an uploaded, scanned file (purpose student_document). */
    attachDocument: <T = Row>(
      id: string,
      body: Body<"/api/v1/sis/students/{id}/documents", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/sis/students/{id}/documents", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  documents: {
    verify: <T = Row>(
      id: string,
      body: Body<"/api/v1/sis/documents/{id}/verify", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/sis/documents/{id}/verify", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  /** Class roster on a date (roll order). */
  roster: <T = Row[]>(
    sectionId: string,
    query?: Query<"/api/v1/sis/sections/{id}/roster", "get">,
  ) =>
    unwrap<T>(
      client.GET("/api/v1/sis/sections/{id}/roster", {
        params: { path: { id: sectionId }, query },
      }),
    ),
};
