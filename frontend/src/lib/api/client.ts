import createClient, { type Middleware } from "openapi-fetch";
import { toApiError } from "./errors";
import type { paths } from "./schema";
import type { ApiResult, UpdateOptions } from "./types";

/**
 * Browser: same origin ("/api/*" is rewritten to the backend in next.config.ts).
 * Server (route handlers, server components): talk to the backend directly.
 */
export const API_BASE_URL =
  typeof window === "undefined"
    ? (process.env.BACKEND_URL ?? "http://localhost:8080")
    : "";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Auth endpoints never trigger a refresh-and-retry (a failed login is not an expired session). */
const NO_REFRESH_PREFIX = "/api/v1/auth/";
const REFRESHABLE_CODES = new Set(["TOKEN_EXPIRED", "UNAUTHENTICATED"]);

// ---- active campus (X-Campus-Id) ----

const CAMPUS_KEY = "sms.activeCampusId";
let activeCampusId: string | null = null;

export function getActiveCampus(): string | null {
  if (activeCampusId === null && typeof window !== "undefined") {
    try {
      activeCampusId = window.localStorage.getItem(CAMPUS_KEY);
    } catch {
      /* storage blocked */
    }
  }
  return activeCampusId;
}

/** Campus used for writes; must be one of the user's campuses (403 OUT_OF_SCOPE otherwise). */
export function setActiveCampus(id: string | null): void {
  activeCampusId = id;
  try {
    if (id) window.localStorage.setItem(CAMPUS_KEY, id);
    else window.localStorage.removeItem(CAMPUS_KEY);
  } catch {
    /* storage blocked */
  }
}

// ---- CSRF (double-submit: readable csrf cookie -> X-CSRF-Token header) ----

export function readCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "csrf" || name === "__Host-csrf")
      return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

// ---- session refresh ----

let refreshing: Promise<boolean> | null = null;
let sessionExpiredHandler: (() => void) | null = null;

/** Called once the refresh token is gone too (redirect to login). */
export function onSessionExpired(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

/** Rotates the refresh cookie. Concurrent 401s share one refresh call. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function authFetch(request: Request): Promise<Response> {
  const retry = request.clone();
  const res = await fetch(request);
  if (
    res.status !== 401 ||
    new URL(request.url).pathname.startsWith(NO_REFRESH_PREFIX)
  )
    return res;

  const code = await res
    .clone()
    .json()
    .then((b: { code?: string }) => b?.code)
    .catch(() => undefined);
  if (!code || !REFRESHABLE_CODES.has(code)) return res;

  if (!(await refreshSession())) {
    sessionExpiredHandler?.();
    return res;
  }
  const headers = new Headers(retry.headers);
  const csrf = readCsrfToken();
  if (csrf) headers.set("X-CSRF-Token", csrf);
  return fetch(new Request(retry, { headers }));
}

const headersMiddleware: Middleware = {
  onRequest({ request }) {
    if (!SAFE_METHODS.has(request.method)) {
      const csrf = readCsrfToken();
      if (csrf && !request.headers.has("X-CSRF-Token"))
        request.headers.set("X-CSRF-Token", csrf);
    }
    const campus = getActiveCampus();
    if (campus && !request.headers.has("X-Campus-Id"))
      request.headers.set("X-Campus-Id", campus);
    return request;
  },
};

/** Typed client for every endpoint in the OpenAPI contract (src/lib/api/schema.d.ts). */
export const client = createClient<paths>({
  baseUrl: API_BASE_URL,
  credentials: "include",
  fetch: authFetch,
});
client.use(headersMiddleware);

// ---- helpers used by the services ----

interface FetchResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

/** Unwraps `{ data, meta }`, reads the ETag row version, and throws ApiError on problem+json. */
export async function unwrap<T, M = Record<string, unknown>>(
  call: Promise<FetchResult>,
): Promise<ApiResult<T, M>> {
  let r: FetchResult;
  try {
    r = await call;
  } catch {
    throw toApiError(0, undefined);
  }
  if (r.error !== undefined || !r.response.ok)
    throw toApiError(r.response.status, r.error);
  const body = (r.data ?? {}) as { data?: T; meta?: M };
  const etag = r.response.headers.get("ETag");
  const rowVersion = etag
    ? Number(etag.replace(/^W\//, "").replace(/"/g, ""))
    : undefined;
  return {
    data: (body.data ?? null) as T,
    ...(body.meta ? { meta: body.meta } : {}),
    ...(Number.isInteger(rowVersion) ? { rowVersion } : {}),
  };
}

export function ifMatch(opts?: UpdateOptions): Record<string, string> {
  return opts?.rowVersion !== undefined
    ? { "If-Match": `"${opts.rowVersion}"` }
    : {};
}

export function idempotencyKey(key?: string): Record<string, string> {
  return { "Idempotency-Key": key ?? crypto.randomUUID() };
}

// ---- binary responses (PDF, CSV) ----

export interface DownloadedFile {
  blob: Blob;
  filename: string;
  /** Response headers (e.g. X-Missing-Accounts on the bank advice). */
  headers: Headers;
}

/** For calls made with `parseAs: "blob"`: the file + its name from Content-Disposition. */
export async function unwrapFile(
  call: Promise<FetchResult>,
  fallbackName: string,
): Promise<DownloadedFile> {
  let r: FetchResult;
  try {
    r = await call;
  } catch {
    throw toApiError(0, undefined);
  }
  if (r.error !== undefined || !r.response.ok)
    throw toApiError(r.response.status, r.error);
  const disposition = r.response.headers.get("Content-Disposition") ?? "";
  const name = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  return {
    blob: r.data as Blob,
    filename: name ? decodeURIComponent(name) : fallbackName,
    headers: r.response.headers,
  };
}

/** Save a downloaded file ("attachment"), or open it in a new tab (PDF preview). */
export function deliverFile(
  file: DownloadedFile,
  mode: "save" | "open" = "save",
): void {
  const url = URL.createObjectURL(file.blob);
  if (mode === "open") {
    window.open(url, "_blank", "noopener");
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
