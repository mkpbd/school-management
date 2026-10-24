"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogInIcon, LogOutIcon, MapPinIcon } from "lucide-react";
import { useState, Suspense } from "react";
import { toast } from "sonner";
import {
  explain,
  toDhakaTime,
  type StaffDayRow,
  type StaffMonth,
} from "@/components/att/shared";
import { StaffMonthView } from "@/components/att/staff-month";
import { Loading, PageHeader, StatusBadge } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { currentPeriod, formatDate, todayISO } from "@/lib/format";

/**
 * Browser location for the campus geofence. Denied / unavailable / slow resolves to {} so the check-in is still
 * sent; the backend answers LOCATION_REQUIRED only when the campus has a geofence.
 */
function currentLocation(): Promise<{
  lat?: number;
  lng?: number;
  denied?: boolean;
}> {
  if (typeof navigator === "undefined" || !navigator.geolocation)
    return Promise.resolve({});
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => resolve({ denied: err.code === err.PERMISSION_DENIED }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    ),
  );
}

function MyAttendancePageContent() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentPeriod);
  const [busy, setBusy] = useState<"in" | "out" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const today = todayISO();

  // today's row comes from the own month (no separate endpoint)
  const thisMonth = useQuery({
    queryKey: ["att", "staffMonth", "me", currentPeriod()],
    queryFn: () => api.att.staff.month<StaffMonth>({ month: currentPeriod() }),
    retry: false,
  });
  const todayRow = thisMonth.data?.data.days.find(
    (d) => d.attendanceDate === today,
  );

  async function punch(kind: "in" | "out") {
    setBusy(kind);
    setProblem(null);
    try {
      const { denied, ...location } = await currentLocation();
      if (denied)
        toast.info(
          "Location access was denied; sending without your location.",
        );
      const { data } =
        kind === "in"
          ? await api.att.staff.checkIn<StaffDayRow>(location)
          : await api.att.staff.checkOut<StaffDayRow>(location);
      toast.success(
        kind === "in"
          ? `Checked in at ${toDhakaTime(data.checkInAt)}${data.lateMinutes ? ` (${data.lateMinutes} min late)` : ""}`
          : `Checked out at ${toDhakaTime(data.checkOutAt)}${data.overtimeMinutes ? ` (${data.overtimeMinutes} min overtime)` : ""}`,
      );
      await queryClient.invalidateQueries({
        queryKey: ["att", "staffMonth", "me"],
      });
    } catch (err) {
      const message = explain(err);
      setProblem(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="My attendance"
        description="Check in when you arrive and check out when you leave. Late, early leave and overtime are computed."
      />
      <div className="space-y-6">
        <Card>
          <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Today · {formatDate(today)}</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                {todayRow ? (
                  <>
                    <StatusBadge status={todayRow.status} />
                    <span>In {toDhakaTime(todayRow.checkInAt) || "—"}</span>
                    <span>· Out {toDhakaTime(todayRow.checkOutAt) || "—"}</span>
                    {todayRow.lateMinutes > 0 && (
                      <span>· {todayRow.lateMinutes} min late</span>
                    )}
                  </>
                ) : (
                  "Not checked in yet."
                )}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => punch("in")}
                disabled={busy !== null || Boolean(todayRow?.checkInAt)}
              >
                {busy === "in" ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <LogInIcon />
                )}
                Check in
              </Button>
              <Button
                variant="outline"
                onClick={() => punch("out")}
                disabled={busy !== null || !todayRow?.checkInAt}
              >
                {busy === "out" ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <LogOutIcon />
                )}
                Check out
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPinIcon className="size-3" /> Your browser asks for your
              location; it is checked against the campus area when one is set.
            </p>
            {problem && (
              <div
                role="alert"
                className="alert alert-error alert-soft text-sm"
              >
                {problem}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Month</CardTitle>
              <CardDescription>
                Your days and what payroll counts (unpaid days, overtime).
              </CardDescription>
            </div>
            <Input
              type="month"
              className="w-44"
              aria-label="Month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          </CardHeader>
          <CardContent>
            <StaffMonthView month={month} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** Dates, ids and URL params are read at request time, so the page streams behind a boundary (Cache Components). */
export default function MyAttendancePage() {
  return (
    <Suspense fallback={<Loading />}>
      <MyAttendancePageContent />
    </Suspense>
  );
}
