"use client";

import { useQuery } from "@tanstack/react-query";
import { ResourcePage } from "@/components/crud/resource-page";
import { MapView, type MapMarker } from "@/components/map";
import { Card, CardContent } from "@/components/ui/card";
import { latLng, stopsRef } from "@/components/trn/fleet";
import { api } from "@/lib/api";

export default function StopsPage() {
  // all stops for the overview map (the table pages through them)
  const all = useQuery({
    queryKey: ["ref", stopsRef.key],
    queryFn: stopsRef.load,
    staleTime: 60_000,
  });
  const markers: MapMarker[] = (all.data ?? []).flatMap((s) => {
    const p = latLng(s);
    return p
      ? [
          {
            id: String(s.id),
            lat: p[0],
            lng: p[1],
            tone: "stop" as const,
            title: String(s.name),
            popup: <StopPopup row={s} />,
          },
        ]
      : [];
  });

  return (
    <div className="space-y-6">
      <ResourcePage
        title="Stops"
        description="Pickup and drop points. Routes are built from these in order."
        queryKey="trn.stops"
        entity="stop"
        resource={api.trn.stops}
        permissions={{ create: "trn.route.create", edit: "trn.route.edit" }}
        columns={[
          { key: "name", label: "Name" },
          { key: "area", label: "Area" },
          { key: "lat", label: "Latitude", type: "mono" },
          { key: "lng", label: "Longitude", type: "mono" },
          { key: "feeZone", label: "Fee zone" },
        ]}
        fields={[
          { name: "name", label: "Name", required: true },
          { name: "area", label: "Area", nullable: true },
          {
            name: "lat",
            label: "Latitude",
            type: "number",
            required: true,
            placeholder: "23.7806",
            help: "Right-click a place in Google / OpenStreetMap to copy its coordinates",
          },
          {
            name: "lng",
            label: "Longitude",
            type: "number",
            required: true,
            placeholder: "90.4193",
          },
          {
            name: "feeZone",
            label: "Fee zone",
            nullable: true,
            help: "Used by transport fees",
          },
        ]}
      />
      <Card>
        <CardContent>
          <MapView
            markers={markers}
            height={360}
            fitKey={String(markers.length)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function StopPopup({ row }: { row: Record<string, unknown> }) {
  return (
    <div className="text-xs">
      <div className="font-semibold">{String(row.name)}</div>
      {row.area ? <div>{String(row.area)}</div> : null}
      <div className="font-mono">
        {String(row.lat)}, {String(row.lng)}
      </div>
    </div>
  );
}
