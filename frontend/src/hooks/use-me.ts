"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useHydrated } from "@/hooks/use-hydrated";
import { api, type Me } from "@/lib/api";

export const meQueryKey = ["me"] as const;

/**
 * Current user + grants. Until hydration finishes it reports "pending" even when the query is already cached:
 * page segments hydrate after the shell has loaded /me, and permission-dependent markup must match the server.
 */
export function useMe(): UseQueryResult<Me> {
  const hydrated = useHydrated();
  const q = useQuery({
    queryKey: meQueryKey,
    queryFn: async () => (await api.auth.me()).data,
    staleTime: 5 * 60_000,
  });
  if (hydrated) return q;
  return {
    ...q,
    data: undefined,
    error: null,
    status: "pending",
    isPending: true,
    isSuccess: false,
    isError: false,
  } as UseQueryResult<Me>;
}

/** UI-only permission check (`module.resource.action`, or any of several); the backend enforces it again. */
export function can(
  me: Me | undefined,
  permission: string | string[],
): boolean {
  const list = Array.isArray(permission) ? permission : [permission];
  return list.some((p) => Boolean(me?.permissions[p]?.length));
}
