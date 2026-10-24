"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, XIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel, RefSelect } from "@/components/crud/fields";
import { StudentPicker } from "@/components/fee/student-picker";
import { ErrorAlert, PageHeader, StatusBadge } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type StudentListItem } from "@/lib/api";
import { formatMoney, toPaisa, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

/** Granted in this browser session (the API has no concession list yet). */
interface Granted {
  id: string;
  status: string;
  studentName: string;
  concessionTypeId: string;
  value: string;
}

export default function ConcessionsPage() {
  const { data: me } = useMe();
  const [granted, setGranted] = useState<Granted[]>([]);
  const canGrant = can(me, "fee.concession.create");
  const canDecide = can(me, "fee.concession.approve");

  const decide = useAction(
    ({ id, decision }: { id: string; decision: "approved" | "rejected" }) =>
      api.fee.concessions.decide(id, { decision }),
    {
      success: (r) => `Concession ${r.data.status}`,
      onSuccess: (r) =>
        setGranted((prev) =>
          prev.map((g) =>
            g.id === r.data.id ? { ...g, status: r.data.status } : g,
          ),
        ),
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Concessions"
        description="Discounts for a student. Types that require approval stay pending until approved."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {canGrant && (
          <GrantForm onGranted={(g) => setGranted((prev) => [g, ...prev])} />
        )}
        {canDecide && (
          <DecideById
            onDecide={(id, decision) => decide.mutate({ id, decision })}
            pending={decide.isPending}
          />
        )}
      </div>
      {granted.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Granted in this session</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable<Granted & Record<string, unknown>>
              rows={granted as Array<Granted & Record<string, unknown>>}
              columns={[
                { key: "studentName", label: "Student" },
                {
                  key: "concessionTypeId",
                  label: "Type",
                  render: (r) => (
                    <RefLabel
                      source={refs.concessionTypes}
                      id={r.concessionTypeId}
                    />
                  ),
                },
                { key: "value", label: "Value" },
                { key: "id", label: "Concession id", type: "mono" },
                {
                  key: "status",
                  label: "Status",
                  render: (r) => <StatusBadge status={r.status} />,
                },
              ]}
              actions={
                canDecide
                  ? (r) =>
                      r.status === "pending" ? (
                        <>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() =>
                              decide.mutate({ id: r.id, decision: "approved" })
                            }
                          >
                            <CheckIcon /> Approve
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() =>
                              decide.mutate({ id: r.id, decision: "rejected" })
                            }
                          >
                            <XIcon /> Reject
                          </Button>
                        </>
                      ) : null
                  : undefined
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GrantForm({ onGranted }: { onGranted: (g: Granted) => void }) {
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [concessionTypeId, setConcessionTypeId] = useState("");
  const [feeHeadId, setFeeHeadId] = useState("");
  const [value, setValue] = useState("");
  const [validFrom, setValidFrom] = useState(todayISO());
  const [validTo, setValidTo] = useState("");
  const [justification, setJustification] = useState("");

  const types = useQuery({
    queryKey: ["ref", refs.concessionTypes.key],
    queryFn: refs.concessionTypes.load,
    staleTime: 60_000,
  });
  const type = types.data?.find((t) => t.id === concessionTypeId);
  const isPercent = type?.calc !== "amount";

  const grant = useAction(
    () =>
      api.fee.concessions.grant({
        studentId: student!.id,
        concessionTypeId,
        ...(feeHeadId ? { feeHeadId } : {}),
        ...(isPercent
          ? { valuePercent: Number(value) }
          : { valuePaisa: toPaisa(value) }),
        validFrom,
        validTo,
        ...(justification.trim()
          ? { justification: justification.trim() }
          : {}),
      }),
    {
      success: (r) =>
        r.data.status === "pending"
          ? "Concession granted, waiting for approval"
          : "Concession granted",
      toastError: false,
      onSuccess: (r) => {
        onGranted({
          id: r.data.id,
          status: r.data.status,
          studentName: `${student!.fullNameEn} (${student!.admissionNo})`,
          concessionTypeId,
          value: isPercent ? `${value}%` : formatMoney(toPaisa(value)),
        });
        setStudent(null);
        setValue("");
        setJustification("");
      },
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    grant.mutate(undefined);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Grant a concession</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          {grant.error && <ErrorAlert error={grant.error} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>
                Student<span className="text-destructive">*</span>
              </Label>
              <StudentPicker value={student} onChange={setStudent} />
            </div>
            <div className="space-y-1.5">
              <Label>
                Concession type<span className="text-destructive">*</span>
              </Label>
              <RefSelect
                source={refs.concessionTypes}
                value={concessionTypeId}
                onChange={(v) => {
                  setConcessionTypeId(v);
                  const t = types.data?.find((x) => x.id === v);
                  setValue(
                    t?.defaultValue !== undefined && t?.defaultValue !== null
                      ? String(
                          t.calc === "amount"
                            ? Number(t.defaultValue) / 100
                            : t.defaultValue,
                        )
                      : "",
                  );
                }}
                required
              />
              {type && (
                <p className="text-xs text-muted-foreground">
                  {type.requiresApproval
                    ? "Needs approval."
                    : "Applied immediately."}{" "}
                  Stacking: {String(type.stacking)}.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Fee head</Label>
              <RefSelect
                source={refs.feeHeads}
                value={feeHeadId}
                onChange={setFeeHeadId}
                placeholder="Type's fee heads"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-value">
                {isPercent ? "Percent (%)" : "Amount (৳)"}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="c-value"
                type="number"
                step="0.01"
                min="0"
                max={isPercent ? 100 : undefined}
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <div />
            <div className="space-y-1.5">
              <Label htmlFor="c-from">
                Valid from<span className="text-destructive">*</span>
              </Label>
              <Input
                id="c-from"
                type="date"
                required
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-to">
                Valid to<span className="text-destructive">*</span>
              </Label>
              <Input
                id="c-to"
                type="date"
                required
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-why">Justification</Label>
              <Textarea
                id="c-why"
                rows={2}
                maxLength={500}
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
              />
            </div>
          </div>
          <Button type="submit" disabled={!student || grant.isPending}>
            {grant.isPending && (
              <span className="loading loading-spinner loading-xs" />
            )}
            Grant concession
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DecideById({
  onDecide,
  pending,
}: {
  onDecide: (id: string, decision: "approved" | "rejected") => void;
  pending: boolean;
}) {
  const [id, setId] = useState("");
  const valid = /^[0-9a-f-]{36}$/i.test(id.trim());
  return (
    <Card>
      <CardHeader>
        <CardTitle>Approve a pending concession</CardTitle>
        <CardDescription>
          Paste the concession id from the request.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          placeholder="Concession id (UUID)"
          className="font-mono"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            disabled={!valid || pending}
            onClick={() => onDecide(id.trim(), "approved")}
          >
            <CheckIcon /> Approve
          </Button>
          <Button
            variant="outline"
            disabled={!valid || pending}
            onClick={() => onDecide(id.trim(), "rejected")}
          >
            <XIcon /> Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
