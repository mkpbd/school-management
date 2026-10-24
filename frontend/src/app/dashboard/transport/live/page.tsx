"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  BusIcon,
  GaugeIcon,
  MapPinIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { RefSelect } from "@/components/crud/fields";
import { MapView, type MapMarker } from "@/components/map";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
import {
  formatAgo,
  formatDistance,
  routeOverlay,
  shortReg,
  STATUS_TONE,
  StreamBadge,
  useNow,
  VehicleStatusBadge,
  type AlertRow,
  type LiveVehicle,
  type RouteDetail,
} from "@/components/trn/tracking";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useEventStream } from "@/hooks/use-event-stream";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function LiveTrackingPage() {
  const [campusId, setCampusId] = useState("");
  return (
    <>
      <PageHeader
        title="Live tracking"
        description="Every vehicle's position, status, running trip and next stop. Updates every 5 seconds."
        actions={
          <div className="sm:w-56">
            <RefSelect
              source={refs.campuses}
              value={campusId}
              placeholder="All campuses"
              onChange={setCampusId}
            />
          </div>
        }
      />
      {/* remount per campus so a stale stream never mixes campuses */}
      <LiveFleet key={campusId} campusId={campusId} />
    </>
  );
}

function LiveFleet({ campusId }: { campusId: string }) {
  const query = campusId ? { campusId } : {};
  const initial = useQuery({
    queryKey: ["trn.live", campusId],
    queryFn: () => api.trn.tracking.live<LiveVehicle[]>(query),
  });
  const stream = useEventStream<LiveVehicle[]>(
    api.trn.tracking.streamUrl({ ...query, intervalSec: 5 }),
  );
  const alerts = useQuery({
    queryKey: ["trn.alerts", { open: "true", campusId }],
    queryFn: () => api.trn.alerts.list<AlertRow[]>({ open: "true", ...query }),
    refetchInterval: 30_000,
  });
  const now = useNow();

  const vehicles = useMemo(
    () => stream.data ?? initial.data?.data ?? [],
    [stream.data, initial.data],
  );
  const receivedAt =
    stream.lastAt?.getTime() ?? (initial.dataUpdatedAt || null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = vehicles.find((v) => v.vehicleId === selectedId) ?? null;

  const route = useQuery({
    queryKey: ["trn.route", selected?.trip?.routeId],
    queryFn: () => api.trn.routes.get<RouteDetail>(selected!.trip!.routeId),
    enabled: Boolean(selected?.trip?.routeId),
  });

  const ago = (v: LiveVehicle) =>
    v.lastSeenSec === null
      ? "never"
      : formatAgo(
          v.lastSeenSec +
            (now !== null && receivedAt
              ? Math.max(0, (now - receivedAt) / 1000)
              : 0),
        );

  const overlay = routeOverlay(route.data?.data, selected?.nextStop?.stopId);
  const markers: MapMarker[] = [
    ...overlay.markers,
    ...vehicles
      .filter((v) => v.position)
      .map((v) => ({
        id: v.vehicleId,
        lat: v.position!.lat,
        lng: v.position!.lng,
        label: shortReg(v.regNo),
        title: `${v.regNo} · ${humanize(v.status)}${v.trip ? ` · ${v.trip.routeName}` : ""}`,
        tone: STATUS_TONE[v.status],
        heading: v.status === "moving" ? v.position!.heading : null,
      })),
  ];
  const openAlerts = alerts.data?.data.length ?? 0;
  const counts = { moving: 0, idle: 0, offline: 0 };
  for (const v of vehicles) counts[STATUS_TONE[v.status]] += 1;

  if (initial.isPending && !stream.data) return <Loading />;
  if (initial.isError && !stream.data)
    return <ErrorAlert error={initial.error} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StreamBadge status={stream.status} onReconnect={stream.reconnect} />
        <span className="badge badge-soft badge-success">
          {counts.moving} moving
        </span>
        <span className="badge badge-soft badge-warning">
          {counts.idle} idle
        </span>
        <span className="badge badge-soft">{counts.offline} offline</span>
        <div className="flex-1" />
        {openAlerts > 0 && (
          <Button
            nativeButton={false}
            variant="destructive"
            size="sm"
            render={<Link href="/dashboard/transport/alerts" />}
          >
            <AlertTriangleIcon /> {openAlerts} open alert
            {openAlerts === 1 ? "" : "s"}
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <MapView
          height="min(70svh, 640px)"
          markers={markers}
          lines={overlay.lines}
          selectedId={selectedId ?? undefined}
          onMarkerClick={(id) =>
            vehicles.some((v) => v.vehicleId === id) && setSelectedId(id)
          }
          fitKey={`${campusId}|${selectedId ?? "all"}|${route.data ? "route" : ""}|${vehicles.length > 0}`}
        />

        <div className="max-h-[min(70svh,640px)] space-y-2 overflow-y-auto">
          {vehicles.length === 0 && <Empty>No vehicles.</Empty>}
          {vehicles.map((v) => (
            <Card
              key={v.vehicleId}
              size="sm"
              role="button"
              tabIndex={0}
              onClick={() =>
                setSelectedId(v.vehicleId === selectedId ? null : v.vehicleId)
              }
              onKeyDown={(e) =>
                e.key === "Enter" &&
                setSelectedId(v.vehicleId === selectedId ? null : v.vehicleId)
              }
              className={`cursor-pointer transition-colors hover:bg-muted/50 ${v.vehicleId === selectedId ? "ring-2 ring-primary" : ""}`}
            >
              <CardContent className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-medium">
                    <BusIcon className="size-4 text-muted-foreground" />
                    {v.regNo}
                  </span>
                  <VehicleStatusBadge status={v.status} />
                </div>
                <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <GaugeIcon className="size-3" />
                    {v.position?.speedKmh !== null &&
                    v.position?.speedKmh !== undefined
                      ? `${Math.round(v.position.speedKmh)} km/h`
                      : "—"}
                  </span>
                  <span>Seen {ago(v)}</span>
                  {v.position?.source === "driver_app" && (
                    <span>via driver app</span>
                  )}
                </div>
                {v.trip ? (
                  <div className="text-sm">
                    {v.trip.routeName} ·{" "}
                    <span className="capitalize">{v.trip.direction}</span>
                    {v.nextStop && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPinIcon className="size-3" />
                        Next: {v.nextStop.name} ·{" "}
                        {formatDistance(v.nextStop.distanceMeters)} · ~
                        {Math.round(v.nextStop.etaMinutes)} min
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    No trip running
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
