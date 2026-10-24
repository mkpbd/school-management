"use client";

import dynamic from "next/dynamic";
import type { MapViewProps } from "./types";

export type { MapLine, MapMarker, MapViewProps, MarkerTone } from "./types";

/** Leaflet needs `window`, so the map only renders in the browser. OpenStreetMap tiles. */
export const MapView = dynamic<MapViewProps>(() => import("./leaflet-map"), {
  ssr: false,
  loading: () => <div className="skeleton h-[420px] w-full rounded-xl" />,
});
