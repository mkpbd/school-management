"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { DaysLeftBadge, type VehicleDocument } from "@/components/trn/fleet";
import { api } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

const WINDOWS = [7, 30, 60, 90, 180, 365];

export default function ExpiringDocumentsPage() {
  const [withinDays, setWithinDays] = useState(30);
  const [campusId, setCampusId] = useState("");
  const query = { withinDays, ...(campusId ? { campusId } : {}) };
  const docs = useQuery({
    queryKey: ["trn.documents", "expiring", query],
    queryFn: () => api.trn.documents.expiring<VehicleDocument[]>(query),
  });
  const rows = docs.data?.data ?? [];
  const expired = rows.filter((d) => (d.daysLeft ?? 0) < 0).length;

  return (
    <>
      <PageHeader
        title="Expiring documents"
        description="Fitness, insurance, tax token, route permit and registration that expire soon or have expired."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              aria-label="Window"
              className="select select-sm h-8 sm:w-48"
              value={withinDays}
              onChange={(e) => setWithinDays(Number(e.target.value))}
            >
              {WINDOWS.map((d) => (
                <option key={d} value={d}>
                  Within {d} days
                </option>
              ))}
            </select>
            <div className="sm:w-56">
              <RefSelect
                source={refs.campuses}
                value={campusId}
                placeholder="All campuses"
                onChange={setCampusId}
              />
            </div>
            {rows.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {rows.length} document{rows.length === 1 ? "" : "s"}
                {expired > 0 && (
                  <span className="text-error"> · {expired} expired</span>
                )}
              </span>
            )}
          </div>
          <DataTable<VehicleDocument>
            rows={rows}
            isPending={docs.isPending}
            error={docs.error}
            empty={`Nothing expires within ${withinDays} days.`}
            columns={[
              {
                key: "regNo",
                label: "Vehicle",
                render: (d) => (
                  <Link
                    className="link link-hover font-mono text-xs"
                    href={`/dashboard/transport/vehicles/${d.vehicleId}`}
                  >
                    {d.regNo}
                  </Link>
                ),
              },
              {
                key: "docType",
                label: "Document",
                render: (d) => humanize(d.docType),
              },
              { key: "docNo", label: "Number", type: "mono" },
              {
                key: "expiresOn",
                label: "Expires",
                render: (d) => formatDate(d.expiresOn),
              },
              {
                key: "daysLeft",
                label: "Status",
                render: (d) => <DaysLeftBadge days={d.daysLeft} />,
              },
            ]}
          />
        </CardContent>
      </Card>
    </>
  );
}
