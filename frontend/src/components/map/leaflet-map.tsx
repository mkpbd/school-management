"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { MapViewProps, MarkerTone } from "./types";

const DHAKA: [number, number] = [23.8103, 90.4125];

const TONE: Record<MarkerTone, string> = {
  moving: "#16a34a",
  idle: "#f59e0b",
  offline: "#6b7280",
  stop: "#2563eb",
  home: "#db2777",
  alert: "#dc2626",
  default: "#0f172a",
};

function icon(
  tone: MarkerTone,
  label?: string,
  heading?: number | null,
  selected?: boolean,
) {
  const color = TONE[tone];
  const size = selected ? 34 : 28;
  const arrow =
    heading !== undefined && heading !== null
      ? `<div style="position:absolute;inset:-7px;transform:rotate(${heading}deg)"><div style="margin:0 auto;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid ${color}"></div></div>`
      : "";
  const text = label ? String(label).slice(0, 3) : "";
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="position:relative;width:${size}px;height:${size}px">${arrow}<div style="width:100%;height:100%;border-radius:9999px;background:${color};border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4);color:white;font:600 10px/1 system-ui;display:flex;align-items:center;justify-content:center">${text}</div></div>`,
  });
}

/** Fit the view to all markers and lines, only when `fitKey` changes (not on every live update). */
function FitBounds({
  points,
  fitKey,
}: {
  points: [number, number][];
  fitKey?: string;
}) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1)
      map.setView(points[0]!, Math.max(map.getZoom(), 15));
    else if (points.length > 1)
      map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the caller says so
  }, [fitKey, map]);
  return null;
}

function ClickHandler({
  onClick,
}: {
  onClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export default function LeafletMap({
  markers = [],
  lines = [],
  height = 420,
  fitKey,
  center,
  zoom = 13,
  onClick,
  onMarkerClick,
  selectedId,
}: MapViewProps) {
  const points = useMemo<[number, number][]>(
    () => [
      ...markers.map((m) => [m.lat, m.lng] as [number, number]),
      ...lines.flatMap((l) => l.points),
    ],
    [markers, lines],
  );
  const start = center ?? points[0] ?? DHAKA;

  return (
    <div
      className="isolate overflow-hidden rounded-xl border"
      style={{ height }}
    >
      <MapContainer
        center={start}
        zoom={zoom}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {lines.map((l) => (
          <Polyline
            key={l.id}
            positions={l.points}
            pathOptions={{
              color: l.color ?? "#2563eb",
              weight: 4,
              opacity: 0.8,
              dashArray: l.dashed ? "6 8" : undefined,
            }}
          />
        ))}
        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lng]}
            icon={icon(
              m.tone ?? "default",
              m.label,
              m.heading,
              m.id === selectedId,
            )}
            eventHandlers={
              onMarkerClick ? { click: () => onMarkerClick(m.id) } : undefined
            }
          >
            {m.title && (
              <Tooltip direction="top" offset={[0, -14]}>
                {m.title}
              </Tooltip>
            )}
            {m.popup && <Popup>{m.popup}</Popup>}
          </Marker>
        ))}
        <FitBounds points={points} fitKey={fitKey} />
        {onClick && <ClickHandler onClick={onClick} />}
      </MapContainer>
    </div>
  );
}
