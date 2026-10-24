"use client";

import { EyeIcon, SendIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel, RefSelect } from "@/components/crud/fields";
import { ConfirmButton, ErrorAlert, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { BillingPreview, BillingRunResult } from "@/lib/api/services/fee";
import { currentPeriod, formatMoney, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

type Params = { academicYearId: string; period: string; campusId?: string };

const keyOf = (p: Params) =>
  `${p.academicYearId}|${p.period}|${p.campusId ?? ""}`;

export default function BillingPage() {
  const { data: me } = useMe();
  const [academicYearId, setAcademicYearId] = useState("");
  const [period, setPeriod] = useState(currentPeriod());
  const [campusId, setCampusId] = useState("");
  const [previewed, setPreviewed] = useState<{
    params: Params;
    result: BillingPreview;
  } | null>(null);
  const [posted, setPosted] = useState<BillingRunResult | null>(null);
  /** One Idempotency-Key per (year, period, campus) attempt: a retried post replays instead of re-running. */
  const attempt = useRef<{ key: string; idem: string } | null>(null);

  const params: Params = {
    academicYearId,
    period,
    ...(campusId ? { campusId } : {}),
  };

  const preview = useAction((p: Params) => api.fee.billing.preview(p), {
    toastError: false,
    onSuccess: (r) => {
      setPreviewed({ params, result: r.data });
      setPosted(null);
    },
  });
  const run = useAction(
    (p: Params) => {
      const key = keyOf(p);
      if (attempt.current?.key !== key)
        attempt.current = { key, idem: crypto.randomUUID() };
      return api.fee.billing.run(p, { idempotencyKey: attempt.current.idem });
    },
    {
      invalidate: [["fee.invoices"]],
      onSuccess: (r) => {
        attempt.current = null;
        setPosted(r.data);
        toast.success(`Billing run posted: ${r.data.invoices} invoices`);
      },
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    preview.mutate(params);
  }

  const stale = previewed && keyOf(previewed.params) !== keyOf(params);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="Monthly billing: one invoice per active enrolment from the active fee structure, student items and concessions. Already-billed enrolments are skipped."
      />
      <Card>
        <CardContent>
          <form
            onSubmit={submit}
            className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
          >
            <div className="space-y-1.5">
              <Label>
                Academic year<span className="text-destructive">*</span>
              </Label>
              <RefSelect
                source={refs.academicYears}
                value={academicYearId}
                onChange={setAcademicYearId}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-period">
                Period<span className="text-destructive">*</span>
              </Label>
              <Input
                id="b-period"
                type="month"
                required
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Campus</Label>
              <RefSelect
                source={refs.campuses}
                value={campusId}
                onChange={setCampusId}
                placeholder="Active campus"
              />
            </div>
            <Button type="submit" disabled={preview.isPending}>
              {preview.isPending ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <EyeIcon />
              )}
              Preview
            </Button>
          </form>
          {preview.error && (
            <div className="mt-4">
              <ErrorAlert error={preview.error} />
            </div>
          )}
        </CardContent>
      </Card>

      {previewed && (
        <Card>
          <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>
              Preview for {previewed.params.period}
              {stale && (
                <span className="ml-2 text-sm font-normal text-warning">
                  (filters changed — preview again)
                </span>
              )}
            </CardTitle>
            {can(me, "fee.billing.approve") &&
              previewed.result.invoices > 0 &&
              !posted && (
                <ConfirmButton
                  variant="default"
                  size="default"
                  title={`Post billing for ${previewed.params.period}?`}
                  description={`${previewed.result.invoices} invoices totalling ${formatMoney(previewed.result.totalNetPaisa)} will be issued and guardians notified.`}
                  confirmLabel="Post billing run"
                  onConfirm={() => run.mutateAsync(previewed.params)}
                >
                  <SendIcon /> Post billing run
                </ConfirmButton>
              )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="stats stats-vertical w-full border bg-card sm:stats-horizontal">
              <div className="stat">
                <div className="stat-title">Invoices</div>
                <div className="stat-value text-2xl">
                  {previewed.result.invoices}
                </div>
              </div>
              <div className="stat">
                <div className="stat-title">Total net</div>
                <div className="stat-value text-2xl">
                  {formatMoney(previewed.result.totalNetPaisa)}
                </div>
              </div>
              {Object.entries(previewed.result.skipped).map(([k, v]) => (
                <div key={k} className="stat">
                  <div className="stat-title">
                    Skipped:{" "}
                    {humanize(k.replace(/([A-Z])/g, " $1").toLowerCase())}
                  </div>
                  <div className="stat-value text-2xl">{v}</div>
                </div>
              ))}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">Sample (first 20)</h3>
              <DataTable
                rows={previewed.result.sample}
                rowKey={(r, i) => `${r.studentId}-${i}`}
                empty="Nothing to bill."
                columns={[
                  {
                    key: "studentId",
                    label: "Student",
                    render: (r) => (
                      <RefLabel source={refs.students} id={r.studentId} />
                    ),
                  },
                  { key: "lines", label: "Lines" },
                  {
                    key: "netPaisa",
                    label: "Net",
                    type: "money",
                    className: "text-right",
                  },
                ]}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {posted && (
        <div role="status" className="alert alert-success alert-soft">
          <div>
            <div className="font-medium">
              Billing run posted: {posted.invoices} invoices,{" "}
              {formatMoney(posted.totalNetPaisa)}
            </div>
            <div className="font-mono text-xs">Run {posted.billingRunId}</div>
            <div className="text-xs">
              Skipped:{" "}
              {Object.entries(posted.skipped)
                .map(([k, v]) => `${k} ${v}`)
                .join(", ")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
