"use client";

import { useEffect } from "react";
import { captureTracking } from "./tracking";

/** Records the first-touch campaign / UTM data on pages without a form (e.g. the admissions landing page). */
export function TrackVisit() {
  useEffect(() => {
    captureTracking();
  }, []);
  return null;
}
