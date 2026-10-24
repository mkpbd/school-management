"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import type { AgingRow } from "@/lib/api/services/acc-procurement";
import { formatDate, formatMoney } from "@/lib/format";

type Bucket = Exclude<keyof AgingRow, "vendorId" | "vendorName">;

const BUCKETS: Array<[Bucket, string]> = [
  ["currentPaisa", "Not due"],
  ["d1to30Paisa", "1–30 days"],
  ["d31to60Paisa", "31–60 days"],
  ["d61to90Paisa", "61–90 days"],
  ["over90Paisa", "Over 90 days"],
  ["totalPaisa", "Total"],
];

function Amount({ value, bucket }: { value: number; bucket: Bucket }) {
  const tone =
    value === 0
      ? "text-muted-foreground"
      : bucket === "over90Paisa" || bucket === "d61to90Paisa"
        ? "text-destructive"
        : bucket === "totalPaisa"
          ? "font-medium"
          : "";
  return <span className={`tabular-nums ${tone}`}>{formatMoney(value)}</span>;
}

export default function PayablesAgingPage() {
  const router = useRouter();
  const [asOf, setAsOf] = useState("");
  const query = asOf ? { asOf } : {};
  const aging = useQuery({
    queryKey: ["acc.payablesAging", query],
    queryFn: () => api.acc.payables.aging(query),
  });
  const report = aging.data?.data;
  const rows = report?.vendors ?? [];
  const total = (k: Bucket) => rows.reduce((s, r) => s + r[k], 0);

  return (
    <>
      <PageHeader
        title="Payables aging"
        description="What the campus owes each vendor on open bills, by days past the due date."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="space-y-1.5 sm:w-48">
              <Label htmlFor="aging-asof">As of</Label>
              <Input
                id="aging-asof"
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </div>
            {report && (
              <p className="text-sm text-muted-foreground sm:ml-auto">
                As of {formatDate(report.asOf)} · total payable{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatMoney(report.totalPaisa)}
                </span>
              </p>
            )}
          </div>
          {aging.isError ? (
            <ErrorAlert error={aging.error} />
          ) : aging.isPending ? (
            <Loading />
          ) : !rows.length ? (
            <Empty>Nothing payable.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  {BUCKETS.map(([k, label]) => (
                    <TableHead key={k} className="text-right">
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.vendorId}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(
                        `/dashboard/procurement/vendors/${r.vendorId}`,
                      )
                    }
                  >
                    <TableCell className="font-medium">
                      {r.vendorName}
                    </TableCell>
                    {BUCKETS.map(([k]) => (
                      <TableCell key={k} className="text-right">
                        <Amount value={r[k]} bucket={k} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
              {rows.length > 1 && (
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-medium">All vendors</TableCell>
                    {BUCKETS.map(([k]) => (
                      <TableCell key={k} className="text-right font-medium">
                        <Amount value={total(k)} bucket={k} />
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
