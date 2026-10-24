"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useState } from "react";
import { RefSelect } from "@/components/crud/fields";
import { StudentPicker } from "@/components/fee/student-picker";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, type Row, type StudentListItem } from "@/lib/api";
import type {
  Diet,
  HostelGender,
  Meal,
  MealPlan,
  OutpassKind,
  OutpassRow,
  OutpassStatus,
  ResidentRow,
  RollSession,
  RollStatus,
  RoomType,
} from "@/lib/api/services/hst";
import { formatMoney, humanize } from "@/lib/format";
import type { RefSource } from "@/lib/refs";

// ---- enums (backend/src/modules/hst/domain/*.ts) ----

export const HOSTEL_GENDERS: HostelGender[] = ["boys", "girls", "mixed"];
export const ROOM_TYPES: RoomType[] = [
  "single",
  "double",
  "triple",
  "quad",
  "dormitory",
];
export const MEAL_PLANS: MealPlan[] = ["full", "none"];
export const ROLL_SESSIONS: RollSession[] = ["morning", "night"];
export const ROLL_STATUSES: RollStatus[] = [
  "present",
  "absent",
  "late",
  "on_leave",
];
export const ROLL_SHORT: Record<RollStatus, string> = {
  present: "P",
  absent: "A",
  late: "L",
  on_leave: "LV",
};
export const ROLL_TONE: Record<RollStatus, string> = {
  present: "btn-success",
  absent: "btn-error",
  late: "btn-warning",
  on_leave: "btn-info",
};
export const OUTPASS_KINDS: OutpassKind[] = [
  "day_out",
  "home_leave",
  "medical",
  "other",
];
export const OUTPASS_STATUSES: OutpassStatus[] = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "out",
  "returned",
];
export const MEALS: Meal[] = ["breakfast", "lunch", "snacks", "dinner"];
export const DIETS: Diet[] = [
  "regular",
  "vegetarian",
  "no_beef",
  "diabetic",
  "gluten_free",
  "other",
];
/** day 0 = Sunday (as the backend) */
export const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
/** Default bed count per room type (dormitory: give the number). */
export const DEFAULT_BEDS: Record<RoomType, number | null> = {
  single: 1,
  double: 2,
  triple: 3,
  quad: 4,
  dormitory: null,
};

// ---- dates (Asia/Dhaka, +06:00, no DST) ----

/** `<input type="datetime-local">` value ("YYYY-MM-DDTHH:mm", Dhaka wall clock) -> ISO instant with offset. */
export function toInstant(local: string): string {
  return `${local.length === 16 ? `${local}:00` : local}+06:00`;
}

/** Dhaka wall clock `hours` from now as a datetime-local value. */
export function localInput(hoursFromNow = 0): string {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000 + 6 * 3_600_000);
  return d.toISOString().slice(0, 16);
}

/** YYYY-MM-DD `days` after `date`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday for a YYYY-MM-DD. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function isOverdue(
  p: Pick<OutpassRow, "status" | "returnBy">,
  now = Date.now(),
): boolean {
  return p.status === "out" && new Date(p.returnBy).getTime() < now;
}

/** Out-pass status pill (out = info, returned = success, the rest like StatusBadge). */
export function OutpassBadge({
  pass,
}: {
  pass: Pick<OutpassRow, "status" | "returnBy">;
}) {
  const tone: Record<OutpassStatus, string> = {
    pending: "badge-warning",
    approved: "badge-success",
    rejected: "badge-error",
    cancelled: "badge-ghost",
    out: "badge-info",
    returned: "badge-neutral",
  };
  return (
    <span className="inline-flex flex-wrap gap-1">
      <span
        className={`badge badge-soft badge-sm whitespace-nowrap ${tone[pass.status]}`}
      >
        {humanize(pass.status)}
      </span>
      {isOverdue(pass) && (
        <span className="badge badge-error badge-sm whitespace-nowrap">
          Overdue
        </span>
      )}
    </span>
  );
}

// ---- option sources ----

/** Hostels as a select source (["ref", "hstHostels"]). */
export const hostelsRef: RefSource = {
  key: "hstHostels",
  load: async () => (await api.hst.hostels.list({ pageSize: 500 })).data,
  label: (r) =>
    `${String(r.name)} (${String(r.code)})${r.isActive === false ? " — closed" : ""}`,
};

/** Today's residents of one hostel, or of every hostel; row id = studentId (allocationId, room and bed kept). */
export function residentsRef(hostelId?: string): RefSource {
  return {
    key: `hstResidents:${hostelId || "all"}`,
    load: async () => {
      const ids = hostelId
        ? [hostelId]
        : (
            await api.hst.hostels.list({ pageSize: 500, isActive: "true" })
          ).data.map((h) => String(h.id));
      const lists = await Promise.all(
        ids.map(async (id) => (await api.hst.hostels.residents(id)).data),
      );
      return lists.flat().map((r): Row => ({ ...r, id: r.studentId }));
    },
    label: (r) =>
      `${String(r.studentName)} (${String(r.admissionNo)}) · ${String(r.roomCode)}/${String(r.bedCode)}`,
  };
}

