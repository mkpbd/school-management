"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** false on the server and during hydration, true afterwards (no effect, no extra state). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
