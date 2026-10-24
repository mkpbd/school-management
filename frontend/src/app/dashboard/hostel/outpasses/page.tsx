"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BellRingIcon,
  CheckIcon,
  LogInIcon,
  LogOutIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import {
  checkInMessage,
  DecideDialog,
  OUTPASS_KEYS,
  OutpassRequestDialog,
} from "@/components/hst/dialogs";
import {
  HostelSelect,
  isOverdue,
  OutpassBadge,
  OUTPASS_STATUSES,
  useResidentNames,
  useUrlState,
} from "@/components/hst/shared";
import { ConfirmButton, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { OutpassRow, OutpassStatus } from "@/lib/api/services/hst";
import { formatDateTime, humanize } from "@/lib/format";

export default function OutpassesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <OutpassesView />
    </Suspense>
  );
}

function OutpassesView() {
  const { data: me } = useMe();
  const [{ hostelId, status }, setUrl] = useUrlState({
    hostelId: "",
    status: "",
  });
  const [requesting, setRequesting] = useState(false);
  const [deciding, setDeciding] = useState<{
    pass: OutpassRow;
    decision: "approved" | "rejected";
    name: string;
  } | null>(null);
  const names = useResidentNames(hostelId || undefined);

  const query = {
    limit: 200,
    ...(hostelId ? { hostelId } : {}),
    ...(status ? { status: status as OutpassStatus } : {}),
  };
  const passes = useQuery({
    queryKey: ["hst.outpasses", query],
    queryFn: async () => (await api.hst.outpasses.list(query)).data,
    refetchInterval: 60_000,
  });
  const nameOf = (id: string) =>
    passes.data?.find((p) => p.studentId === id)?.studentName ||
    names.get(id)?.studentName ||
    "Student";

  const cancel = useAction((id: string) => api.hst.outpasses.cancel(id), {
    success: "Out-pass cancelled",
    invalidate: OUTPASS_KEYS,
  });
  const checkOut = useAction((id: string) => api.hst.outpasses.checkOut(id), {
    success: "Checked out; guardian informed",
    invalidate: OUTPASS_KEYS,
  });
  const checkIn = useAction((id: string) => api.hst.outpasses.checkIn(id), {
    success: (r) => checkInMessage(r.data),
    invalidate: OUTPASS_KEYS,
  });
  const overdue = useAction(() => api.hst.outpasses.alertOverdue(), {
    success: (r) =>
      r.data.overdue
        ? `${r.data.overdue} overdue student${r.data.overdue === 1 ? "" : "s"}: guardians and wardens alerted`
        : "No new overdue students",
    invalidate: [["hst.outpasses"]],
  });

  const canApprove = can(me, "hst.outpass.approve");
  const canGate = can(me, "hst.gate.create");
  const rows = passes.data ?? [];
  const late = rows.filter((p) => isOverdue(p)).length;

  return (
    <>
      <PageHeader
        title="Out-passes"
        description="Requests from guardians and staff. The warden approves; the gate checks students out and back in (guardians are texted at each step)."
        actions={
          <>
            {canApprove && (
              <Button
                variant="outline"
                disabled={overdue.isPending}
                onClick={() => overdue.mutate(undefined)}
              >
                <BellRingIcon /> Check overdue now
              </Button>
            )}
            {can(me, "hst.outpass.create") && (
              <Button onClick={() => setRequesting(true)}>
                <PlusIcon /> Request out-pass
              </Button>
            )}
          </>
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <HostelSelect
              allowAll
              value={hostelId}
              onChange={(id) => setUrl({ hostelId: id })}
            />
            <select
              aria-label="Status"
              className="select select-sm h-8 sm:w-44"
              value={status}
              onChange={(e) => setUrl({ status: e.target.value })}
            >
              <option value="">All statuses</option>
              {OUTPASS_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
            {late > 0 && (
              <span className="badge badge-error">{late} overdue</span>
            )}
          </div>
          <DataTable<OutpassRow>
            columns={[
              {
                key: "studentId",
                label: "Student",
                render: (p) => (
                  <Link
                    href={`/dashboard/hostel/student?studentId=${p.studentId}`}
                    className="font-medium hover:underline"
                  >
                    {nameOf(p.studentId)}
                  </Link>
                ),
              },
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
              {
                key: "outFrom",
                label: "Out / back by",
                render: (p) => (
                  <div className="text-xs whitespace-nowrap">
                    <div>{formatDateTime(p.outFrom)}</div>
                    <div
                      className={
                        isOverdue(p) ? "text-error" : "text-muted-foreground"
                      }
                    >
                      {formatDateTime(p.returnBy)}
                    </div>
                  </div>
                ),
              },
              {
                key: "escortName",
                label: "Escort",
                render: (p) =>
                  p.escortName ? (
                    <div className="text-xs">
                      <div>{p.escortName}</div>
                      <div className="text-muted-foreground">
                        {p.escortPhone}
                      </div>
                    </div>
                  ) : (
                    "—"
                  ),
              },
              { key: "requestedByType", label: "By", type: "enum" },
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
            rows={rows}
            isPending={passes.isPending}
            error={passes.error}
            empty="No out-passes."
            actions={(p) => (
              <>
                {canApprove && p.status === "pending" && (
                  <>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        setDeciding({
                          pass: p,
                          decision: "approved",
                          name: nameOf(p.studentId),
                        })
                      }
                    >
                      <CheckIcon /> Approve
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() =>
                        setDeciding({
                          pass: p,
                          decision: "rejected",
                          name: nameOf(p.studentId),
                        })
                      }
                    >
                      <XIcon /> Reject
                    </Button>
                  </>
                )}
                {canGate && p.status === "approved" && (
                  <ConfirmButton
                    size="xs"
                    variant="ghost"
                    title={`Check out ${nameOf(p.studentId)}?`}
                    description={`Back by ${formatDateTime(p.returnBy)}${p.escortName ? `, with ${p.escortName}` : ""}. The guardian is texted.`}
                    confirmLabel="Check out"
                    onConfirm={() => checkOut.mutateAsync(p.id)}
                  >
                    <LogOutIcon /> Check out
                  </ConfirmButton>
                )}
                {canGate && p.status === "out" && (
                  <ConfirmButton
                    size="xs"
                    variant="ghost"
                    title={`Check in ${nameOf(p.studentId)}?`}
                    description="Minutes late are recorded; the guardian is texted."
                    confirmLabel="Check in"
                    onConfirm={() => checkIn.mutateAsync(p.id)}
                  >
                    <LogInIcon /> Check in
                  </ConfirmButton>
                )}
                {canApprove &&
                  (p.status === "pending" || p.status === "approved") && (
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
                  )}
              </>
            )}
          />
        </CardContent>
      </Card>
      <OutpassRequestDialog
        open={requesting}
        onOpenChange={setRequesting}
        hostelId={hostelId || undefined}
      />
      <DecideDialog target={deciding} onClose={() => setDeciding(null)} />
    </>
  );
}
