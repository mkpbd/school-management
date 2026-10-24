"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  UserPlusIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { StudentPicker } from "@/components/fee/student-picker";
import { MapView, type MapMarker } from "@/components/map";
import {
  DetailList,
  ErrorAlert,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/page";
import {
  DIRECTIONS,
  hhmm,
  latLng,
  stopsRef,
  type ManifestRow,
  type RouteDetail,
  type RouteStop,
} from "@/components/trn/fleet";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, isApiError, type StudentListItem } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";

export default function RouteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const route = useQuery({
    queryKey: ["trn.routes", "detail", id],
    queryFn: () => api.trn.routes.get<RouteDetail>(id),
  });

  if (route.isPending) return <Loading />;
  if (route.isError) return <ErrorAlert error={route.error} />;
  const r = route.data.data;

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href="/dashboard/transport/routes" />}
      >
        <ArrowLeftIcon /> Routes
      </Button>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {r.name}{" "}
            <span className="font-mono text-base text-muted-foreground">
              {r.code}
            </span>
            <StatusBadge status={r.isActive ? "active" : "retired"} />
          </span>
        }
        description={`${r.stops.length} stops · ${r.students} student${r.students === 1 ? "" : "s"} riding today`}
      />
      <Card className="mb-6">
        <CardContent>
          <DetailList
            items={[
              [
                "Vehicle",
                r.vehicle ? (
                  <Link
                    className="link link-hover font-mono text-xs"
                    href={`/dashboard/transport/vehicles/${r.vehicle.id}`}
                  >
                    {r.vehicle.regNo}
                  </Link>
                ) : (
                  "Not assigned"
                ),
              ],
              [
                "Seats",
                r.vehicle ? `${r.students} / ${r.vehicle.capacity} taken` : "—",
              ],
              ["GPS tracker", r.vehicle?.gpsDeviceId ?? "—"],
            ]}
          />
        </CardContent>
      </Card>
      <Tabs defaultValue="stops">
        <TabsList>
          <TabsTrigger value="stops">Stops</TabsTrigger>
          {can(me, "trn.assignment.view") && (
            <TabsTrigger value="manifest">Students</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="stops">
          {/* remount the editor whenever the saved stops change */}
          <StopEditor
            key={route.dataUpdatedAt}
            route={r}
            canEdit={can(me, "trn.route.edit")}
          />
        </TabsContent>
        {can(me, "trn.assignment.view") && (
          <TabsContent value="manifest">
            <Manifest route={r} />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}

// ---- ordered stops ----

type EditStop = {
  stopId: string;
  name: string;
  area: string | null;
  lat: unknown;
  lng: unknown;
  pickupTime: string;
  dropTime: string;
};

const toEdit = (s: RouteStop): EditStop => ({
  stopId: s.stopId,
  name: s.name,
  area: s.area,
  lat: s.lat,
  lng: s.lng,
  pickupTime: hhmm(s.pickupTime),
  dropTime: hhmm(s.dropTime),
});

function StopEditor({
  route,
  canEdit,
}: {
  route: RouteDetail;
  canEdit: boolean;
}) {
  const [stops, setStops] = useState<EditStop[]>(() =>
    [...route.stops].sort((a, b) => a.seq - b.seq).map(toEdit),
  );
  const [adding, setAdding] = useState("");
  const allStops = useQuery({
    queryKey: ["ref", stopsRef.key],
    queryFn: stopsRef.load,
    staleTime: 60_000,
  });
  const dirty =
    JSON.stringify(stops) !==
    JSON.stringify([...route.stops].sort((a, b) => a.seq - b.seq).map(toEdit));

  const save = useAction(
    () =>
      api.trn.routes.setStops(route.id, {
        stops: stops.map((s) => ({
          stopId: s.stopId,
          ...(s.pickupTime ? { pickupTime: s.pickupTime } : {}),
          ...(s.dropTime ? { dropTime: s.dropTime } : {}),
        })),
      }),
    { success: "Stops saved", invalidate: [["trn.routes"]] },
  );

  const move = (i: number, by: -1 | 1) =>
    setStops((prev) => {
      const next = [...prev];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item!);
      return next;
    });
  const patch = (i: number, p: Partial<EditStop>) =>
    setStops((prev) => prev.map((s, n) => (n === i ? { ...s, ...p } : s)));

  function addStop() {
    const row = allStops.data?.find((s) => String(s.id) === adding);
    if (!row) return;
    setStops((prev) => [
      ...prev,
      {
        stopId: String(row.id),
        name: String(row.name),
        area: (row.area as string | null) ?? null,
        lat: row.lat,
        lng: row.lng,
        pickupTime: "",
        dropTime: "",
      },
    ]);
    setAdding("");
  }

  const markers: MapMarker[] = stops.flatMap((s, i) => {
    const p = latLng(s);
    return p
      ? [
          {
            id: s.stopId,
            lat: p[0],
            lng: p[1],
            label: String(i + 1),
            tone: "stop" as const,
            title: `${i + 1}. ${s.name}${s.pickupTime ? ` · pickup ${s.pickupTime}` : ""}`,
          },
        ]
      : [];
  });
  const line = markers.map((m) => [m.lat, m.lng] as [number, number]);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Stops in pickup order</CardTitle>
          <CardDescription>
            The drop run goes through them in reverse.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {stops.length === 0 && (
            <p className="text-sm text-muted-foreground">No stops yet.</p>
          )}
          <ol className="space-y-2">
            {stops.map((s, i) => (
              <li
                key={s.stopId}
                className="flex flex-wrap items-center gap-2 rounded-lg border p-2"
              >
                <span className="badge badge-neutral badge-sm">{i + 1}</span>
                <div className="min-w-32 flex-1">
                  <div className="text-sm font-medium">{s.name}</div>
                  {s.area && (
                    <div className="text-xs text-muted-foreground">
                      {s.area}
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  Pickup
                  <Input
                    type="time"
                    className="h-7 w-28"
                    disabled={!canEdit}
                    value={s.pickupTime}
                    onChange={(e) => patch(i, { pickupTime: e.target.value })}
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  Drop
                  <Input
                    type="time"
                    className="h-7 w-28"
                    disabled={!canEdit}
                    value={s.dropTime}
                    onChange={(e) => patch(i, { dropTime: e.target.value })}
                  />
                </label>
                {canEdit && (
                  <div className="flex gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Move down"
                      disabled={i === stops.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove"
                      onClick={() =>
                        setStops((prev) => prev.filter((_, n) => n !== i))
                      }
                    >
                      <Trash2Icon className="text-destructive" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {canEdit && (
            <>
              <div className="flex gap-2">
                <div className="flex-1">
                  <RefSelect
                    source={stopsRef}
                    value={adding}
                    placeholder="Add a stop…"
                    filter={(row) =>
                      !stops.some((s) => s.stopId === String(row.id))
                    }
                    onChange={setAdding}
                  />
                </div>
                <Button variant="outline" disabled={!adding} onClick={addStop}>
                  <PlusIcon /> Add
                </Button>
              </div>
              <div className="flex items-center justify-end gap-2">
                {dirty && (
                  <span className="text-xs text-warning">Unsaved changes</span>
                )}
                {dirty && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setStops(
                        [...route.stops]
                          .sort((a, b) => a.seq - b.seq)
                          .map(toEdit),
                      )
                    }
                  >
                    Reset
                  </Button>
                )}
                <Button
                  disabled={!dirty || save.isPending}
                  onClick={() => save.mutate(undefined)}
                >
                  {save.isPending ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <SaveIcon />
                  )}
                  Save stops
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <MapView
        markers={markers}
        lines={line.length > 1 ? [{ id: "route", points: line }] : []}
        height={460}
        fitKey={`${route.id}:${stops.length}`}
      />
    </div>
  );
}

// ---- students on the route ----

function Manifest({ route }: { route: RouteDetail }) {
  const { data: me } = useMe();
  const [date, setDate] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [ending, setEnding] = useState<ManifestRow | null>(null);
  const manifest = useQuery({
    queryKey: ["trn.routes", "manifest", route.id, date],
    queryFn: () =>
      api.trn.routes.manifest<ManifestRow[]>(route.id, date ? { date } : {}),
  });
  const end = useAction(
    ({ id, validTo }: { id: string; validTo?: string }) =>
      api.trn.assignments.end(id, validTo ? { validTo } : {}),
    { invalidate: [["trn.routes"]], toastError: false },
  );
  const stopName = (id: string | null) =>
    id
      ? (route.stops.find((s) => s.stopId === id)?.name ?? id.slice(0, 8))
      : "—";

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Students on this route</CardTitle>
          <CardDescription>
            {date ? `On ${formatDate(date)}` : "Today"}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Input
            type="date"
            className="w-40"
            aria-label="Date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {can(me, "trn.assignment.create") && (
            <Button
              onClick={() => setAssigning(true)}
              disabled={route.stops.length === 0}
            >
              <UserPlusIcon /> Assign student
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {route.stops.length === 0 && (
          <p className="mb-3 text-sm text-muted-foreground">
            Add stops to the route before assigning students.
          </p>
        )}
        <DataTable<ManifestRow>
          rows={manifest.data?.data}
          isPending={manifest.isPending}
          error={manifest.error}
          empty="No students ride this route on this date."
          columns={[
            {
              key: "studentName",
              label: "Student",
              render: (m) => (
                <Link
                  className="link link-hover"
                  href={`/dashboard/students/${m.studentId}`}
                >
                  {m.studentName || m.studentId.slice(0, 8)}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {m.admissionNo}
                  </span>
                </Link>
              ),
            },
            {
              key: "pickupStopId",
              label: "Pickup",
              render: (m) => stopName(m.pickupStopId),
            },
            {
              key: "dropStopId",
              label: "Drop",
              render: (m) => stopName(m.dropStopId ?? m.pickupStopId),
            },
            {
              key: "direction",
              label: "Direction",
              render: (m) => humanize(m.direction),
            },
            { key: "validFrom", label: "From", type: "date" },
            { key: "validTo", label: "Until", type: "date" },
          ]}
          actions={
            can(me, "trn.assignment.edit")
              ? (m) => (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setEnding(m)}
                  >
                    End
                  </Button>
                )
              : undefined
          }
        />
      </CardContent>
      {assigning && (
        <AssignDialog route={route} onClose={() => setAssigning(false)} />
      )}
      <FormDialog
        open={ending !== null}
        onOpenChange={(open) => !open && setEnding(null)}
        title={`End transport for ${ending?.studentName ?? "student"}`}
        description="The student stops riding this route after this date. Empty: today."
        fields={[{ name: "validTo", label: "Last day", type: "date" }]}
        submitLabel="End assignment"
        successMessage="Assignment ended"
        onSubmit={(body) =>
          end.mutateAsync({
            id: ending!.id,
            validTo: body.validTo as string | undefined,
          })
        }
      />
    </Card>
  );
}

function AssignDialog({
  route,
  onClose,
}: {
  route: RouteDetail;
  onClose: () => void;
}) {
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [pickupStopId, setPickup] = useState("");
  const [dropStopId, setDrop] = useState("");
  const [direction, setDirection] =
    useState<(typeof DIRECTIONS)[number]>("both");
  const [validFrom, setValidFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const assign = useAction(
    () =>
      api.trn.assignments.create<{ id: string; seatsLeft: number }>({
        studentId: student!.id,
        routeId: route.id,
        pickupStopId,
        ...(dropStopId ? { dropStopId } : {}),
        direction,
        ...(validFrom ? { validFrom } : {}),
      }),
    { invalidate: [["trn.routes"]], toastError: false },
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!student) return setError("Pick a student.");
    setError(null);
    try {
      const { data } = await assign.mutateAsync(undefined);
      toast.success(
        data.seatsLeft >= 0
          ? `Assigned · ${data.seatsLeft} seats left`
          : "Assigned",
      );
      onClose();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not assign the student.");
    }
  }

  const stopOptions = [...route.stops].sort((a, b) => a.seq - b.seq);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Assign a student to {route.name}</DialogTitle>
          </DialogHeader>
          {error && (
            <div role="alert" className="alert alert-error alert-soft text-sm">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Student</Label>
            <StudentPicker value={student} onChange={setStudent} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pickup">Pickup stop</Label>
              <select
                id="pickup"
                required
                className="select select-sm h-8 w-full"
                value={pickupStopId}
                onChange={(e) => setPickup(e.target.value)}
              >
                <option value="">Select…</option>
                {stopOptions.map((s) => (
                  <option key={s.stopId} value={s.stopId}>
                    {s.seq}. {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drop">Drop stop</Label>
              <select
                id="drop"
                className="select select-sm h-8 w-full"
                value={dropStopId}
                onChange={(e) => setDrop(e.target.value)}
              >
                <option value="">Same as pickup</option>
                {stopOptions.map((s) => (
                  <option key={s.stopId} value={s.stopId}>
                    {s.seq}. {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="direction">Direction</Label>
              <select
                id="direction"
                className="select select-sm h-8 w-full"
                value={direction}
                onChange={(e) =>
                  setDirection(e.target.value as (typeof DIRECTIONS)[number])
                }
              >
                {DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {humanize(d)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="validFrom">From</Label>
              <Input
                id="validFrom"
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Empty: today</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={assign.isPending}>
              {assign.isPending && (
                <span className="loading loading-spinner loading-xs" />
              )}
              Assign
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
