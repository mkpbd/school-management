"use client";

import { RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { StreamStatus } from "@/hooks/use-event-stream";
import { api, type Row } from "@/lib/api";
import { humanize } from "@/lib/format";
import type { RefSource } from "@/lib/refs";

// ---- response shapes (backend/src/modules/trn/application: TrackingUseCases.ts, ports.ts) ----

export type VehicleStatus = "moving" | "idle" | "offline" | "no_signal";
export type TripDirection = "pickup" | "drop";

export interface LivePosition {
  recordedAt: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  heading: number | null;
  source: "device" | "driver_app";
}

export interface LiveVehicle {
  vehicleId: string;
  regNo: string;
  kind: string;
  capacity: number;
  campusId: string;
  status: VehicleStatus;
  lastSeenSec: number | null;
  position: LivePosition | null;
  trip: {
    id: string;
    routeId: string;
    routeName: string;
    direction: TripDirection;
    startedAt: string | null;
  } | null;
  nextStop: {
    stopId: string;
    name: string;
    distanceMeters: number;
    etaMinutes: number;
  } | null;
}

export interface TripRow {
  id: string;
  campusId: string;
  routeId: string;
  routeName: string;
  vehicleId: string;
  tripDate: string;
  direction: TripDirection;
  startedAt: string | null;
  endedAt: string | null;
  resumed?: boolean;
  [key: string]: unknown;
}

export interface AlertRow {
  id: string;
  campusId: string;
  vehicleId: string;
  regNo: string;
  tripId: string | null;
  kind: string;
  at: string;
  lat: number | null;
  lng: number | null;
  details: unknown;
  acknowledgedAt: string | null;
  [key: string]: unknown;
}

export interface StudentBus {
  studentId: string;
  route: { id: string; code: string; name: string };
  stop: {
    id: string;
    name: string;
    lat: number | null;
    lng: number | null;
    pickupTime: string | null;
    dropTime: string | null;
  };
  vehicle: { id: string; regNo: string; kind: string } | null;
  driver: { name: string } | null;
  status: VehicleStatus;
  lastSeenSec: number | null;
  position: {
    lat: number;
    lng: number;
    speedKmh: number | null;
    heading: number | null;
    recordedAt: string;
  } | null;
  trip: {
    id: string;
    direction: TripDirection;
    startedAt: string | null;
  } | null;
  progress: {
    distanceMeters: number | null;
    etaMinutes: number | null;
    reached: boolean;
  } | null;
}

export interface RouteStop {
  stopId: string;
  seq: number;
  name: string;
  area: string | null;
  lat: number | null;
  lng: number | null;
  pickupTime: string | null;
  dropTime: string | null;
}

/** GET /trn/routes/{id}: route + ordered stops + vehicle. */
export interface RouteDetail {
  id: string;
  campusId: string;
  code: string;
  name: string;
  vehicleId: string | null;
  isActive: boolean;
  stops: RouteStop[];
  vehicle: { id: string; regNo: string; kind: string; capacity: number } | null;
  [key: string]: unknown;
}

/** Stop markers + polyline for a route (stops without coordinates are skipped). */
export function routeOverlay(
  route: RouteDetail | undefined,
  nextStopId?: string | null,
) {
  const stops = (route?.stops ?? []).filter(
    (s) => s.lat !== null && s.lng !== null,
  );
  return {
    markers: stops.map((s) => ({
      id: `stop-${s.stopId}`,
      lat: s.lat!,
      lng: s.lng!,
      label: String(s.seq),
      title: `${s.seq}. ${s.name}${s.pickupTime ? ` · pickup ${s.pickupTime.slice(0, 5)}` : ""}`,
      tone: (s.stopId === nextStopId ? "home" : "stop") as "home" | "stop",
    })),
    lines:
      stops.length > 1
        ? [
            {
              id: `route-${route!.id}`,
              points: stops.map((s) => [s.lat!, s.lng!] as [number, number]),
              dashed: true,
            },
          ]
        : [],
  };
}

export interface IngestResult {
  vehicleId: string;
  accepted: number;
  stored: number;
  rejected: number;
  tripId: string | null;
  nearStops: string[];
  alerts: string[];
}

// ---- option sources ----

export const routesRef: RefSource = {
  key: "trn.routes",
  load: async () => (await api.trn.routes.list({ pageSize: 500 })).data,
  label: (r: Row) =>
    `${String(r.name ?? "")}${r.code ? ` (${String(r.code)})` : ""}`,
};

export const vehiclesRef: RefSource = {
  key: "trn.vehicles",
  load: async () => (await api.trn.vehicles.list({ pageSize: 500 })).data,
  label: (r: Row) =>
    `${String(r.regNo ?? "")}${r.kind ? ` · ${humanize(r.kind)}` : ""}`,
};

// ---- helpers ----

/** Current time, ticking every `ms` after mount (null during SSR / hydration). */
export function useNow(ms = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, ms);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [ms]);
  return now;
}

/** "12 s ago", "4 min ago", "2 h ago". */
export function formatAgo(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds))
    return "never";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Seconds since an ISO time, using a ticking `now` (null until mounted). */
export function secondsSince(
  iso: string | null | undefined,
  now: number | null,
): number | null {
  if (!iso || now === null) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : (now - t) / 1000;
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return "—";
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(1)} km`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString("en-GB", {
        timeZone: "Asia/Dhaka",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** Short marker label from a registration number ("DHAKA METRO-JA-12-3456" -> "456"). */
export function shortReg(regNo: string): string {
  const digits = regNo.replace(/\D/g, "");
  return digits ? digits.slice(-3) : regNo.slice(0, 3).toUpperCase();
}

export const STATUS_TONE: Record<VehicleStatus, "moving" | "idle" | "offline"> =
  {
    moving: "moving",
    idle: "idle",
    offline: "offline",
    no_signal: "offline",
  };

export function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  const tone =
    status === "moving"
      ? "badge-success"
      : status === "idle"
        ? "badge-warning"
        : "badge-ghost";
  return (
    <span className={`badge badge-soft badge-sm ${tone} whitespace-nowrap`}>
      {humanize(status)}
    </span>
  );
}

export function StreamBadge({
  status,
  onReconnect,
}: {
  status: StreamStatus;
  onReconnect?: () => void;
}) {
  const [tone, text] =
    status === "open"
      ? ["badge-success", "Live"]
      : status === "connecting"
        ? ["badge-warning", "Reconnecting…"]
        : status === "off"
          ? ["badge-ghost", "Paused"]
          : ["badge-error", "Offline"];
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`badge badge-soft ${tone} gap-1.5`}>
        {status === "open" && (
          <span className="status status-success animate-pulse" />
        )}
        {text}
      </span>
      {status === "error" && onReconnect && (
        <Button variant="outline" size="xs" onClick={onReconnect}>
          <RefreshCwIcon /> Reconnect
        </Button>
      )}
    </span>
  );
}

/** Human summary of an alert's `details` JSON (e.g. overspeed {speedKmh, limitKmh}). */
export function alertDetails(details: unknown): string {
  if (details === null || details === undefined) return "—";
  if (typeof details !== "object") return String(details);
  const d = details as Record<string, unknown>;
  if (typeof d.speedKmh === "number") {
    const limit = d.limitKmh ?? d.limit;
    return `${d.speedKmh.toFixed(0)} km/h${limit !== undefined ? ` (limit ${String(limit)})` : ""}`;
  }
  return Object.entries(d)
    .map(
      ([k, v]) =>
        `${humanize(k)}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
    )
    .join(", ");
}