/** Free (active, unoccupied) beds of a hostel on a date; row id = bedId. */
export function freeBedsRef(hostelId: string, date: string): RefSource {
  return {
    key: `hstFreeBeds:${hostelId}:${date}`,
    load: async () => {
      if (!hostelId) return [];
      const { data } = await api.hst.hostels.occupancy(
        hostelId,
        date ? { date } : {},
      );
      return data.rooms.flatMap((room) =>
        room.beds
          .filter((b) => b.isActive && !b.studentId)
          .map((b): Row => ({
            id: b.bedId,
            label: `Room ${room.code} · bed ${b.code} (floor ${room.floor}, ${humanize(room.roomType).toLowerCase()}, ${formatMoney(room.monthlyFeePaisa)}/month)`,
          })),
      );
    },
    label: (r) => String(r.label),
  };
}

// ---- URL state ----

/** Page filters kept in the URL (so pages can link to each other); empty = default. */
export function useUrlState<K extends string>(defaults: Record<K, string>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const values = Object.fromEntries(
    (Object.keys(defaults) as K[]).map((k) => [
      k,
      params.get(k) || defaults[k],
    ]),
  ) as Record<K, string>;
  const set = (next: Partial<Record<K, string>>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next) as Array<
      [string, string | undefined]
    >) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };
  return [values, set] as const;
}

/** Hostel select; picks the only hostel automatically. */
export function HostelSelect({
  value,
  onChange,
  allowAll,
  className = "sm:w-64",
}: {
  value: string;
  onChange: (id: string) => void;
  /** "All hostels" instead of "Choose a hostel" (no auto-pick). */
  allowAll?: boolean;
  className?: string;
}) {
  const hostels = useQuery({
    queryKey: ["ref", hostelsRef.key],
    queryFn: hostelsRef.load,
    staleTime: 60_000,
  });
  const only = hostels.data?.length === 1 ? String(hostels.data[0]!.id) : "";
  useEffect(() => {
    if (!allowAll && !value && only) onChange(only);
  }, [allowAll, value, only, onChange]);
  return (
    <div className={className}>
      <RefSelect
        source={hostelsRef}
        value={value}
        placeholder={allowAll ? "All hostels" : "Choose a hostel"}
        onChange={onChange}
      />
    </div>
  );
}

/** Residents of a hostel on a date (["hst.residents", hostelId, date]). */
export function useResidents(hostelId: string, date?: string) {
  return useQuery({
    queryKey: ["hst.residents", hostelId, date ?? ""],
    queryFn: async () =>
      (await api.hst.hostels.residents(hostelId, date ? { date } : {})).data,
    enabled: Boolean(hostelId),
  });
}

/** studentId -> resident (name, admission no, room, bed) for tables of out-passes and visitors. */
export function useResidentNames(hostelId?: string): Map<string, ResidentRow> {
  const source = residentsRef(hostelId);
  const q = useQuery({
    queryKey: ["ref", source.key],
    queryFn: source.load,
    staleTime: 60_000,
    retry: false,
  });
  return new Map(
    (q.data ?? []).map((r) => [
      String(r.studentId),
      r as unknown as ResidentRow,
    ]),
  );
}

/**
 * A resident of the hostel (select of today's residents); falls back to the student search when the residents
 * cannot be listed (e.g. gate staff without hst.allocation.view).
 */
export function ResidentPicker({
  hostelId,
  value,
  onChange,
}: {
  hostelId?: string;
  value: string;
  onChange: (studentId: string) => void;
}) {
  const source = residentsRef(hostelId);
  const q = useQuery({
    queryKey: ["ref", source.key],
    queryFn: source.load,
    staleTime: 60_000,
    retry: false,
  });
  const [picked, setPicked] = useState<StudentListItem | null>(null);
  if (q.isError)
    return (
      <StudentPicker
        value={picked}
        onChange={(s) => {
          setPicked(s);
          onChange(s?.id ?? "");
        }}
      />
    );
  return (
    <RefSelect
      source={source}
      value={value}
      required
      placeholder="Choose a resident"
      onChange={onChange}
    />
  );
}

/**
 * Guardians: their own children (the student search is scope-filtered). Staff: search any student.
 * Students signed in as themselves do not need it.
 */
export function ChildPicker({
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
    queryKey: ["hst.children", search],
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
            {/* keep a student opened by link selectable even when not in the first page of results */}
            {value && !rows.some((s) => s.id === value) && (
              <option value={value}>Selected student</option>
            )}
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
