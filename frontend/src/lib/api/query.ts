import createQueryHooks from "openapi-react-query";
import { client } from "./client";

/**
 * Typed TanStack Query hooks straight from the contract, for endpoints without a service wrapper:
 *
 *   const { data } = $api.useQuery("get", "/api/v1/core/today", { params: { query: { campusId } } });
 *
 * Note: `data` is the raw `{ data, meta }` envelope here; the `api.*` services unwrap it for you.
 */
export const $api = createQueryHooks(client);
