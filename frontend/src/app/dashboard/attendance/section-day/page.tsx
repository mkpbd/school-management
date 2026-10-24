"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardCheckIcon, HistoryIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { HistoryDialog } from "@/components/att/history-dialog";
import {
  BADGE_TONE,
  hhmm,
  SHORT,
  type SectionDay,
} from "@/components/att/shared";
import { RefSelect } from "@/components/crud/fields";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { humanize, todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

function Mark({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted-foreground">·</span>;
  return (
    <span
      className={`badge badge-soft badge-sm ${BADGE_TONE[status] ?? "badge-ghost"}`}
      title={humanize(status)}
    >
      {SHORT[status] ?? humanize(status)}
    </span>
  );
}

function SectionDayPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const sectionId = params.get("sectionId") ?? "";
  const date = params.get("date") ?? todayISO();
  const go = (next: { sectionId?: string; date?: string }) => {
    const q = new URLSearchParams({ sectionId, date, ...next });
    if (!q.get("sectionId")) q.delete("sectionId");
    router.replace(`${pathname}?${q}`);
  };
  const [history, setHistory] = useState<{
    studentId: string;
    date: string;
    name: string;
  } | null>(null);

  const day = useQuery({
    queryKey: ["att", "sectionDay", sectionId, date],
    queryFn: () => api.att.daily.day<SectionDay>(sectionId, { date }),
    enabled: Boolean(sectionId),
  });
  const d = day.data?.data;

  return (
    <>
      <PageHeader
        title="Section day"
        description="Daily mark and every lesson mark per student; missed lessons are lessons absent while at school."
        actions={
          sectionId && (
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  href={`/dashboard/attendance/daily?sectionId=${sectionId}&date=${date}`}
                />
              }
            >
              <ClipboardCheckIcon /> Daily register
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="sm:w-64">
              <RefSelect
                source={refs.sections}
                value={sectionId}
                placeholder="Pick a section"
                onChange={(v) => go({ sectionId: v })}
              />
            </div>
            <Input
              type="date"
              className="sm:w-44"
              aria-label="Date"
              max={todayISO()}
              value={date}
              onChange={(e) => e.target.value && go({ date: e.target.value })}
            />
          </div>
          {!sectionId ? (
            <Empty>Pick a section and a date.</Empty>
          ) : day.isPending ? (
            <Loading />
          ) : day.isError ? (
            <ErrorAlert error={day.error} />
          ) : !d || d.students.length === 0 ? (
            <Empty>No students are placed in this section on this date.</Empty>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Roll</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Daily</TableHead>
                      {d.periods.map((p) => (
                        <TableHead
                          key={p.periodDefinitionId}
                          className="text-center"
                        >
                          <div>{p.label || "—"}</div>
                          <div className="text-xs font-normal text-muted-foreground">
                            {hhmm(p.startsAt)}
                          </div>
                        </TableHead>
                      ))}
                      <TableHead className="text-center">Missed</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.students.map((s) => (
                      <TableRow key={s.studentId}>
                        <TableCell>{s.rollNo ?? "—"}</TableCell>
                        <TableCell className="font-medium">
                          {s.fullNameEn}
                        </TableCell>
                        <TableCell>
                          <Mark status={s.daily} />
                        </TableCell>
                        {d.periods.map((p) => (
                          <TableCell
                            key={p.periodDefinitionId}
                            className="text-center"
                          >
                            <Mark
                              status={s.periods[p.periodDefinitionId]?.status}
                            />
                          </TableCell>
                        ))}
                        <TableCell className="text-center">
                          {s.missedPeriods > 0 ? (
                            <span className="badge badge-error badge-sm">
                              {s.missedPeriods}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              setHistory({
                                studentId: s.studentId,
                                date: d.date,
                                name: s.fullNameEn,
                              })
                            }
                          >
                            <HistoryIcon /> History
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {d.periods.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No lessons are timetabled or marked for this section today.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                P present · A absent · L late · LV leave · H half day · E
                excused · “·” not marked.
              </p>
            </>
          )}
        </CardContent>
      </Card>
      <HistoryDialog target={history} onClose={() => setHistory(null)} />
    </>
  );
}

/** Dates, ids and URL params are read at request time, so the page streams behind a boundary (Cache Components). */
export default function SectionDayPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SectionDayPageContent />
    </Suspense>
  );
}
