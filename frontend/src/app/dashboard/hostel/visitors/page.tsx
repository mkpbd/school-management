"use client";

import { useQuery } from "@tanstack/react-query";
import { LogOutIcon, UserPlusIcon } from "lucide-react";
import { Suspense, useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { ActionDialog, Field, visitorMessage } from "@/components/hst/dialogs";
import {
  HostelSelect,
  ResidentPicker,
  useResidentNames,
  useUrlState,
} from "@/components/hst/shared";
import { ConfirmButton, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { VisitorRow } from "@/lib/api/services/hst";
import { formatDateTime, todayISO } from "@/lib/format";

export default function VisitorsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <VisitorsView />
    </Suspense>
  );
}

function VisitorsView() {
  const { data: me } = useMe();
  const [{ hostelId, date }, setUrl] = useUrlState({
    hostelId: "",
    date: todayISO(),
  });
  const [signingIn, setSigningIn] = useState(false);
  const names = useResidentNames(hostelId || undefined);
  const query = {
    limit: 300,
    ...(hostelId ? { hostelId } : {}),
    ...(date ? { date } : {}),
  };
  const visitors = useQuery({
    queryKey: ["hst.visitors", query],
    queryFn: async () => (await api.hst.visitors.list(query)).data,
  });
  const signOut = useAction((id: string) => api.hst.visitors.signOut(id), {
    success: "Visitor signed out",
    invalidate: [["hst.visitors"]],
  });
  const canGate = can(me, "hst.gate.create");
  const inside = (visitors.data ?? []).filter((v) => !v.outAt).length;

  return (
    <>
      <PageHeader
        title="Visitors"
        description="Visitor log at the hostel gate. A visitor whose phone is not the primary guardian's is flagged for a second look."
        actions={
          canGate && (
            <Button onClick={() => setSigningIn(true)}>
              <UserPlusIcon /> Sign visitor in
            </Button>
          )
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
            <Input
              type="date"
              aria-label="Date"
              className="sm:w-44"
              value={date}
              onChange={(e) =>
                e.target.value && setUrl({ date: e.target.value })
              }
            />
            {inside > 0 && (
              <span className="badge badge-info badge-soft">
                {inside} still inside
              </span>
            )}
          </div>
          <DataTable<VisitorRow>
            columns={[
              {
                key: "visitorName",
                label: "Visitor",
                render: (v) => (
                  <div>
                    <div className="font-medium">{v.visitorName}</div>
                    <div className="text-xs text-muted-foreground">
                      {v.relation}
                      {v.phone ? ` · ${v.phone}` : ""}
                    </div>
                  </div>
                ),
              },
              {
                key: "studentId",
                label: "Visiting",
                render: (v) => {
                  const r = names.get(v.studentId);
                  return (
                    <div>
                      <div>{v.studentName || r?.studentName || "Student"}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {r ? `${r.roomCode}/${r.bedCode}` : v.admissionNo}
                      </div>
                    </div>
                  );
                },
              },
              { key: "purpose", label: "Purpose" },
              { key: "inAt", label: "In", type: "datetime" },
              {
                key: "outAt",
                label: "Out",
                render: (v) =>
                  v.outAt ? (
                    formatDateTime(v.outAt)
                  ) : (
                    <span className="badge badge-info badge-soft badge-sm">
                      Inside
                    </span>
                  ),
              },
            ]}
            rows={visitors.data}
            isPending={visitors.isPending}
            error={visitors.error}
            empty="No visitors on this day."
            actions={
              canGate
                ? (v) =>
                    !v.outAt && (
                      <ConfirmButton
                        size="xs"
                        variant="ghost"
                        title={`Sign ${v.visitorName} out?`}
                        confirmLabel="Sign out"
                        onConfirm={() => signOut.mutateAsync(v.id)}
                      >
                        <LogOutIcon /> Sign out
                      </ConfirmButton>
                    )
                : undefined
            }
          />
        </CardContent>
      </Card>
      {signingIn && (
        <SignInDialog
          hostelId={hostelId || undefined}
          onClose={() => setSigningIn(false)}
        />
      )}
    </>
  );
}

function SignInDialog({
  hostelId,
  onClose,
}: {
  hostelId?: string;
  onClose: () => void;
}) {
  const [d, setD] = useState({
    studentId: "",
    visitorName: "",
    relation: "",
    phone: "",
    idDocNo: "",
    purpose: "",
  });
  const set = (patch: Partial<typeof d>) => setD((v) => ({ ...v, ...patch }));
  const signIn = useAction(
    () => {
      if (!d.studentId) throw new Error("Choose the resident being visited");
      return api.hst.visitors.signIn({
        studentId: d.studentId,
        visitorName: d.visitorName.trim(),
        relation: d.relation.trim(),
        ...(d.phone.trim() ? { phone: d.phone.trim() } : {}),
        ...(d.idDocNo.trim() ? { idDocNo: d.idDocNo.trim() } : {}),
        ...(d.purpose.trim() ? { purpose: d.purpose.trim() } : {}),
      });
    },
    {
      invalidate: [["hst.visitors"]],
      toastError: false,
      onSuccess: (r) => visitorMessage(r.data),
    },
  );
  return (
    <ActionDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Sign visitor in"
      description="The phone is compared with the primary guardian's."
      submitLabel="Sign in"
      onSubmit={() => signIn.mutateAsync(undefined)}
    >
      <Field label="Visiting" required wide>
        <ResidentPicker
          hostelId={hostelId}
          value={d.studentId}
          onChange={(studentId) => set({ studentId })}
        />
      </Field>
      <Field label="Visitor name" required>
        <Input
          required
          value={d.visitorName}
          onChange={(e) => set({ visitorName: e.target.value })}
        />
      </Field>
      <Field label="Relation" required>
        <Input
          required
          minLength={2}
          maxLength={50}
          placeholder="Father, uncle…"
          value={d.relation}
          onChange={(e) => set({ relation: e.target.value })}
        />
      </Field>
      <Field label="Phone">
        <Input
          type="tel"
          pattern="^\+[1-9]\d{7,14}$"
          placeholder="+8801712345678"
          value={d.phone}
          onChange={(e) => set({ phone: e.target.value })}
        />
      </Field>
      <Field label="ID document no">
        <Input
          maxLength={40}
          placeholder="NID / passport"
          value={d.idDocNo}
          onChange={(e) => set({ idDocNo: e.target.value })}
        />
      </Field>
      <Field label="Purpose" wide>
        <Input
          maxLength={200}
          value={d.purpose}
          onChange={(e) => set({ purpose: e.target.value })}
        />
      </Field>
    </ActionDialog>
  );
}
