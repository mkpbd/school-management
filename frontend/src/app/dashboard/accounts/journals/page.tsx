"use client";

import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Money } from "@/components/acc/accounting";
import { VoucherDialog } from "@/components/acc/accounting-voucher";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { JournalRow } from "@/lib/api/services/acc-accounting";
import { formatDate, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

const PAGE_SIZE = 50;
const SOURCES: Array<[string, string]> = [
  ["hrm", "Payroll (hrm)"],
  ["acc", "Procurement (acc)"],
  ["fee", "Fees (fee)"],
];

export default function JournalsPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [campusId, setCampusId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sourceModule, setSourceModule] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);

  const query = {
    ...(campusId ? { campusId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(sourceModule ? { sourceModule } : {}),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };
  const journals = useQuery({
    queryKey: ["acc.journals", query],
    queryFn: () => api.acc.journals.list(query),
  });
  const rows = journals.data?.data;
  const filter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(0);
  };

  return (
    <>
      <PageHeader
        title="Journals"
        description="Posted vouchers: manual entries and automatic postings from payroll and procurement. Posted journals are never edited; a reversal posts the mirror entry."
        actions={
          can(me, "acc.journal.create") && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New voucher
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="sm:w-56">
              <RefSelect
                source={refs.campuses}
                value={campusId}
                placeholder="All campuses"
                onChange={filter(setCampusId)}
              />
            </div>
            <select
              aria-label="Source"
              className="select select-sm h-8 sm:w-48"
              value={sourceModule}
              onChange={(e) => filter(setSourceModule)(e.target.value)}
            >
              <option value="">All sources</option>
              {SOURCES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              From
              <Input
                type="date"
                className="w-40"
                value={from}
                onChange={(e) => filter(setFrom)(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              To
              <Input
                type="date"
                className="w-40"
                value={to}
                onChange={(e) => filter(setTo)(e.target.value)}
              />
            </label>
          </div>
          <DataTable<JournalRow>
            rows={rows}
            isPending={journals.isPending}
            error={journals.error}
            onRowClick={(j) =>
              router.push(`/dashboard/accounts/journals/${j.id}`)
            }
            empty="No journals posted in this range."
            columns={[
              {
                key: "journalDate",
                label: "Date",
                render: (j) => formatDate(j.journalDate),
              },
              {
                key: "journalNo",
                label: "No.",
                render: (j) => (
                  <span className="font-mono text-xs">{j.journalNo}</span>
                ),
              },
              {
                key: "voucherType",
                label: "Type",
                render: (j) => humanize(j.voucherType),
              },
              {
                key: "narration",
                label: "Narration",
                render: (j) => (
                  <div className="max-w-md">
                    <div className="truncate">{j.narration}</div>
                    {(j.reversalOfId || j.reversedById) && (
                      <span
                        className={`badge badge-soft badge-xs ${j.reversedById ? "badge-error" : "badge-info"}`}
                      >
                        {j.reversedById ? "Reversed" : "Reversal"}
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: "sourceModule",
                label: "Source",
                render: (j) =>
                  j.sourceModule ? (
                    <span className="text-xs">
                      {j.sourceModule} · {humanize(j.sourceType)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Manual
                    </span>
                  ),
              },
              { key: "campusId", label: "Campus", ref: refs.campuses },
              {
                key: "totalPaisa",
                label: "Amount",
                className: "text-right",
                render: (j) => <Money paisa={j.totalPaisa} />,
              },
            ]}
          />
          {(page > 0 || rows?.length === PAGE_SIZE) && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-sm text-muted-foreground">
                Page {page + 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={rows?.length !== PAGE_SIZE}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <VoucherDialog
        open={creating}
        onOpenChange={setCreating}
        onPosted={(j) => router.push(`/dashboard/accounts/journals/${j.id}`)}
      />
    </>
  );
}
