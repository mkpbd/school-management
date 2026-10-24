"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BusIcon,
  CheckCircle2Icon,
  ClockIcon,
  MapPinIcon,
  UserIcon,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { MapView, type MapMarker } from "@/components/map";
import {
  DetailList,
  Empty,
  ErrorAlert,
  Loading,
  PageHeader,
} from "@/components/page";
import {
  formatAgo,
  formatDistance,
  formatTime,
  shortReg,
  STATUS_TONE,
  StreamBadge,
  useNow,
  VehicleStatusBadge,
  type StudentBus,
} from "@/components/trn/tracking";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useEventStream } from "@/hooks/use-event-stream";
import { can, useMe } from "@/hooks/use-me";
import { api, isApiError } from "@/lib/api";

export default function MyBusPage() {
  const { data: me, isPending } = useMe();
  const [picked, setPicked] = useState("");

  if (isPending) return <Loading />;
  const ownStudent = me?.studentId;
  const studentId = ownStudent ?? picked;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Where is my bus"
        description="Live position of the school bus and when it reaches the stop."
      />
      {!ownStudent && (
        <ChildPicker
          value={picked}
          onChange={setPicked}
          staff={can(me, "trn.tracking.view")}
        />
      )}
      {studentId ? (
        <BusView key={studentId} studentId={studentId} />
      ) : (
        <Empty>Pick a student to see the bus.</Empty>
      )}
    </div>
  );
}

/** Guardians: their own children (the student search is scope-filtered). Staff: search any student. */
function ChildPicker({
  value,
  onChange,
  staff,
}: {
  value: string;
  onChange: (id: string) => void;
  staff: boolean;
}) {
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const children = useQuery({
    queryKey: ["trn.my-bus.students", search],
    queryFn: () =>
      api.sis.students.search({
        limit: 50,
        status: "active",
        ...(search ? { q: search } : {}),
      }),
  });
  const rows = children.data?.data ?? [];

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {staff && (
          <Input
            placeholder="Search student…"
            className="sm:w-64"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
        {children.isError ? (
          <span className="text-sm text-muted-foreground">
            Could not load students: {children.error.message}
          </span>
        ) : (
          <select
            aria-label="Student"
            className="select select-sm h-8 sm:w-80"
            value={value}
            disabled={children.isPending}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">
              {children.isPending
                ? "Loading…"
                : rows.length
                  ? "Choose a student"
                  : "No students"}
            </option>
            {rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullNameEn} ({s.admissionNo})
              </option>
            ))}
          </select>
        )}
      </CardContent>
    </Card>
  );
}

function BusView({ studentId }: { studentId: string }) {
  const initial = useQuery({
    queryKey: ["trn.student-bus", studentId],
    queryFn: () => api.trn.tracking.studentBus<StudentBus>(studentId),
    retry: false,
  });
  // stream only once we know the student rides a bus (a refused stream would just retry)
  const stream = useEventStream<StudentBus>(
    initial.isSuccess
      ? api.trn.tracking.studentBusStreamUrl(studentId, { intervalSec: 10 })
      : null,
  );
  const now = useNow();

  if (initial.isPending) return <Loading />;
  if (initial.isError) {
    if (isApiError(initial.error) && initial.error.code === "NO_TRANSPORT")
      return <Empty>This student does not use school transport.</Empty>;
    if (isApiError(initial.error) && initial.error.status === 404)
      return <Empty>Student not found.</Empty>;
    return <ErrorAlert error={initial.error} />;
  }

  const bus = stream.data ?? initial.data.data;
  const receivedAt = stream.lastAt?.getTime() ?? initial.dataUpdatedAt;
  const seen =
    bus.lastSeenSec === null
      ? null
      : bus.lastSeenSec +
        (now !== null ? Math.max(0, (now - receivedAt) / 1000) : 0);
  const stopTime =
    bus.trip?.direction === "drop" ? bus.stop.dropTime : bus.stop.pickupTime;

  const markers: MapMarker[] = [];
  if (bus.stop.lat !== null && bus.stop.lng !== null)
    markers.push({
      id: "stop",
      lat: bus.stop.lat,
      lng: bus.stop.lng,
      tone: "home",
      label: "★",
      title: bus.stop.name,
    });
  if (bus.position && bus.vehicle)
    markers.push({
      id: "bus",
      lat: bus.position.lat,
      lng: bus.position.lng,
      tone: STATUS_TONE[bus.status],
      label: shortReg(bus.vehicle.regNo),
      heading: bus.status === "moving" ? bus.position.heading : null,
      title: bus.vehicle.regNo,
    });

  let headline: string;
  if (!bus.vehicle) headline = "No bus is assigned to this route yet.";
  else if (!bus.trip) headline = "The bus is not on a trip right now.";
  else if (bus.progress?.reached)
    headline =
      bus.trip.direction === "drop"
        ? "The bus has reached the drop stop."
        : "The bus has reached the stop.";
  else if (
    bus.progress?.etaMinutes !== null &&
    bus.progress?.etaMinutes !== undefined
  )
    headline = `About ${Math.max(1, Math.round(bus.progress.etaMinutes))} min to ${bus.stop.name}`;
  else if (bus.status === "offline" || bus.status === "no_signal")
    headline = "The bus is not sending its location.";
  else headline = `On the ${bus.trip.direction} run`;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <MapView
        height="min(65svh, 560px)"
        markers={markers}
        fitKey={`${studentId}|${markers.length}`}
      />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-start gap-2 text-lg">
              {bus.progress?.reached ? (
                <CheckCircle2Icon className="mt-0.5 size-5 text-success" />
              ) : (
                <ClockIcon className="mt-0.5 size-5 text-muted-foreground" />
              )}
              {headline}
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              <StreamBadge
                status={stream.status}
                onReconnect={stream.reconnect}
              />
              {bus.vehicle && <VehicleStatusBadge status={bus.status} />}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                ["Route", `${bus.route.name} (${bus.route.code})`],
                [
                  "Stop",
                  <span key="stop" className="inline-flex items-center gap-1">
                    <MapPinIcon className="size-3" />
                    {bus.stop.name}
                    {stopTime ? ` · ${stopTime.slice(0, 5)}` : ""}
                  </span>,
                ],
                ["Distance", formatDistance(bus.progress?.distanceMeters)],
                [
                  "Bus",
                  bus.vehicle ? (
                    <span key="bus" className="inline-flex items-center gap-1">
                      <BusIcon className="size-3" /> {bus.vehicle.regNo}
                    </span>
                  ) : (
                    "—"
                  ),
                ],
                [
                  "Driver",
                  bus.driver ? (
                    <span
                      key="driver"
                      className="inline-flex items-center gap-1"
                    >
                      <UserIcon className="size-3" /> {bus.driver.name}
                    </span>
                  ) : (
                    "—"
                  ),
                ],
                [
                  "Speed",
                  bus.position?.speedKmh !== null &&
                  bus.position?.speedKmh !== undefined
                    ? `${Math.round(bus.position.speedKmh)} km/h`
                    : "—",
                ],
                ["Last seen", seen === null ? "never" : formatAgo(seen)],
                [
                  "Trip",
                  bus.trip
                    ? `${bus.trip.direction === "drop" ? "Drop" : "Pickup"} · started ${formatTime(bus.trip.startedAt)}`
                    : "—",
                ],
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
