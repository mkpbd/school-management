"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  CopyIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/crud/data-table";
import type { FieldDef } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { MapView, type MapMarker } from "@/components/map";
import {
  ConfirmButton,
  DetailList,
  ErrorAlert,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/page";
import { openFile } from "@/components/sis/shared";
import {
  CREW_ROLES,
  DaysLeftBadge,
  DOC_TYPES,
  OWNERSHIP,
  VEHICLE_KINDS,
  type CrewMember,
  type DeviceKey,
  type Vehicle,
  type VehicleDocument,
  type VehicleTrack,
} from "@/components/trn/fleet";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, isApiError, type Row } from "@/lib/api";
import { formatDate, formatDateTime, humanize, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

const VEHICLE_FIELDS: FieldDef[] = [
  { name: "regNo", label: "Registration no", required: true },
  {
    name: "kind",
    label: "Kind",
    type: "select",
    options: VEHICLE_KINDS,
    required: true,
  },
  { name: "capacity", label: "Seats", type: "number", required: true },
  { name: "ownership", label: "Ownership", type: "select", options: OWNERSHIP },
  { name: "isActive", label: "Active", type: "boolean" },
];

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const [editing, setEditing] = useState(false);
  const vehicle = useQuery({
    queryKey: ["trn.vehicles", "detail", id],
    queryFn: () => api.trn.vehicles.get<Vehicle>(id),
  });
  const save = useAction(
    (body: Row) =>
      api.trn.vehicles.update(id, body as never, {
        rowVersion: vehicle.data?.rowVersion,
      }),
    { invalidate: [["trn.vehicles"]], toastError: false },
  );

  if (vehicle.isPending) return <Loading />;
  if (vehicle.isError) return <ErrorAlert error={vehicle.error} />;
  const v = vehicle.data.data;
  const canEdit = can(me, "trn.vehicle.edit");

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href="/dashboard/transport/vehicles" />}
      >
        <ArrowLeftIcon /> Vehicles
      </Button>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono">{v.regNo}</span>
            <StatusBadge status={v.isActive ? "active" : "retired"} />
          </span>
        }
        description={`${humanize(v.kind)} · ${v.capacity} seats`}
        actions={
          canEdit && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon /> Edit
            </Button>
          )
        }
      />
      <Card className="mb-6">
        <CardContent>
          <DetailList
            items={[
              ["Campus", <CampusName key="c" id={v.campusId} />],
              ["Ownership", humanize(v.ownership)],
              [
                "GPS tracker",
                v.gpsDeviceId ? (
                  <span className="font-mono text-xs">{v.gpsDeviceId}</span>
                ) : (
                  "Not linked"
                ),
              ],
              [
                "Tracker key issued",
                v.gpsKeyRotatedAt ? formatDateTime(v.gpsKeyRotatedAt) : "—",
              ],
            ]}
          />
        </CardContent>
      </Card>

      <Tabs defaultValue="crew">
        <TabsList className="flex-wrap">
          <TabsTrigger value="crew">Crew</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          {canEdit && <TabsTrigger value="tracker">GPS tracker</TabsTrigger>}
          {can(me, "trn.tracking.view") && (
            <TabsTrigger value="track">Route history</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="crew">
          <CrewTab vehicle={v} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab vehicle={v} canEdit={canEdit} />
        </TabsContent>
        {canEdit && (
          <TabsContent value="tracker">
            <TrackerTab vehicle={v} />
          </TabsContent>
        )}
        {can(me, "trn.tracking.view") && (
          <TabsContent value="track">
            <TrackTab vehicle={v} />
          </TabsContent>
        )}
      </Tabs>

      <FormDialog
        open={editing}
        onOpenChange={setEditing}
        title="Edit vehicle"
        fields={VEHICLE_FIELDS}
        row={v}
        onSubmit={(body) => save.mutateAsync(body)}
      />
    </>
  );
}

function CampusName({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["ref", refs.campuses.key],
    queryFn: refs.campuses.load,
    staleTime: 60_000,
  });
  const row = q.data?.find((c) => c.id === id);
  return <>{row ? refs.campuses.label(row) : "—"}</>;
}

// ---- crew ----

