"use client";

import { api, type Row } from "@/lib/api";
import type { RefSource } from "@/lib/refs";

/** Response shapes from backend/src/modules/trn (ports.ts, FleetUseCases.ts, TrackingUseCases.ts). */

export type VehicleKind = "bus" | "minibus" | "microbus" | "van" | "car";
export const VEHICLE_KINDS: readonly VehicleKind[] = [
  "bus",
  "minibus",
  "microbus",
  "van",
  "car",
];
export const OWNERSHIP = ["own", "leased", "contracted"] as const;
export const CREW_ROLES = ["driver", "helper", "attendant"] as const;
export const DOC_TYPES = [
  "fitness",
  "insurance",
  "tax_token",
  "route_permit",
  "registration",
] as const;
export const DIRECTIONS = ["both", "pickup_only", "drop_only"] as const;

export type Vehicle = {
  id: string;
  campusId: string;
  regNo: string;
  kind: VehicleKind;
  capacity: number;
  ownership: string | null;
  gpsDeviceId: string | null;
  gpsKeyRotatedAt: string | null;
  isActive: boolean;
  rowVersion: number;
};

export type CrewMember = {
  id: string;
  vehicleId: string;
  staffId: string;
  role: (typeof CREW_ROLES)[number];
  validFrom: string;
  validTo: string | null;
  licenceNo: string | null;
  licenceExpiresOn: string | null;
  name: string;
  phone: string;
};

export type VehicleDocument = {
  id: string;
  vehicleId: string;
  regNo: string;
  docType: string;
  docNo: string | null;
  expiresOn: string;
  fileId: string | null;
  /** only on GET /vehicle-documents/expiring (negative = expired) */
  daysLeft?: number;
};

export type DeviceKey = {
  vehicleId: string;
  deviceId: string;
  deviceKey: string;
  ingestPath: string;
};

export type TrackPoint = {
  recordedAt: string;
  lat: number;
  lng: number;
  speedKmh?: number | null;
  heading?: number | null;
};
export type VehicleTrack = {
  vehicleId: string;
  points: TrackPoint[];
  totalPoints: number;
  distanceMeters: number;
};

export type RouteStop = {
  stopId: string;
  seq: number;
  name: string;
  area: string | null;
  lat: number | null;
  lng: number | null;
  pickupTime: string | null;
  dropTime: string | null;
};

export type RouteDetail = {
  id: string;
  campusId: string;
  code: string;
  name: string;
  vehicleId: string | null;
  isActive: boolean;
  stops: RouteStop[];
  vehicle:
    | (Pick<
        Vehicle,
        | "id"
        | "campusId"
        | "regNo"
        | "kind"
        | "capacity"
        | "gpsDeviceId"
        | "isActive"
      > & { hasDeviceKey: boolean })
    | null;
  students: number;
};

export type ManifestRow = {
  id: string;
  campusId: string;
  studentId: string;
  enrolmentId: string;
  routeId: string;
  pickupStopId: string;
  dropStopId: string | null;
  direction: (typeof DIRECTIONS)[number];
  validFrom: string;
  validTo: string | null;
  studentName: string;
  admissionNo: string;
};

/** Stops arrive with numeric columns as strings ("23.793700"). */
export function latLng(row: {
  lat?: unknown;
  lng?: unknown;
}): [number, number] | null {
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (
    row.lat === null ||
    row.lat === undefined ||
    row.lng === null ||
    row.lng === undefined
  )
    return null;
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export const vehiclesRef: RefSource = {
  key: "trn.vehicles",
  load: async () => (await api.trn.vehicles.list({ pageSize: 500 })).data,
  label: (r: Row) => `${s(r.regNo)} (${s(r.kind)})`,
};

export const stopsRef: RefSource = {
  key: "trn.stops",
  load: async () => (await api.trn.stops.list({ pageSize: 500 })).data,
  label: (r: Row) => `${s(r.name)}${r.area ? ` — ${s(r.area)}` : ""}`,
};

/** "07:10:00" -> "07:10" */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

export function DaysLeftBadge({ days }: { days: number | undefined }) {
  if (days === undefined) return null;
  const tone =
    days < 0
      ? "badge-error"
      : days <= 7
        ? "badge-warning"
        : days <= 30
          ? "badge-info"
          : "badge-ghost";
  const text =
    days < 0
      ? `Expired ${-days}d ago`
      : days === 0
        ? "Expires today"
        : `${days} days left`;
  return (
    <span className={`badge badge-soft badge-sm whitespace-nowrap ${tone}`}>
      {text}
    </span>
  );
}
