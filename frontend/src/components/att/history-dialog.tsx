"use client";

import { useQuery } from "@tanstack/react-query";
import { RefLabel } from "@/components/crud/fields";
import { Empty, ErrorAlert, Loading, StatusBadge } from "@/components/page";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";
import type { MarkHistory } from "./shared";

/** Audit trail of a student's marks on a date (GET /att/students/:id/history): changes and corrections. */
export function HistoryDialog({
  target,
  onClose,
}: {
  target: { studentId: string; date: string; name?: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        {target && <HistoryBody {...target} />}
      </DialogContent>
    </Dialog>
  );
}

const short = (id: string | null) =>
  id ? (
    <span className="font-mono text-xs">{id.slice(0, 8)}…</span>
  ) : (
    <span className="text-muted-foreground">system</span>
  );

function HistoryBody({
  studentId,
  date,
  name,
}: {
  studentId: string;
  date: string;
  name?: string;
}) {
  const history = useQuery({
    queryKey: ["att", "history", studentId, date],
    queryFn: () => api.att.studentHistory<MarkHistory>(studentId, { date }),
  });
  const h = history.data?.data;

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Mark history{name ? `: ${name}` : ""}</DialogTitle>
        <DialogDescription>
          {formatDate(date)} · every change to the daily and lesson marks, who
          made it and when.
        </DialogDescription>
      </DialogHeader>
      {history.isPending ? (
        <Loading />
      ) : history.isError ? (
        <ErrorAlert error={history.error} />
      ) : h ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Daily mark:</span>
            {h.daily ? (
              <StatusBadge status={h.daily.status} />
            ) : (
              <span className="text-muted-foreground">not marked</span>
            )}
            {h.daily?.remarks && (
              <span className="text-xs text-muted-foreground">
                ({h.daily.remarks})
              </span>
            )}
            {h.periods.map((p) => (
              <span
                key={`${p.periodDefinitionId}:${p.teachingGroupId}`}
                className="badge badge-ghost badge-sm gap-1"
              >
                <RefLabel source={refs.periods} id={p.periodDefinitionId} />:{" "}
                {humanize(p.status)}
              </span>
            ))}
          </div>

          <h3 className="text-sm font-medium">Changes</h3>
          {h.changes.length === 0 ? (
            <Empty>No recorded changes.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Register</TableHead>
                  <TableHead>From → to</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {h.changes.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(c.at)}
                    </TableCell>
                    <TableCell>{short(c.by)}</TableCell>
                    <TableCell>
                      {c.register === "daily" ? (
                        "Daily"
                      ) : (
                        <RefLabel
                          source={refs.periods}
                          id={c.periodDefinitionId}
                        />
                      )}
                      <div className="text-xs text-muted-foreground">
                        {humanize(c.action)}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {humanize(c.from)} → {humanize(c.to)}
                    </TableCell>
                    <TableCell>{humanize(c.source)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <h3 className="text-sm font-medium">Corrections</h3>
          {h.corrections.length === 0 ? (
            <Empty>No correction requests.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Requested</TableHead>
                  <TableHead>Register</TableHead>
                  <TableHead>From → to</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {h.corrections.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(c.requestedAt)}
                    </TableCell>
                    <TableCell>
                      {c.kind === "daily" ? (
                        "Daily"
                      ) : (
                        <RefLabel
                          source={refs.periods}
                          id={c.periodDefinitionId}
                        />
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {humanize(c.oldStatus)} → {humanize(c.newStatus)}
                    </TableCell>
                    <TableCell>
                      {c.reason}
                      {c.decisionNote && (
                        <div className="text-xs text-muted-foreground">
                          Note: {c.decisionNote}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      ) : null}
    </div>
  );
}
