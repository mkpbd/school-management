"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import {
  DetailList,
  ErrorAlert,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { refs } from "@/lib/refs";

const BATCH = 500;

export default function StockTakeSessionPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const [barcode, setBarcode] = useState("");
  const [pending, setPending] = useState<string[]>([]);
  const [lastScan, setLastScan] = useState<{
    scanned: number;
    alreadyScanned: number;
    unknown: string[];
  } | null>(null);
  const [completing, setCompleting] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const report = useQuery({
    queryKey: ["lib.stockTake", id],
    queryFn: () => api.lib.stockTakes.report(id),
    refetchInterval: 15_000,
  });
  const scan = useAction(
    (barcodes: string[]) => api.lib.stockTakes.scan(id, { barcodes }),
    {
      invalidate: [["lib.stockTake", id]],
      success: (r) => `${r.data.scanned} new scans`,
      onSuccess: (r) => {
        setLastScan(r.data);
        setPending([]);
        input.current?.focus();
      },
    },
  );
  const complete = useAction(
    (markMissingAsLost: boolean) =>
      api.lib.stockTakes.complete(id, { markMissingAsLost }),
    {
      invalidate: [["lib.stockTake", id], ["lib.copies"], ["lib.catalogue"]],
      success: (r) =>
        `Completed: ${r.data.scanned}/${r.data.expected} found, ${r.data.markedLost} marked lost, ${r.data.recovered} recovered`,
      toastError: false,
    },
  );

  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorAlert error={report.error} />;
  const r = report.data.data;
  const open = r.status === "in_progress";
  const canScan = open && can(me, "lib.stock_take.create");

  function add(e: FormEvent) {
    e.preventDefault();
    const code = barcode.trim();
    if (!code) return;
    setPending((p) => (p.includes(code) ? p : [...p, code]));
    setBarcode("");
  }

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href="/dashboard/library/stock-takes" />}
      >
        <ArrowLeftIcon /> Stock-takes
      </Button>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Stock-take{" "}
            <StatusBadge status={open ? "in_progress" : "completed"} />
          </span>
        }
        description={<RefLabel source={refs.campuses} id={r.campusId} />}
        actions={
          canScan && (
            <Button onClick={() => setCompleting(true)}>
              <CheckIcon /> Complete
            </Button>
          )
        }
      />

      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4">
            <DetailList
              items={[
                ["Started", formatDate(r.startedOn)],
                ["Completed", formatDate(r.completedOn)],
                [
                  "Id",
                  <span key="id" className="font-mono text-xs">
                    {r.id}
                  </span>,
                ],
              ]}
            />
            <div className="stats stats-vertical w-full border bg-card sm:stats-horizontal">
              <div className="stat">
                <div className="stat-title">Expected on shelf</div>
                <div className="stat-value text-2xl">{r.expected}</div>
              </div>
              <div className="stat">
                <div className="stat-title">Scanned</div>
                <div className="stat-value text-2xl">{r.scanned}</div>
                <progress
                  className="progress progress-primary w-full"
                  value={r.scanned}
                  max={Math.max(r.expected, 1)}
                />
              </div>
              <div className="stat">
                <div className="stat-title">Missing</div>
                <div
                  className={`stat-value text-2xl ${r.missing.length ? "text-warning" : ""}`}
                >
                  {r.missing.length}
                </div>
              </div>
              <div className="stat">
                <div className="stat-title">Unexpected</div>
                <div
                  className={`stat-value text-2xl ${r.unexpected.length ? "text-error" : ""}`}
                >
                  {r.unexpected.length}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {canScan && (
          <Card>
            <CardHeader>
              <CardTitle>Scan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <form onSubmit={add} className="flex gap-2">
                <Input
                  ref={input}
                  autoFocus
                  autoComplete="off"
                  className="font-mono"
                  placeholder="Scan barcode and press Enter…"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={!barcode.trim()}
                >
                  Add
                </Button>
              </form>
              {pending.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {pending.map((b) => (
                    <span
                      key={b}
                      className="badge badge-outline gap-1 font-mono"
                    >
                      {b}
                      <button
                        type="button"
                        aria-label={`Remove ${b}`}
                        onClick={() =>
                          setPending((p) => p.filter((x) => x !== b))
                        }
                      >
                        <XIcon className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <Button
                disabled={pending.length === 0 || scan.isPending}
                onClick={() => scan.mutate(pending.slice(0, BATCH))}
              >
                {scan.isPending && (
                  <span className="loading loading-spinner loading-xs" />
                )}
                Submit {pending.length} scan{pending.length === 1 ? "" : "s"}
              </Button>
              {lastScan && (
                <div
                  role="status"
                  className={`alert alert-soft text-sm ${lastScan.unknown.length ? "alert-warning" : "alert-success"}`}
                >
                  <div>
                    {lastScan.scanned} recorded, {lastScan.alreadyScanned}{" "}
                    already scanned
                    {lastScan.unknown.length > 0 && (
                      <>
                        {" "}
                        · unknown at this campus:{" "}
                        <span className="font-mono">
                          {lastScan.unknown.join(", ")}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Missing (expected but not scanned)</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={r.missing}
              rowKey={(m) => String(m.copyId)}
              empty="Nothing missing."
              columns={[
                { key: "accessionNo", label: "Accession", type: "mono" },
                { key: "title", label: "Title" },
                { key: "shelfLocation", label: "Shelf" },
                { key: "status", label: "Status", type: "status" },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Unexpected (scanned but on loan, lost or withdrawn)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={r.unexpected}
              rowKey={(u) => String(u.copyId)}
              empty="No surprises."
              columns={[
                { key: "accessionNo", label: "Accession", type: "mono" },
                { key: "title", label: "Title" },
                { key: "status", label: "System status", type: "status" },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <FormDialog
        open={completing}
        onOpenChange={setCompleting}
        title="Complete the stock-take?"
        description={`${r.missing.length} copies are missing. Copies found that were marked lost go back on the shelf. This cannot be reopened.`}
        submitLabel="Complete"
        successMessage="Stock-take completed"
        fields={[
          {
            name: "markMissingAsLost",
            label: "Mark missing copies as lost",
            type: "boolean",
            defaultValue: false,
            wide: true,
          },
        ]}
        onSubmit={(body) =>
          complete.mutateAsync(body.markMissingAsLost === true)
        }
      />
    </>
  );
}
