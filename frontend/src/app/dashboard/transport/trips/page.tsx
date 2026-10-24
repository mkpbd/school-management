"use client";

import { useQuery } from "@tanstack/react-query";
import { SquareIcon } from "lucide-react";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { ConfirmButton, PageHeader, StatusBadge } from "@/components/page";
import {
  formatTime,
  routesRef,
  vehiclesRef,
  type TripRow,
} from "@/components/trn/tracking";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

function tripStatus(t: TripRow): string {
  if (t.endedAt) return "completed";
  if (t.startedAt) return "running";
  return "planned";
}

export default function TripsPage() {
  const { data: me } = useMe();
  // empty = today on the server (Asia/Dhaka); avoids reading the clock while rendering
  const [date, setDate] = useState("");
  const [campusId, setCampusId] = useState("");
  const [routeId, setRouteId] = useState("");

  const query = {
    ...(date ? { date } : {}),
    ...(campusId ? { campusId } : {}),
    ...(routeId ? { routeId } : {}),
  };
  const trips = useQuery({
    queryKey: ["trn.trips", query],
    queryFn: () => api.trn.trips.list<TripRow[]>(query),
    refetchInterval: 30_000,
  });
  const end = useAction((id: string) => api.trn.trips.end(id), {
    success: "Trip ended",
    invalidate: [["trn.trips"], ["trn.live"]],
  });
  const canDrive = can(me, "trn.trip.create");

  return (
    <>
      <PageHeader
        title="Trips"
        description="Pickup and drop runs of a day (today by default)."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Input
              type="date"
              aria-label="Date"
              className="sm:w-44"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <div className="sm:w-52">
              <RefSelect
                source={refs.campuses}
                value={campusId}
                placeholder="All campuses"
                onChange={setCampusId}
              />
            </div>
            <div className="sm:w-64">
              <RefSelect
                source={routesRef}
                value={routeId}
                placeholder="All routes"
                onChange={setRouteId}
              />
            </div>
          </div>
          <DataTable<TripRow>
            rows={trips.data?.data}
            isPending={trips.isPending}
            error={trips.error}
            empty="No trips on this day."
            columns={[
              { key: "tripDate", label: "Date", type: "date" },
              { key: "routeName", label: "Route" },
              { key: "direction", label: "Direction", type: "enum" },
              { key: "vehicleId", label: "Vehicle", ref: vehiclesRef },
              {
                key: "status",
                label: "Status",
                render: (t) => <StatusBadge status={tripStatus(t)} />,
              },
              {
                key: "startedAt",
                label: "Started",
                render: (t) => formatTime(t.startedAt),
              },
              {
                key: "endedAt",
                label: "Ended",
                render: (t) => formatTime(t.endedAt),
              },
            ]}
            actions={
              canDrive
                ? (t) =>
                    tripStatus(t) === "running" ? (
                      <ConfirmButton
                        size="xs"
                        title={`End the ${t.direction} trip of ${t.routeName}?`}
                        description="The run is marked completed; GPS fixes after this are no longer linked to it."
                        confirmLabel="End trip"
                        onConfirm={() => end.mutateAsync(t.id)}
                      >
                        <SquareIcon /> End trip
                      </ConfirmButton>
                    ) : null
                : undefined
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
