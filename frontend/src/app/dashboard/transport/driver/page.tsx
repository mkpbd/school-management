"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CrosshairIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RefSelect } from "@/components/crud/fields";
import { ConfirmButton, DetailList, PageHeader } from "@/components/page";
import {
  formatAgo,
  routesRef,
  useNow,
  vehiclesRef,
  type IngestResult,
  type TripDirection,
  type TripRow,
} from "@/components/trn/tracking";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { api, isApiError } from "@/lib/api";

const FLUSH_MS = 10_000;
const MAX_QUEUE = 500;

interface Ping {
  recordedAt: string;
  lat: number;
  lng: number;
  speedKmh?: number;
  heading?: number;
}

interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  speedKmh: number | null;
  at: number;
}

function toPing(p: GeolocationPosition): Ping {
  const { latitude, longitude, speed, heading } = p.coords;
  return {
    recordedAt: new Date(p.timestamp).toISOString(),
    lat: latitude,
    lng: longitude,
    ...(speed !== null && Number.isFinite(speed)
      ? { speedKmh: Math.round(speed * 3.6 * 10) / 10 }
      : {}),
    ...(heading !== null && Number.isFinite(heading)
      ? { heading: Math.round(heading) }
      : {}),
  };
}

function message(err: unknown): string {
  return isApiError(err) || err instanceof Error
    ? err.message
    : "Something went wrong";
}

/**
 * Driver console for a phone in the bus: start today's run, share the phone's GPS (batched every 10 s to
 * POST /trn/vehicles/{id}/pings), end the run. The backend accepts fixes only from today's crew (or the desk).
 */
