"use client";

import {
  ArrowRightLeftIcon,
  BedDoubleIcon,
  DoorOpenIcon,
  EyeIcon,
  PlusIcon,
  SaladIcon,
  SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { Suspense, useDeferredValue, useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import {
  DietDialog,
  TransferDialog,
  VacateDialog,
} from "@/components/hst/dialogs";
import {
  HostelSelect,
  useResidents,
  useUrlState,
} from "@/components/hst/shared";
import { Empty, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { can, useMe } from "@/hooks/use-me";
import type { ResidentRow } from "@/lib/api/services/hst";
import { todayISO } from "@/lib/format";

export default function ResidentsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ResidentsView />
    </Suspense>
  );
}

function ResidentsView() {
  const { data: me } = useMe();
  const [{ hostelId, date }, setUrl] = useUrlState({
    hostelId: "",
    date: todayISO(),
  });
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim().toLowerCase());
  const [transfer, setTransfer] = useState<ResidentRow | null>(null);
  const [vacate, setVacate] = useState<ResidentRow | null>(null);
  const [diet, setDiet] = useState<ResidentRow | null>(null);
  const residents = useResidents(hostelId, date);
  const rows = (residents.data ?? []).filter(
    (r) =>
      !search ||
      r.studentName.toLowerCase().includes(search) ||
      r.admissionNo.toLowerCase().includes(search) ||
      r.roomCode.toLowerCase() === search,
  );
  const canEdit = can(me, "hst.allocation.edit");
  const canDiet = can(me, "hst.mess.create");

  return (
    <>
      <PageHeader
        title="Residents"
        description="Students living in the hostel on a date, with room and bed. Transfer to another bed, vacate, or set the diet for the kitchen."
        actions={
          <>
            {hostelId && (
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    href={`/dashboard/hostel/occupancy?hostelId=${hostelId}&date=${date}`}
                  />
                }
              >
                <BedDoubleIcon /> Occupancy
              </Button>
            )}
            {can(me, "hst.allocation.create") && (
              <Button
                nativeButton={false}
                render={<Link href="/dashboard/hostel/allocate" />}
              >
                <PlusIcon /> Allocate bed
              </Button>
            )}
          </>
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
            <div className="relative sm:w-64">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Name, admission no, room"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
          {!hostelId ? (
            <Empty>Choose a hostel.</Empty>
          ) : (
            <>
              {residents.data && (
                <p className="text-sm text-muted-foreground">
                  {residents.data.length} resident
                  {residents.data.length === 1 ? "" : "s"}
                </p>
              )}
              <DataTable<ResidentRow>
                rowKey={(r) => r.allocationId}
                columns={[
                  {
                    key: "studentName",
                    label: "Student",
                    render: (r) => (
                      <div>
                        <div className="font-medium">{r.studentName}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {r.admissionNo}
                        </div>
                      </div>
                    ),
                  },
                  { key: "roomCode", label: "Room", type: "mono" },
                  { key: "bedCode", label: "Bed", type: "mono" },
                  { key: "floor", label: "Floor" },
                  { key: "validFrom", label: "Since", type: "date" },
                ]}
                rows={rows}
                isPending={residents.isPending}
                error={residents.error}
                empty="No residents on this date."
                actions={(r) => (
                  <>
                    <Button
                      size="xs"
                      variant="ghost"
                      nativeButton={false}
                      render={
                        <Link
                          href={`/dashboard/hostel/student?studentId=${r.studentId}`}
                        />
                      }
                    >
                      <EyeIcon /> View
                    </Button>
                    {canDiet && (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setDiet(r)}
                      >
                        <SaladIcon /> Diet
                      </Button>
                    )}
                    {canEdit && (
                      <>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setTransfer(r)}
                        >
                          <ArrowRightLeftIcon /> Transfer
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setVacate(r)}
                        >
                          <DoorOpenIcon /> Vacate
                        </Button>
                      </>
                    )}
                  </>
                )}
              />
            </>
          )}
        </CardContent>
      </Card>
      <TransferDialog
        resident={transfer}
        hostelId={hostelId}
        onClose={() => setTransfer(null)}
      />
      <VacateDialog resident={vacate} onClose={() => setVacate(null)} />
      <DietDialog resident={diet} onClose={() => setDiet(null)} />
    </>
  );
}
