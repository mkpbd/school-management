import type { paths } from "./schema";

/** Every API path, e.g. "/api/v1/sis/students". */
export type ApiPath = keyof paths;
type Op<P extends ApiPath, M> = M extends keyof paths[P] ? paths[P][M] : never;

/** JSON request body of an operation, derived from the OpenAPI contract. */
export type Body<P extends ApiPath, M extends keyof paths[P]> =
  Op<P, M> extends {
    requestBody?: { content: { "application/json": infer B } };
  }
    ? B
    : never;

/** Query parameters of an operation, derived from the OpenAPI contract. */
export type Query<P extends ApiPath, M extends keyof paths[P]> =
  Op<P, M> extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;

/** Untyped row (most responses are not described in the contract yet). */
export type Row = Record<string, unknown>;

/** Keyset paging (search endpoints: students, staff). Pass `nextCursor` back as `cursor`. */
export interface CursorMeta {
  nextCursor: string | null;
}

/** Offset paging (master-data lists: `page`, `pageSize` up to 500). */
export interface OffsetMeta {
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Response envelope `{ data, meta }` + the ETag row version (send it back as If-Match on updates). */
export interface ApiResult<T, M = Record<string, unknown>> {
  data: T;
  meta?: M;
  rowVersion?: number;
}

export interface UpdateOptions {
  /** Row version from the last GET (ETag); prevents lost updates (412 on conflict). */
  rowVersion?: number;
}

export interface IdempotencyOptions {
  /** Reuse the same key when retrying the same action; a fresh UUID is used otherwise. */
  idempotencyKey?: string;
}

// ---- Auth ----

export type Locale = "en" | "bn";
export type LoginClient = "web" | "staff_app" | "parent_app" | "scanner";

export interface SessionUser {
  id: string;
  type: string;
  locale: Locale;
}

export interface Session {
  user: SessionUser;
  expiresIn: number;
  csrfToken?: string;
  accessToken?: string;
  refreshToken?: string;
  mfaEnrollmentRequired: boolean;
}

export type LoginResult = Session | { mfaRequired: true; mfaToken: string };

export type DataScope =
  | "org"
  | "campus"
  | "section"
  | "own_classes"
  | "own_subjects"
  | "own_children"
  | "self";

/** GET /me (backend/src/modules/iam/application/GetMe.ts). */
export interface Me {
  id: string;
  type: "staff" | "guardian" | "student" | "system" | string;
  username: string | null;
  email: string | null;
  phone: string | null;
  locale: Locale;
  mfaEnabled: boolean;
  campusIds: string[] | "*";
  /** permission code -> data scopes */
  permissions: Record<string, DataScope[]>;
  staffId?: string;
  guardianId?: string;
  studentId?: string;
}

// ---- Students ----

export type StudentStatus =
  "active" | "on_hold" | "withdrawn" | "graduated" | "alumni";

export type StudentListItem = {
  id: string;
  admissionNo: string;
  fullNameEn: string;
  fullNameBn: string | null;
  gender: "male" | "female";
  status: StudentStatus;
  campusId: string;
  classSectionId: string | null;
  rollNo: number | null;
};

// ---- System ----

export interface Accepted {
  jobId: string;
  status: "queued";
}

export interface Job {
  id: string;
  status: string;
  result?: unknown;
  error?: unknown;
  [key: string]: unknown;
}
