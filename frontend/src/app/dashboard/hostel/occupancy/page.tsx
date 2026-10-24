"use client";

import { useQuery } from "@tanstack/react-query";
import { BedDoubleIcon, BedSingleIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";
import { AllocateDialog } from "@/components/hst/dialogs";
import { HostelSelect, useUrlState } from "@/components/hst/shared";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Occupancy, OccupancyBed } from "@/lib/api/services/hst";
import { formatDate, formatMoney, humanize, todayISO } from "@/lib/format";

export default function OccupancyPage() {
  return (
    <Suspense fallback={<Loading />}>
      <OccupancyView />
    </Suspense>
  );
}

function OccupancyView() {
  const { data: me } = useMe();
  const [{ hostelId, date }, setUrl] = useUrlState({
    hostelId: "",
    date: todayISO(),
  });
  const [allocating, setAllocating] = useState<{
    hostelId: string;
    bedId: string;
    label: string;
    date: string;
  } | null>(null);
  const occupancy = useQuery({
    queryKey: ["hst.occupancy", hostelId, date],
    queryFn: async () =>
      (await api.hst.hostels.occupancy(hostelId, { date })).data,
    enabled: Boolean(hostelId),
  });
  const canAllocate = can(me, "hst.allocation.create");

  return (
    <>
      <PageHeader
        title="Occupancy"
        description="Rooms and beds of a hostel on a date: who sleeps where and which beds are free. Click a free bed to allocate it."
        actions={
          hostelId && (
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  href={`/dashboard/hostel/residents?hostelId=${hostelId}&date=${date}`}
                />
              }
            >
              <UsersIcon /> Residents
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <HostelSelect
              value={hostelId}
              onChange={(id) => setUrl({ hostelId: id })}
            />
            <Input
              type="date"
              aria-label="Date"
              className="sm:w-44"
              value={date}
              onChange={(e) =>
                e.target.value && setUrl({ date: e.target.value })
              }
            />
          </div>
          {!hostelId ? (
            <Empty>Choose a hostel.</Empty>
          ) : occupancy.isPending ? (
            <Loading />
          ) : occupancy.isError ? (
            <ErrorAlert error={occupancy.error} />
          ) : (
            <OccupancyMap
              data={occupancy.data}
              onFreeBed={
                canAllocate && occupancy.data.hostel.isActive
                  ? (room, bed) =>
                      setAllocating({
                        hostelId,
                        bedId: bed.bedId,
                        date,
                        label: `${occupancy.data.hostel.name} · room ${room} · bed ${bed.code}`,
                      })
                  : undefined
              }
            />
          )}
        </CardContent>
      </Card>
      <AllocateDialog target={allocating} onClose={() => setAllocating(null)} />
    </>
  );
}

function OccupancyMap({
  data,
  onFreeBed,
}: {
  data: Occupancy;
  onFreeBed?: (roomCode: string, bed: OccupancyBed) => void;
}) {
  const floors = [...new Set(data.rooms.map((r) => r.floor))].sort(
    (a, b) => a - b,
  );
  const pct = data.totals.beds
    ? Math.round((data.totals.occupied / data.totals.beds) * 100)
    : 0;
  return (
    <div className="space-y-4">
      <div className="stats stats-vertical w-full border bg-card sm:stats-horizontal">
        <div className="stat">
          <div className="stat-title">Beds</div>
          <div className="stat-value text-2xl">{data.totals.beds}</div>
          <div className="stat-desc">{data.totals.inactive} out of use</div>
        </div>
        <div className="stat">
          <div className="stat-title">Occupied</div>
          <div className="stat-value text-2xl">{data.totals.occupied}</div>
          <div className="stat-desc">
            {pct}% on {formatDate(data.date)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Free</div>
          <div className="stat-value text-2xl text-success">
            {data.totals.free}
          </div>
          <div className="stat-desc">
            {humanize(data.hostel.gender)} hostel
            {data.hostel.isActive ? "" : " — closed"}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-3 rounded-sm border border-success bg-success/15" />{" "}
          free
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-3 rounded-sm border border-primary bg-primary/15" />{" "}
          occupied
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-3 rounded-sm border bg-muted" /> out of use
        </span>
      </div>
      {data.rooms.length === 0 && (
        <Empty>No rooms in use. Add rooms under Rooms & beds.</Empty>
      )}
      {floors.map((floor) => (
        <div key={floor} className="space-y-2">
          <h2 className="text-sm font-semibold">
            {floor === 0 ? "Ground floor" : `Floor ${floor}`}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.rooms
              .filter((r) => r.floor === floor)
              .map((room) => (
                <Card key={room.roomId} size="sm" className="shadow-none">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <BedDoubleIcon className="size-4" /> Room {room.code}
                    </CardTitle>
                    <CardDescription>
                      {humanize(room.roomType)} ·{" "}
                      {formatMoney(room.monthlyFeePaisa)}/month ·{" "}
                      {
                        room.beds.filter((b) => b.isActive && !b.studentId)
                          .length
                      }{" "}
                      free
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2">
                    {room.beds.map((bed) => (
                      <BedTile
                        key={bed.bedId}
                        bed={bed}
                        onFree={
                          onFreeBed
                            ? () => onFreeBed(room.code, bed)
                            : undefined
                        }
                      />
                    ))}
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BedTile({ bed, onFree }: { bed: OccupancyBed; onFree?: () => void }) {
  const base =
    "flex min-h-14 flex-col items-start gap-0.5 rounded-lg border p-2 text-left text-xs";
  if (bed.studentId)
    return (
      <Link
        href={`/dashboard/hostel/student?studentId=${bed.studentId}`}
        className={`${base} border-primary bg-primary/10 hover:bg-primary/20`}
      >
        <span className="inline-flex items-center gap-1 font-mono font-semibold">
          <BedSingleIcon className="size-3" /> {bed.code}
        </span>
        <span className="line-clamp-2">{bed.studentName ?? "Resident"}</span>
      </Link>
    );
  if (!bed.isActive)
    return (
      <div className={`${base} bg-muted text-muted-foreground`}>
        <span className="font-mono font-semibold">{bed.code}</span>
        <span>out of use</span>
      </div>
    );
  return onFree ? (
    <button
      type="button"
      onClick={onFree}
      className={`${base} border-success bg-success/10 hover:bg-success/20`}
    >
      <span className="font-mono font-semibold">{bed.code}</span>
      <span className="text-success">free · allocate</span>
    </button>
  ) : (
    <div className={`${base} border-success bg-success/10`}>
      <span className="font-mono font-semibold">{bed.code}</span>
      <span className="text-success">free</span>
    </div>
  );
}
