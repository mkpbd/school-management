"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BedDoubleIcon,
  DoorOpenIcon,
  PhoneIcon,
  PlusIcon,
  UserIcon,
} from "lucide-react";
import { Suspense, useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { OUTPASS_KEYS, OutpassRequestDialog } from "@/components/hst/dialogs";
import { StudentMealsPanel } from "@/components/hst/meals";
import {
  ChildPicker,
  OutpassBadge,
  useUrlState,
} from "@/components/hst/shared";
import {
  ConfirmButton,
  DetailList,
  Empty,
  ErrorAlert,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, isApiError } from "@/lib/api";
import type { OutpassRow } from "@/lib/api/services/hst";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  humanize,
} from "@/lib/format";

export default function StudentHostelPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StudentHostelView />
    </Suspense>
  );
}

/** Guardians: their children; students: themselves; staff: any student (?studentId= from the hostel pages). */
function StudentHostelView() {
  const { data: me, isPending } = useMe();
  const [{ studentId: picked }, setUrl] = useUrlState({ studentId: "" });
  if (isPending) return <Loading />;
  const ownStudent = me?.studentId;
  const studentId = ownStudent ?? picked;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Hostel"
        description="Room and bed, warden, out-passes, recent roll calls and meals of a hostel resident."
      />
      {!ownStudent && (
        <ChildPicker
          value={picked}
          onChange={(id) => setUrl({ studentId: id })}
          staff={can(me, ["hst.allocation.view", "hst.mess.create"])}
        />
      )}
      {studentId ? (
        <StudentHostel key={studentId} studentId={studentId} />
      ) : (
        <Empty>Pick a student.</Empty>
      )}
    </div>
  );
}

function StudentHostel({ studentId }: { studentId: string }) {
  const { data: me } = useMe();
  const [requesting, setRequesting] = useState(false);
  const hostel = useQuery({
    queryKey: ["hst.student", studentId],
    queryFn: async () => (await api.hst.student(studentId)).data,
    retry: false,
  });
  const cancel = useAction((id: string) => api.hst.outpasses.cancel(id), {
    success: "Out-pass cancelled",
    invalidate: OUTPASS_KEYS,
  });

  if (hostel.isPending) return <Loading />;
  if (hostel.isError) {
    if (isApiError(hostel.error) && hostel.error.status === 404)
      return <Empty>Student not found.</Empty>;
    return <ErrorAlert error={hostel.error} />;
  }
  const h = hostel.data;
  if (!h.allocation)
    return <Empty>This student does not live in a hostel.</Empty>;
  const a = h.allocation;
  // guardians and hostel staff request passes; the student signed in as themselves cannot
  const canRequest = me?.type === "guardian" || can(me, "hst.outpass.create");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BedDoubleIcon className="size-4" /> {a.hostelName}
            </CardTitle>
            <CardDescription>
              Room {a.roomCode}, bed {a.bedCode} · since{" "}
              {formatDate(a.validFrom)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                ["Room", a.roomCode],
                ["Bed", a.bedCode],
                ["Since", formatDate(a.validFrom)],
                ["Rent", `${formatMoney(a.monthlyFeePaisa)} / month`],
                ["Meal plan", humanize(a.mealPlan)],
                [
                  "Meal fee",
                  a.mealFeePaisa
                    ? `${formatMoney(a.mealFeePaisa)} / month`
                    : "—",
                ],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Contacts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <UserIcon className="size-4 text-muted-foreground" />
              {h.warden ? (
                <span>
                  {h.warden.name} (warden)
                  {h.warden.phone && (
                    <a className="ml-1 link" href={`tel:${h.warden.phone}`}>
                      {h.warden.phone}
                    </a>
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  No warden assigned
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <PhoneIcon className="size-4 text-muted-foreground" />
              {h.hostelPhone ? (
                <a className="link" href={`tel:${h.hostelPhone}`}>
                  {h.hostelPhone} (hostel office)
                </a>
              ) : (
                <span className="text-muted-foreground">No hostel phone</span>
              )}
            </div>
            <div className="pt-2">
              <div className="mb-1 text-xs text-muted-foreground">
                Recent roll calls
              </div>
              {h.lastRollCalls.length === 0 ? (
                <span className="text-muted-foreground">
                  None in the last 3 days
                </span>
              ) : (
                <ul className="space-y-1">
                  {h.lastRollCalls.map((r) => (
                    <li
                      key={`${r.date}|${r.session}`}
                      className="flex items-center justify-between gap-2"
                    >
                      <span>
                        {formatDate(r.date)} · {humanize(r.session)}
                      </span>
                      <StatusBadge status={r.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <DoorOpenIcon className="size-4" /> Out-passes
            </CardTitle>
            <CardDescription>
              The last 10. The warden approves; the gate texts the guardian on
              leaving and return.
            </CardDescription>
          </div>
          {canRequest && (
            <Button onClick={() => setRequesting(true)}>
              <PlusIcon /> Request out-pass
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataTable<OutpassRow>
            columns={[
              {
                key: "kind",
                label: "Pass",
                render: (p) => (
                  <div>
                    <div>{humanize(p.kind)}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.destination}
                    </div>
                  </div>
                ),
              },
              { key: "outFrom", label: "Leaves", type: "datetime" },
              { key: "returnBy", label: "Back by", type: "datetime" },
              {
                key: "checkedOutAt",
                label: "Gate",
                render: (p) => (
                  <div className="text-xs whitespace-nowrap">
                    {p.checkedOutAt && (
                      <div>Out {formatDateTime(p.checkedOutAt)}</div>
                    )}
                    {p.checkedInAt && (
                      <div>In {formatDateTime(p.checkedInAt)}</div>
                    )}
                    {!p.checkedOutAt && !p.checkedInAt && "—"}
                  </div>
                ),
              },
              {
                key: "status",
                label: "Status",
                render: (p) => (
                  <div>
                    <OutpassBadge pass={p} />
                    {p.decisionNote && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {p.decisionNote}
                      </div>
                    )}
                  </div>
                ),
              },
            ]}
            rows={h.outpasses}
            empty="No out-passes."
            actions={(p) =>
              (p.status === "pending" || p.status === "approved") &&
              (me?.type === "guardian" || can(me, "hst.outpass.approve")) && (
                <ConfirmButton
                  size="xs"
                  variant="ghost"
                  destructive
                  title="Cancel this out-pass?"
                  confirmLabel="Cancel out-pass"
                  onConfirm={() => cancel.mutateAsync(p.id)}
                >
                  Cancel
                </ConfirmButton>
              )
            }
          />
        </CardContent>
      </Card>

      {/* the meals endpoint is for the family and the warden (hst.mess.create) */}
      {(me?.type !== "staff" || can(me, "hst.mess.create")) && (
        <StudentMealsPanel studentId={studentId} />
      )}

      <OutpassRequestDialog
        open={requesting}
        onOpenChange={setRequesting}
        studentId={studentId}
      />
    </div>
  );
}
