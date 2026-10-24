import type { ReactNode } from "react";

export type MarkerTone =
  "moving" | "idle" | "offline" | "stop" | "home" | "alert" | "default";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  /** Up to 3 characters drawn inside the dot (e.g. route code, stop order). */
  label?: string;
  /** Hover text. */
  title?: string;
  popup?: ReactNode;
  tone?: MarkerTone;
  /** Degrees; draws a direction arrow. */
  heading?: number | null;
}

export interface MapLine {
  id: string;
  points: [number, number][];
  color?: string;
  dashed?: boolean;
}

export interface MapViewProps {
  markers?: MapMarker[];
  lines?: MapLine[];
  height?: number | string;
  /** Change it to re-fit the view to the content (e.g. on a new selection, not on every live update). */
  fitKey?: string;
  center?: [number, number];
  zoom?: number;
  /** Map click (e.g. pick a stop location). */
  onClick?: (lat: number, lng: number) => void;
  onMarkerClick?: (id: string) => void;
  selectedId?: string;
}
