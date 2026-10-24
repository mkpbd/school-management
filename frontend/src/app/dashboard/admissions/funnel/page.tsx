"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Stat, thisYearRange } from "@/components/adm/shared";
import { DataTable, type Column } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { ErrorAlert, Loading, PageHeader } from "@/components/page";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type {
  FunnelCampaignRow,
  FunnelCounts,
  FunnelSourceRow,
} from "@/lib/api/services/adm-office";
import { formatMoney, humanize, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

const n = (v: number) => <span className="tabular-nums">{v}</span>;

function countColumns<
  R extends FunnelCounts & { conversionPct: number | null },
>(): Column<R>[] {
  return [
    {
      key: "enquiries",
      label: "Enquiries",
      className: "text-right",
      render: (r) => n(r.enquiries),
    },
    {
      key: "applied",
      label: "Applied",
      className: "text-right",
      render: (r) => n(r.applied),
    },
    {
      key: "admitted",
      label: "Admitted",
      className: "text-right",
      render: (r) => n(r.admitted),
    },
    {
      key: "lost",
      label: "Lost",
      className: "text-right",
      render: (r) => n(r.lost),
    },
    {
      key: "spam",
      label: "Spam",
      className: "text-right",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">{r.spam}</span>
      ),
    },
    {
      key: "conversionPct",
      label: "Conversion",
      className: "text-right",
      render: (r) => (
        <span className="font-medium tabular-nums">{pct(r.conversionPct)}</span>
      ),
    },
  ];
}

export default function FunnelPage() {
  const [range, setRange] = useState(() => thisYearRange(todayISO()));
  const [campusId, setCampusId] = useState("");
  const query = { ...range, ...(campusId ? { campusId } : {}) };
  const valid = Boolean(range.from && range.to && range.from <= range.to);
  const funnel = useQuery({
    queryKey: ["adm.funnel", query],
    queryFn: () => api.adm.funnel.get(query),
    enabled: valid,
  });
  const report = funnel.data?.data;
  const t = report?.totals;
  const conversion =
    t && t.enquiries
      ? Math.round((t.admitted / t.enquiries) * 1000) / 10
      : null;

  return (
    <>
      <PageHeader
        title="Admission funnel"
        description="Enquiries → applied → admitted per lead source and campaign. Spam is counted apart; conversion = admitted ÷ enquiries."
      />
      <Card className="mb-4">
        <CardContent className="flex flex-col flex-wrap gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="funnel-from">From</Label>
            <Input
              id="funnel-from"
              type="date"
              className="h-8 sm:w-40"
              value={range.from}
              onChange={(e) =>
                setRange((r) => ({ ...r, from: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="funnel-to">To</Label>
            <Input
              id="funnel-to"
              type="date"
              className="h-8 sm:w-40"
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5 sm:w-56">
            <Label>Campus</Label>
            <RefSelect
              source={refs.campuses}
              value={campusId}
              onChange={setCampusId}
              placeholder="Active campus"
            />
          </div>
        </CardContent>
      </Card>

      {!valid ? (
        <ErrorAlert
          error={new Error("Choose a date range (from on or before to).")}
        />
      ) : funnel.isPending ? (
        <Loading />
      ) : funnel.isError ? (
        <ErrorAlert error={funnel.error} />
      ) : (
        report &&
        t && (
          <>
            <div className="stats stats-vertical mb-4 w-full border bg-card sm:stats-horizontal">
              <Stat title="Enquiries" value={t.enquiries} />
              <Stat title="Applied" value={t.applied} />
              <Stat title="Admitted" value={t.admitted} strong />
              <Stat title="Lost" value={t.lost} />
              <Stat title="Spam" value={t.spam} desc="not counted above" />
              <Stat title="Conversion" value={pct(conversion)} />
            </div>

            <Card className="mb-4">
              <CardHeader>
                <CardTitle>By source</CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable<FunnelSourceRow>
                  rows={report.bySource}
                  rowKey={(r) => r.sourceCode}
                  empty="No enquiries in this period."
                  columns={[
                    {
                      key: "sourceCode",
                      label: "Source",
                      render: (r) => (
                        <span className="font-medium">
                          {humanize(r.sourceCode)}
                        </span>
                      ),
                    },
                    ...countColumns<FunnelSourceRow>(),
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>By campaign</CardTitle>
                <CardDescription>
                  Cost per enquiry = campaign budget ÷ enquiries in the period.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable<FunnelCampaignRow>
                  rows={report.byCampaign}
                  rowKey={(r) => String(r.campaignId)}
                  empty="No campaign enquiries in this period."
                  columns={[
                    {
                      key: "code",
                      label: "Campaign",
                      render: (r) => (
                        <Link
                          className="link link-hover"
                          href={`/dashboard/admissions/enquiries?campaignId=${r.campaignId}`}
                        >
                          <span className="font-medium">{r.name || "—"}</span>{" "}
                          <span className="font-mono text-xs text-muted-foreground">
                            {r.code}
                          </span>
                        </Link>
                      ),
                    },
                    {
                      key: "sourceCode",
                      label: "Channel",
                      render: (r) => humanize(r.sourceCode),
                    },
                    ...countColumns<FunnelCampaignRow>(),
                    {
                      key: "costPerEnquiryPaisa",
                      label: "Cost / enquiry",
                      className: "text-right",
                      render: (r) => (
                        <span className="tabular-nums">
                          {r.costPerEnquiryPaisa === null
                            ? "—"
                            : formatMoney(r.costPerEnquiryPaisa)}
                        </span>
                      ),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          </>
        )
      )}
    </>
  );
}