const CREW_FIELDS: FieldDef[] = [
  {
    name: "staffId",
    label: "Staff member",
    type: "ref",
    ref: refs.staff,
    required: true,
    wide: true,
  },
  {
    name: "role",
    label: "Role",
    type: "select",
    options: CREW_ROLES,
    required: true,
  },
  { name: "validFrom", label: "From", type: "date", help: "Empty: today" },
  {
    name: "licenceNo",
    label: "Driving licence no",
    help: "Required for a driver",
  },
  {
    name: "licenceExpiresOn",
    label: "Licence expires on",
    type: "date",
    help: "Required for a driver",
  },
];

function CrewTab({ vehicle, canEdit }: { vehicle: Vehicle; canEdit: boolean }) {
  const [assigning, setAssigning] = useState(false);
  const [ending, setEnding] = useState<CrewMember | null>(null);
  const crew = useQuery({
    queryKey: ["trn.vehicles", "crew", vehicle.id],
    queryFn: () => api.trn.vehicles.crew<CrewMember[]>(vehicle.id),
  });
  const assign = useAction(
    (body: Row) => api.trn.vehicles.assignCrew(vehicle.id, body as never),
    {
      invalidate: [["trn.vehicles", "crew", vehicle.id]],
      toastError: false,
    },
  );
  const end = useAction(
    ({ id, validTo }: { id: string; validTo?: string }) =>
      api.trn.crew.end(id, validTo ? { validTo } : {}),
    { invalidate: [["trn.vehicles", "crew", vehicle.id]], toastError: false },
  );

  return (
    <Card>
      <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Today&apos;s crew</CardTitle>
          <CardDescription>
            Drivers need a valid licence. Crew members can post GPS from the
            driver console.
          </CardDescription>
        </div>
        {canEdit && (
          <Button onClick={() => setAssigning(true)}>
            <PlusIcon /> Assign crew
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <DataTable<CrewMember>
          rows={crew.data?.data}
          isPending={crew.isPending}
          error={crew.error}
          empty="No crew assigned for today."
          columns={[
            {
              key: "name",
              label: "Name",
              render: (c) => c.name || c.staffId.slice(0, 8),
            },
            { key: "phone", label: "Phone" },
            { key: "role", label: "Role", type: "enum" },
            { key: "licenceNo", label: "Licence", type: "mono" },
            {
              key: "licenceExpiresOn",
              label: "Licence expires",
              render: (c) =>
                c.licenceExpiresOn ? formatDate(c.licenceExpiresOn) : "—",
            },
            { key: "validFrom", label: "From", type: "date" },
            { key: "validTo", label: "Until", type: "date" },
          ]}
          actions={
            canEdit
              ? (c) => (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setEnding(c)}
                  >
                    End
                  </Button>
                )
              : undefined
          }
        />
      </CardContent>
      <FormDialog
        open={assigning}
        onOpenChange={setAssigning}
        title={`Assign crew to ${vehicle.regNo}`}
        fields={CREW_FIELDS}
        submitLabel="Assign"
        successMessage="Crew assigned"
        onSubmit={(body) => assign.mutateAsync(body)}
      />
      <FormDialog
        open={ending !== null}
        onOpenChange={(open) => !open && setEnding(null)}
        title={`End ${ending?.name ?? "crew"} as ${humanize(ending?.role)}`}
        fields={[
          {
            name: "validTo",
            label: "Last day",
            type: "date",
            help: "Empty: today",
          },
        ]}
        submitLabel="End assignment"
        successMessage="Crew assignment ended"
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

// ---- documents ----

const DOC_FIELDS: FieldDef[] = [
  {
    name: "docType",
    label: "Document",
    type: "select",
    options: DOC_TYPES,
    required: true,
  },
  { name: "docNo", label: "Number" },
  { name: "expiresOn", label: "Expires on", type: "date", required: true },
];

function daysUntil(iso: string): number {
  const today = Date.parse(`${todayISO()}T00:00:00Z`);
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - today) / 86_400_000);
}

function DocumentsTab({
  vehicle,
  canEdit,
}: {
  vehicle: Vehicle;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const docs = useQuery({
    queryKey: ["trn.documents", vehicle.id],
    queryFn: () => api.trn.vehicles.documents<VehicleDocument[]>(vehicle.id),
  });
  const add = useAction(
    (body: Row) => api.trn.vehicles.addDocument(vehicle.id, body as never),
    {
      invalidate: [["trn.documents"]],
      toastError: false,
    },
  );
  const remove = useAction((id: string) => api.trn.documents.remove(id), {
    success: "Document removed",
    invalidate: [["trn.documents"]],
  });

  return (
    <Card>
      <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Documents</CardTitle>
          <CardDescription>
            Fitness, insurance, tax token, route permit and registration with
            expiry dates.
          </CardDescription>
        </div>
        {canEdit && (
          <Button onClick={() => setAdding(true)}>
            <PlusIcon /> Add document
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <DataTable<VehicleDocument>
          rows={docs.data?.data}
          isPending={docs.isPending}
          error={docs.error}
          empty="No documents recorded."
          columns={[
            {
              key: "docType",
              label: "Document",
              render: (d) => humanize(d.docType),
            },
            { key: "docNo", label: "Number", type: "mono" },
            { key: "expiresOn", label: "Expires", type: "date" },
            {
              key: "daysLeft",
              label: "Status",
              render: (d) => <DaysLeftBadge days={daysUntil(d.expiresOn)} />,
            },
          ]}
          actions={(d) => (
            <>
              {d.fileId && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Open file"
                  onClick={() =>
                    openFile(d.fileId!).catch((e: unknown) =>
                      toast.error(
                        e instanceof Error ? e.message : "Could not open",
                      ),
                    )
                  }
                >
                  <ExternalLinkIcon />
                </Button>
              )}
              {canEdit && (
                <ConfirmButton
                  variant="ghost"
                  size="icon-sm"
                  destructive
                  title={`Remove the ${humanize(d.docType).toLowerCase()} document?`}
                  confirmLabel="Remove"
                  onConfirm={() => remove.mutateAsync(d.id)}
                >
                  <Trash2Icon className="text-destructive" />
                </ConfirmButton>
              )}
            </>
          )}
        />
      </CardContent>
      <FormDialog
        open={adding}
        onOpenChange={setAdding}
        title={`Add a document for ${vehicle.regNo}`}
        fields={DOC_FIELDS}
        submitLabel="Add"
        successMessage="Document added"
        onSubmit={(body) => add.mutateAsync(body)}
      />
    </Card>
  );
}

// ---- GPS tracker ----

function TrackerTab({ vehicle }: { vehicle: Vehicle }) {
  const [deviceId, setDeviceId] = useState(vehicle.gpsDeviceId ?? "");
  const [issued, setIssued] = useState<DeviceKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const issue = useAction(
    (id: string) =>
      api.trn.vehicles.issueDeviceKey<DeviceKey>(vehicle.id, { deviceId: id }),
    {
      invalidate: [["trn.vehicles"]],
      toastError: false,
    },
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { data } = await issue.mutateAsync(deviceId.trim());
      setIssued(data);
      toast.success("Tracker key issued");
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not issue the key.");
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied"),
      () => toast.error("Copy failed"),
    );

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Link a GPS tracker</CardTitle>
          <CardDescription>
            Issuing a key{" "}
            {vehicle.gpsKeyRotatedAt
              ? "replaces the current key: the old tracker stops reporting until it is updated."
              : "lets the tracker post positions for this vehicle."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            {error && (
              <div
                role="alert"
                className="alert alert-error alert-soft text-sm"
              >
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="deviceId">Device id</Label>
              <Input
                id="deviceId"
                required
                minLength={3}
                maxLength={64}
                pattern="^[\w.:\-]+$"
                placeholder="BUS-01 or the tracker IMEI"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Letters, digits and _ . : -
              </p>
            </div>
            <Button type="submit" disabled={issue.isPending}>
              {issue.isPending ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <KeyRoundIcon />
              )}
              {vehicle.gpsKeyRotatedAt ? "Rotate key" : "Issue key"}
            </Button>
          </form>
          {issued && (
            <div className="mt-4 space-y-2">
              <div
                role="alert"
                className="alert alert-warning alert-soft text-sm"
              >
                Copy the key now. It is shown only once and cannot be read
                again; issue a new one if it is lost.
              </div>
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
                <code className="flex-1 font-mono text-xs break-all">
                  {issued.deviceKey}
                </code>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Copy key"
                  onClick={() => copy(issued.deviceKey)}
                >
                  <CopyIcon />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Connect a tracker</CardTitle>
          <CardDescription>
            Any phone in the bus can be the tracker.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-1">
            <div className="font-medium">
              Traccar Client app (Android / iOS)
            </div>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>
                Server URL:{" "}
                <code className="text-xs break-all">
                  {origin}/api/v1/trn/gps/osmand
                </code>
              </li>
              <li>
                Device identifier:{" "}
                <code className="text-xs break-all">
                  {(issued?.deviceId ?? deviceId) || "<deviceId>"}.
                  {issued ? issued.deviceKey : "<deviceKey>"}
                </code>
              </li>
              <li>Location accuracy: high; frequency 10–15 s</li>
            </ul>
            {issued && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => copy(`${issued.deviceId}.${issued.deviceKey}`)}
              >
                <CopyIcon /> Copy device identifier
              </Button>
            )}
          </div>
          <div className="space-y-1">
            <div className="font-medium">Hardware tracker / gateway</div>
            <p className="text-muted-foreground">
              <code className="text-xs">
                POST {origin}/api/v1/trn/gps/ingest
              </code>{" "}
              with headers <code className="text-xs">X-Device-Id</code> and{" "}
              <code className="text-xs">X-Device-Key</code>, body{" "}
              <code className="text-xs">{`{ "pings": [{ "recordedAt", "lat", "lng", "speedKmh", "heading" }] }`}</code>{" "}
              (up to 500 fixes, 24 h of buffered history).
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- route history ----

/** "2026-10-24T08:30" in the browser's time zone. */
function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function TrackTab({ vehicle }: { vehicle: Vehicle }) {
  // this tab only renders in the browser (after the vehicle loads), so "now" is safe here
  const [from, setFrom] = useState(() =>
    localInput(new Date(Date.now() - 2 * 3_600_000)),
  );
  const [to, setTo] = useState(() => localInput(new Date()));
  const [range, setRange] = useState<{ from: string; to: string } | null>(
    () => ({
      from: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      to: new Date().toISOString(),
    }),
  );
  const track = useQuery({
    queryKey: ["trn.track", vehicle.id, range],
    queryFn: () =>
      api.trn.vehicles.track<VehicleTrack>(vehicle.id, {
        ...range!,
        maxPoints: 2000,
      }),
    enabled: range !== null,
  });
  const t = track.data?.data;
  const points = (t?.points ?? []).map(
    (p) => [p.lat, p.lng] as [number, number],
  );
  const first = t?.points[0];
  const last = t?.points.at(-1);
  const markers: MapMarker[] = [
    ...(first
      ? [
          {
            id: "start",
            lat: first.lat,
            lng: first.lng,
            label: "S",
            tone: "moving" as const,
            title: `Start ${formatDateTime(first.recordedAt)}`,
          },
        ]
      : []),
    ...(last && t!.points.length > 1
      ? [
          {
            id: "end",
            lat: last.lat,
            lng: last.lng,
            label: "E",
            tone: "alert" as const,
            title: `End ${formatDateTime(last.recordedAt)}`,
          },
        ]
      : []),
  ];

  function show(e: FormEvent) {
    e.preventDefault();
    const f = new Date(from);
    const tt = new Date(to);
    if (Number.isNaN(f.getTime()) || Number.isNaN(tt.getTime()) || f >= tt) {
      toast.error("Pick a start before the end.");
      return;
    }
    setRange({ from: f.toISOString(), to: tt.toISOString() });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Route history</CardTitle>
        <CardDescription>
          Where the vehicle went between two times (downsampled to 2,000
          points).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={show}
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <div className="space-y-1.5">
            <Label htmlFor="from">From</Label>
            <Input
              id="from"
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>
        {track.isError && <ErrorAlert error={track.error} />}
        {t && (
          <p className="text-sm text-muted-foreground">
            {t.totalPoints.toLocaleString()} GPS fixes ·{" "}
            {(t.distanceMeters / 1000).toFixed(1)} km
            {first &&
              last &&
              ` · ${formatDateTime(first.recordedAt)} – ${formatDateTime(last.recordedAt)}`}
          </p>
        )}
        {t && t.points.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No positions in this period.
          </p>
        ) : (
          <MapView
            markers={markers}
            lines={points.length > 1 ? [{ id: "track", points }] : []}
            height={460}
            fitKey={`${JSON.stringify(range)}:${t?.totalPoints ?? -1}`}
          />
        )}
      </CardContent>
    </Card>
  );
}
