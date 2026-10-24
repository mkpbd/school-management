/** RFC 9457 problem body returned by the backend (backend/src/shared/http/problem.ts). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  errors?: Array<{ path: string; code: string; message: string }>;
  /** extra data of some errors, e.g. BUDGET_EXCEEDED -> { overruns } */
  details?: Record<string, unknown>;
  requestId: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem: Problem | undefined;

  constructor(status: number, problem?: Problem) {
    super(problem?.detail ?? problem?.title ?? `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code =
      problem?.code ?? (status === 0 ? "NETWORK_ERROR" : "HTTP_ERROR");
    this.problem = problem;
  }

  /** Field errors keyed by path (e.g. "body.student.firstNameEn"), for forms. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries(
      (this.problem?.errors ?? []).map((e) => [e.path, e.message]),
    );
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

function isProblem(body: unknown): body is Problem {
  return (
    typeof body === "object" &&
    body !== null &&
    "code" in body &&
    "status" in body
  );
}

export function toApiError(status: number, body: unknown): ApiError {
  return new ApiError(status, isProblem(body) ? body : undefined);
}
