"use client";

import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Mutation with toasts and cache invalidation. Throws are shown as an error toast; callers can still
 * `await mutateAsync` (it rejects) or just call `mutate`.
 */
export function useAction<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  opts: {
    success?: string | ((r: TResult) => string);
    invalidate?: QueryKey[];
    onSuccess?: (r: TResult) => void;
    /** false when the caller shows the error itself (forms). */
    toastError?: boolean;
  } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      if (opts.success)
        toast.success(
          typeof opts.success === "function"
            ? opts.success(result)
            : opts.success,
        );
      await Promise.all([
        ...(opts.invalidate ?? []).map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
        queryClient.invalidateQueries({ queryKey: ["ref"] }),
      ]);
      opts.onSuccess?.(result);
    },
    onError: (err) =>
      opts.toastError !== false &&
      toast.error(err instanceof Error ? err.message : "Something went wrong"),
  });
}