export default function DriverConsolePage() {
  const queryClient = useQueryClient();
  const [routeId, setRouteId] = useState("");
  const [direction, setDirection] = useState<TripDirection>("pickup");
  const [vehicleId, setVehicleId] = useState("");
  const [trip, setTrip] = useState<TripRow | null>(null);
  const [busy, setBusy] = useState(false);

  const [lastFix, setLastFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    sent: 0,
    rejected: 0,
    queued: 0,
    lastSentAt: null as number | null,
  });
  const [sharing, setSharing] = useState(false);
  const [wakeLock, setWakeLock] = useState<"on" | "off" | "unsupported">("off");
  const now = useNow();

  const queue = useRef<Ping[]>([]);
  const watchId = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lock = useRef<WakeLockSentinel | null>(null);
  const sending = useRef(false);
  const vehicleRef = useRef<string | null>(null);

  async function flush() {
    const vid = vehicleRef.current;
    if (!vid || sending.current || queue.current.length === 0) return;
    sending.current = true;
    const batch = queue.current.splice(0, 100);
    try {
      const { data } = await api.trn.vehicles.postPings<IngestResult>(vid, {
        pings: batch,
      });
      setStats((s) => ({
        sent: s.sent + data.stored,
        rejected: s.rejected + data.rejected,
        queued: queue.current.length,
        lastSentAt: Date.now(),
      }));
      setSendError(null);
      if (data.alerts.length) toast.warning(`Alert: ${data.alerts.join(", ")}`);
    } catch (err) {
      queue.current = [...batch, ...queue.current].slice(-MAX_QUEUE); // keep for the next attempt
      setStats((s) => ({ ...s, queued: queue.current.length }));
      setSendError(message(err));
    } finally {
      sending.current = false;
    }
  }

  async function acquireWakeLock() {
    if (!("wakeLock" in navigator)) {
      setWakeLock("unsupported");
      return;
    }
    try {
      lock.current = await navigator.wakeLock.request("screen");
      setWakeLock("on");
      lock.current.addEventListener("release", () => setWakeLock("off"));
    } catch {
      setWakeLock("off");
    }
  }

  function startSharing(vid: string) {
    vehicleRef.current = vid;
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      setGpsError(
        "Location needs HTTPS (or localhost) and a browser with GPS access.",
      );
      return;
    }
    setGpsError(null);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        queue.current = [...queue.current, toPing(p)].slice(-MAX_QUEUE);
        setLastFix({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          speedKmh:
            p.coords.speed !== null && Number.isFinite(p.coords.speed)
              ? p.coords.speed * 3.6
              : null,
          at: p.timestamp,
        });
        setStats((s) => ({ ...s, queued: queue.current.length }));
        setGpsError(null);
      },
      (e) =>
        setGpsError(
          e.code === e.PERMISSION_DENIED
            ? "Location permission denied. Allow location for this site and start again."
            : e.message || "Could not read the location.",
        ),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    setSharing(true);
    timer.current = setInterval(() => void flush(), FLUSH_MS);
    void acquireWakeLock();
  }

  function stopSharing() {
    if (watchId.current !== null)
      navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setSharing(false);
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    void lock.current?.release().catch(() => undefined);
    lock.current = null;
  }

  // stop GPS when leaving the page; re-take the wake lock when the screen comes back
  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        watchId.current !== null &&
        !lock.current
      )
        void acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      stopSharing();
    };
  }, []);

  async function start() {
    setBusy(true);
    try {
      const { data } = await api.trn.trips.start<TripRow>({
        routeId,
        direction,
        ...(vehicleId ? { vehicleId } : {}),
      });
      setTrip(data);
      setStats({ sent: 0, rejected: 0, queued: 0, lastSentAt: null });
      toast.success(data.resumed ? "Trip resumed" : "Trip started");
      startSharing(data.vehicleId);
      void queryClient.invalidateQueries({ queryKey: ["trn.trips"] });
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    if (!trip) return;
    await flush();
    try {
      await api.trn.trips.end(trip.id);
      stopSharing();
      setTrip(null);
      vehicleRef.current = null;
      toast.success("Trip ended");
      void queryClient.invalidateQueries({ queryKey: ["trn.trips"] });
    } catch (err) {
      toast.error(message(err));
      throw err;
    }
  }

  const fixAge = lastFix && now !== null ? (now - lastFix.at) / 1000 : null;

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Driver console"
        description="Start your run and keep this screen open while driving."
      />

      {!trip ? (
        <Card>
          <CardHeader>
            <CardTitle>Start a trip</CardTitle>
            <CardDescription>
              Starting again today resumes the same run.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="route">Route</Label>
              <RefSelect
                id="route"
                source={routesRef}
                value={routeId}
                onChange={setRouteId}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Direction</Label>
              <div role="tablist" className="tabs tabs-box w-full">
                {(["pickup", "drop"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="tab"
                    className={`tab flex-1 capitalize ${direction === d ? "tab-active" : ""}`}
                    onClick={() => setDirection(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vehicle">Vehicle</Label>
              <RefSelect
                id="vehicle"
                source={vehiclesRef}
                value={vehicleId}
                placeholder="The route's vehicle"
                onChange={setVehicleId}
              />
              <p className="text-xs text-muted-foreground">
                Only when driving a different vehicle today.
              </p>
            </div>
            <Button
              size="lg"
              className="h-12 w-full text-base"
              disabled={!routeId || busy}
              onClick={start}
            >
              {busy ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <PlayIcon />
              )}
              Start trip
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>{trip.routeName}</span>
                <span className="badge badge-success badge-soft capitalize">
                  {trip.direction} · running
                </span>
              </CardTitle>
              <CardDescription>
                {sharing
                  ? "Sharing your location every 10 seconds."
                  : "Location is not being shared."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {gpsError && (
                <div
                  role="alert"
                  className="alert alert-error alert-soft text-sm"
                >
                  {gpsError}
                </div>
              )}
              {sendError && (
                <div
                  role="alert"
                  className="alert alert-warning alert-soft text-sm"
                >
                  Not sent yet ({stats.queued} waiting): {sendError}
                </div>
              )}
              <div className="stats stats-vertical w-full border sm:stats-horizontal">
                <div className="stat py-3">
                  <div className="stat-title">Speed</div>
                  <div className="stat-value text-2xl">
                    {lastFix?.speedKmh !== null &&
                    lastFix?.speedKmh !== undefined
                      ? Math.round(lastFix.speedKmh)
                      : "—"}
                    <span className="text-sm font-normal"> km/h</span>
                  </div>
                </div>
                <div className="stat py-3">
                  <div className="stat-title">Sent</div>
                  <div className="stat-value text-2xl">{stats.sent}</div>
                  <div className="stat-desc">
                    {stats.queued} queued · {stats.rejected} rejected
                  </div>
                </div>
              </div>
              <DetailList
                items={[
                  [
                    "Last fix",
                    lastFix ? (
                      <span className="inline-flex items-center gap-1">
                        <CrosshairIcon className="size-3" />
                        {lastFix.lat.toFixed(5)}, {lastFix.lng.toFixed(5)} ·{" "}
                        {formatAgo(fixAge)}
                      </span>
                    ) : (
                      <span className="loading loading-dots loading-xs" />
                    ),
                  ],
                  [
                    "Accuracy",
                    lastFix ? `± ${Math.round(lastFix.accuracy)} m` : "—",
                  ],
                  [
                    "Last upload",
                    stats.lastSentAt && now !== null
                      ? formatAgo((now - stats.lastSentAt) / 1000)
                      : "—",
                  ],
                  [
                    "Screen",
                    wakeLock === "on"
                      ? "Kept on"
                      : wakeLock === "unsupported"
                        ? "Keep it on manually"
                        : "May turn off",
                  ],
                ]}
              />
            </CardContent>
          </Card>
          <ConfirmButton
            size="default"
            variant="destructive"
            destructive
            title="End this trip?"
            description="Location sharing stops and the run is marked completed."
            confirmLabel="End trip"
            onConfirm={end}
          >
            <SquareIcon /> End trip
          </ConfirmButton>
        </div>
      )}
    </div>
  );
}
