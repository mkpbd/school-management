"use client";

import { useQuery } from "@tanstack/react-query";
import { BedDoubleIcon, PencilIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { FormDialog } from "@/components/crud/form-dialog";
import { ActionDialog, Field } from "@/components/hst/dialogs";
import {
  DEFAULT_BEDS,
  HostelSelect,
  ROOM_TYPES,
  useUrlState,
} from "@/components/hst/shared";
import {
  BoolBadge,
  ConfirmButton,
  DetailList,
  Empty,
  ErrorAlert,
  Loading,
  PageHeader,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { BedRow, RoomRow, RoomType } from "@/lib/api/services/hst";
import { formatMoney, humanize } from "@/lib/format";

export default function RoomsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RoomsView />
    </Suspense>
  );
}

const ROOM_KEYS = [["hst.rooms"], ["hst.beds"], ["hst.occupancy"]];

function RoomsView() {
  const { data: me } = useMe();
  const [{ hostelId, roomType }, setUrl] = useUrlState({
    hostelId: "",
    roomType: "",
  });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RoomRow | null>(null);
  const [bedsOf, setBedsOf] = useState<RoomRow | null>(null);

  const query = { hostelId, pageSize: 500, ...(roomType ? { roomType } : {}) };
  const rooms = useQuery({
    queryKey: ["hst.rooms", query],
    queryFn: async () => (await api.hst.rooms.list<RoomRow>(query)).data,
    enabled: Boolean(hostelId),
  });
  const addRoom = useAction(
    (body: {
      code: string;
      floor?: number;
      roomType: RoomType;
      monthlyFeePaisa?: number;
      beds?: number;
    }) => api.hst.hostels.addRoom(hostelId, body),
    { invalidate: ROOM_KEYS, toastError: false },
  );
  const update = useAction(
    ({
      room,
      body,
    }: {
      room: RoomRow;
      body: { monthlyFeePaisa?: number; isActive?: boolean };
    }) => api.hst.rooms.update(room.id, body, { rowVersion: room.rowVersion }),
    { invalidate: ROOM_KEYS, toastError: false },
  );

  return (
    <>
      <PageHeader
        title="Rooms & beds"
        description="Rooms with type and monthly rent; beds are the unit of allocation. Deactivate a room or bed to take it out of use."
        actions={
          hostelId && (
            <>
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    href={`/dashboard/hostel/occupancy?hostelId=${hostelId}`}
                  />
                }
              >
                <BedDoubleIcon /> Occupancy
              </Button>
              {can(me, "hst.hostel.create") && (
                <Button onClick={() => setAdding(true)}>
                  <PlusIcon /> Add room
                </Button>
              )}
            </>
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
            <select
              aria-label="Room type"
              className="select select-sm h-8 sm:w-44"
              value={roomType}
              onChange={(e) => setUrl({ roomType: e.target.value })}
            >
              <option value="">All room types</option>
              {ROOM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
          </div>
          {!hostelId ? (
            <Empty>Choose a hostel.</Empty>
          ) : (
            <DataTable<RoomRow>
              columns={[
                { key: "code", label: "Room", type: "mono" },
                { key: "floor", label: "Floor" },
                { key: "roomType", label: "Type", type: "enum" },
                {
                  key: "monthlyFeePaisa",
                  label: "Rent / month",
                  type: "money",
                },
                { key: "isActive", label: "In use", type: "bool" },
              ]}
              rows={rooms.data}
              isPending={rooms.isPending}
              error={rooms.error}
              empty="No rooms yet."
              onRowClick={setBedsOf}
              actions={(room) => (
                <>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setBedsOf(room)}
                  >
                    <BedDoubleIcon /> Beds
                  </Button>
                  {can(me, "hst.hostel.edit") && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit"
                      onClick={() => setEditing(room)}
                    >
                      <PencilIcon />
                    </Button>
                  )}
                </>
              )}
            />
          )}
        </CardContent>
      </Card>

      <FormDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add room"
        description="Beds are created with the room: single 1, double 2, triple 3, quad 4 (A, B, C…). A dormitory needs the number of beds."
        submitLabel="Add room"
        successMessage="Room added"
        fields={[
          {
            name: "code",
            label: "Room no",
            required: true,
            placeholder: "101",
          },
          {
            name: "floor",
            label: "Floor",
            type: "number",
            defaultValue: "0",
            help: "0 = ground, -1 = basement",
          },
          {
            name: "roomType",
            label: "Type",
            type: "select",
            options: ROOM_TYPES,
            required: true,
          },
          {
            name: "monthlyFeePaisa",
            label: "Rent per month (per bed)",
            type: "money",
            help: "Billed with the monthly invoice",
          },
          {
            name: "beds",
            label: "Beds",
            type: "number",
            help: `Default: ${ROOM_TYPES.filter((t) => DEFAULT_BEDS[t])
              .map((t) => `${t} ${DEFAULT_BEDS[t]}`)
              .join(", ")}; required for a dormitory (up to 60)`,
          },
        ]}
        onSubmit={(body) =>
          addRoom.mutateAsync(body as Parameters<typeof addRoom.mutateAsync>[0])
        }
      />

      <FormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={`Edit room ${editing?.code ?? ""}`}
        description="A new rent applies to allocations made from now on."
        row={editing ?? undefined}
        fields={[
          {
            name: "monthlyFeePaisa",
            label: "Rent per month (per bed)",
            type: "money",
            required: true,
          },
          {
            name: "isActive",
            label: "In use",
            type: "boolean",
            help: "Off: the room's beds can no longer be allocated",
          },
        ]}
        onSubmit={(body) => update.mutateAsync({ room: editing!, body })}
      />

      <BedsDialog room={bedsOf} onClose={() => setBedsOf(null)} />
    </>
  );
}

