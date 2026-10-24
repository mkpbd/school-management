"use client";

import { useQuery } from "@tanstack/react-query";
import { BellIcon, PlusIcon, TimerOffIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel, RefSelect } from "@/components/crud/fields";
import {
  OffsetPager,
  ReserveDialog,
  borrowerHref,
} from "@/components/lib/shared";
import { ConfirmButton, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type {
  BorrowerType,
  ReservationRow,
  ReservationStatus,
} from "@/lib/api/services/lib";
import { humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

const LIMIT = 50;
const STATUSES: ReservationStatus[] = [
  "waiting",
  "ready",
  "fulfilled",
  "cancelled",
  "expired",
];

export default function ReservationsPage() {
  const { data: me } = useMe();
  const [status, setStatus] = useState<"" | ReservationStatus>("waiting");
  const [borrowerType, setBorrowerType] = useState<"" | BorrowerType>("");
  const [campusId, setCampusId] = useState("");
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);

  const query = {
    limit: LIMIT,
    offset,
    ...(status ? { status } : {}),
    ...(borrowerType ? { borrowerType } : {}),
    ...(campusId ? { campusId } : {}),
  };
  const list = useQuery({
    queryKey: ["lib.reservations", query],
    queryFn: () => api.lib.reservations.list(query),
  });
  const cancel = useAction((id: string) => api.lib.reservations.cancel(id), {
    success: "Reservation cancelled",
    invalidate: [["lib.reservations"]],
  });
  const reminders = useAction(() => api.lib.tasks.overdueReminders(), {
    success: (r) =>
      `${r.data.overdue} overdue loans, ${r.data.reminded} reminders sent`,
    invalidate: [["lib.loans"]],
  });
  const expire = useAction(() => api.lib.tasks.expireReservations(), {
    success: (r) =>
      `${r.data.expired} expired, ${r.data.passedOn} copies passed to the next reader`,
    invalidate: [["lib.reservations"]],
  });
  const rows = list.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Reservations"
        description="Queue per title and campus. A returned copy is held for the first waiting reader."
        actions={
          <>
            {can(me, "lib.circulation.edit") && (
              <ConfirmButton
                size="default"
                title="Send overdue reminders now?"
                description="Also runs every day at 08:00."
                confirmLabel="Send"
                onConfirm={() => reminders.mutateAsync(undefined)}
              >
                <BellIcon /> Overdue reminders
              </ConfirmButton>
            )}
            {can(me, "lib.reservation.edit") && (
              <ConfirmButton
                size="default"
                title="Expire uncollected reservations now?"
                description="Held copies move to the next reader. Also runs every hour."
                confirmLabel="Expire"
                onConfirm={() => expire.mutateAsync(undefined)}
              >
                <TimerOffIcon /> Expire reservations
              </ConfirmButton>
            )}
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New reservation
            </Button>
          </>
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <select
              aria-label="Status"
              className="select select-sm h-8 sm:w-40"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as typeof status);
                setOffset(0);
              }}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
            <select
              aria-label="Borrower type"
              className="select select-sm h-8 sm:w-40"
              value={borrowerType}
              onChange={(e) => {
                setBorrowerType(e.target.value as typeof borrowerType);
                setOffset(0);
              }}
            >
              <option value="">All readers</option>
              <option value="student">Students</option>
              <option value="staff">Staff</option>
            </select>
            <div className="sm:w-56">
              <RefSelect
                source={refs.campuses}
                value={campusId}
                placeholder="All campuses"
                onChange={(v) => {
                  setCampusId(v);
                  setOffset(0);
                }}
              />
            </div>
          </div>
          <DataTable<ReservationRow>
            rows={rows}
            isPending={list.isPending}
            error={list.error}
            empty="No reservations."
            columns={[
              {
                key: "title",
                label: "Title",
                render: (r) => (
                  <Link
                    className="link link-hover"
                    href={`/dashboard/library/titles/${r.bookTitleId}`}
                  >
                    {r.title}
                  </Link>
                ),
              },
              {
                key: "borrowerId",
                label: "Reader",
                render: (r) => (
                  <Link
                    className="link link-hover"
                    href={borrowerHref(r.borrowerType, r.borrowerId)}
                  >
                    <RefLabel
                      source={
                        r.borrowerType === "student"
                          ? refs.students
                          : refs.staff
                      }
                      id={r.borrowerId}
                    />
                  </Link>
                ),
              },
              { key: "borrowerType", label: "Type", type: "enum" },
              { key: "campusId", label: "Campus", ref: refs.campuses },
              { key: "reservedAt", label: "Reserved", type: "datetime" },
              { key: "status", label: "Status", type: "status" },
              { key: "expiresAt", label: "Collect by", type: "datetime" },
            ]}
            actions={(r) =>
              r.status === "waiting" || r.status === "ready" ? (
                <ConfirmButton
                  variant="ghost"
                  size="xs"
                  destructive
                  title="Cancel this reservation?"
                  description="A held copy moves to the next reader."
                  confirmLabel="Cancel reservation"
                  onConfirm={() => cancel.mutateAsync(r.id)}
                >
                  <XIcon /> Cancel
                </ConfirmButton>
              ) : null
            }
          />
          <OffsetPager
            offset={offset}
            limit={LIMIT}
            count={rows.length}
            onChange={setOffset}
          />
        </CardContent>
      </Card>
      <ReserveDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
