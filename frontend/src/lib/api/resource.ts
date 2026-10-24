import { client, ifMatch, unwrap } from "./client";
import type {
  ApiPath,
  Body,
  OffsetMeta,
  Query,
  Row,
  UpdateOptions,
} from "./types";

type Call = (
  path: string,
  init?: object,
) => Promise<{ data?: unknown; error?: unknown; response: Response }>;

/** The typed client cannot be called with a generic path; the public signatures below keep the types. */
const raw = client as unknown as Record<
  "GET" | "POST" | "PATCH" | "DELETE",
  Call
>;

/**
 * Master-data resource built by the backend's generic CRUD (backend/src/shared/http/crud.ts):
 * GET list (offset paging), GET :id (ETag), POST, PATCH :id (If-Match).
 */
export function resource<L extends ApiPath, I extends ApiPath>(
  listPath: L,
  itemPath: I,
) {
  return {
    list: <T = Row>(query?: Query<L, "get">) =>
      unwrap<T[], OffsetMeta>(raw.GET(listPath, { params: { query } })),
    get: <T = Row>(id: string) =>
      unwrap<T>(raw.GET(itemPath, { params: { path: { id } } })),
    create: <T = Row>(body: Body<L, "post">) =>
      unwrap<T>(raw.POST(listPath, { body })),
    update: <T = Row>(
      id: string,
      body: Body<I, "patch">,
      opts?: UpdateOptions,
    ) =>
      unwrap<T>(
        raw.PATCH(itemPath, {
          params: { path: { id } },
          body,
          headers: ifMatch(opts),
        }),
      ),
  };
}

/** `resource` + DELETE :id (204). */
export function deletableResource<L extends ApiPath, I extends ApiPath>(
  listPath: L,
  itemPath: I,
) {
  return {
    ...resource(listPath, itemPath),
    remove: (id: string) =>
      unwrap<null>(raw.DELETE(itemPath, { params: { path: { id } } })),
  };
}

/** Read-only resource: GET list + GET :id. */
export function readOnlyResource<L extends ApiPath, I extends ApiPath>(
  listPath: L,
  itemPath: I,
) {
  const { list, get } = resource(listPath, itemPath);
  return { list, get };
}