/** Beds of a room: add (codes), activate / deactivate. */
function BedsDialog({
  room,
  onClose,
}: {
  room: RoomRow | null;
  onClose: () => void;
}) {
  return room ? (
    <BedsBody key={room.id} roomId={room.id} onClose={onClose} />
  ) : null;
}

function BedsBody({
  roomId,
  onClose,
}: {
  roomId: string;
  onClose: () => void;
}) {
  const { data: me } = useMe();
  const [codes, setCodes] = useState("");
  const room = useQuery({
    queryKey: ["hst.rooms", "get", roomId],
    queryFn: async () => (await api.hst.rooms.get<RoomRow>(roomId)).data,
  });
  const beds = useQuery({
    queryKey: ["hst.beds", roomId],
    queryFn: async () =>
      (await api.hst.beds.list<BedRow>({ roomId, pageSize: 500 })).data,
  });
  const addBeds = useAction(
    () =>
      api.hst.rooms.addBeds(roomId, {
        codes: codes
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      }),
    {
      success: (r) =>
        `${r.data.added} bed${r.data.added === 1 ? "" : "s"} added`,
      invalidate: ROOM_KEYS,
      toastError: false,
      onSuccess: () => setCodes(""),
    },
  );
  const toggle = useAction(
    async (bed: BedRow) => {
      // fresh row version: the bed may have changed since the list was loaded
      const { rowVersion } = await api.hst.beds.get<BedRow>(bed.id);
      return api.hst.beds.update(
        bed.id,
        { isActive: !bed.isActive },
        { rowVersion },
      );
    },
    { success: "Bed updated", invalidate: ROOM_KEYS },
  );
  const r = room.data;

  return (
    <ActionDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={r ? `Room ${r.code}` : "Room"}
      description="Deactivated beds are not offered for allocation; a resident keeps their bed until vacated or moved."
      submitLabel={can(me, "hst.hostel.create") ? "Add beds" : undefined}
      onSubmit={() => {
        if (!codes.trim())
          throw new Error("Give the bed codes to add, e.g. E, F");
        return addBeds.mutateAsync(undefined);
      }}
    >
      <div className="sm:col-span-2">
        {room.isError ? (
          <ErrorAlert error={room.error} />
        ) : r ? (
          <DetailList
            items={[
              ["Type", humanize(r.roomType)],
              ["Floor", r.floor],
              ["Rent / month", formatMoney(r.monthlyFeePaisa)],
              ["In use", <BoolBadge key="a" value={r.isActive} />],
            ]}
          />
        ) : (
          <Loading />
        )}
      </div>
      <div className="sm:col-span-2">
        <DataTable<BedRow>
          columns={[
            { key: "code", label: "Bed", type: "mono" },
            { key: "isActive", label: "Active", type: "bool" },
          ]}
          rows={beds.data}
          isPending={beds.isPending}
          error={beds.error}
          empty="No beds."
          actions={
            can(me, "hst.hostel.edit")
              ? (bed) => (
                  <ConfirmButton
                    size="xs"
                    variant="ghost"
                    title={`${bed.isActive ? "Deactivate" : "Activate"} bed ${bed.code}?`}
                    description={
                      bed.isActive
                        ? "It will no longer be offered for allocation."
                        : undefined
                    }
                    confirmLabel={bed.isActive ? "Deactivate" : "Activate"}
                    destructive={bed.isActive}
                    onConfirm={() => toggle.mutateAsync(bed)}
                  >
                    {bed.isActive ? "Deactivate" : "Activate"}
                  </ConfirmButton>
                )
              : undefined
          }
        />
      </div>
      {can(me, "hst.hostel.create") && (
        <Field
          label="Add beds"
          wide
          help="Comma separated codes (up to 10 characters each)"
        >
          <Input
            placeholder="E, F"
            value={codes}
            onChange={(e) => setCodes(e.target.value)}
          />
        </Field>
      )}
    </ActionDialog>
  );
}
