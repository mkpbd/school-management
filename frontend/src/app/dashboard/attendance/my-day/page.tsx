"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardCheckIcon, LayoutGridIcon } from "lucide-react";
import Link from "next/link";
import { useState, Suspense } from "react";
import { explain, hhmm, type MyRegisters } from "@/components/att/shared";
import { DataTable } from "@/components/crud/data-table";
import { ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { todayISO } from "@/lib/format";

type DailyItem = MyRegisters["daily"][number] & Record<string, unknown>;
type PeriodItem = MyRegisters["periods"][number] & Record<string, unknown>;

function Progress({ marked, students }: { marked: number; students: number }) {
  const done = students > 0 && marked >= students;
  return (
    <div className="flex items-center gap-2">
      <progress
        className={`progress w-24 ${done ? "progress-success" : marked ? "progress-warning" : ""}`}
        value={marked}
        max={Math.max(students, 1)}
      />
      <span className="text-xs tabular-nums">
        {marked} / {students}
      </span>
    </div>
  );
}

function Window({ editable }: { editable: boolean }) {
  return editable ? (
    <span className="badge badge-success badge-soft badge-sm">Open</span>
  ) : (
    <span className="badge badge-ghost badge-sm">Closed</span>
  );
}

function MyDayPageContent() {
  const [date, setDate] = useState(todayISO);
  const day = useQuery({
    queryKey: ["att", "myRegisters", date],
    queryFn: () => api.att.myRegisters<MyRegisters>({ date }),
    retry: false,
  });
  const data = day.data?.data;

  return (
    <>
      <PageHeader
        title="My day"
        description="Your registration classes and the lessons to mark today, with progress and the edit window."
        actions={
          <Input
            type="date"
            className="w-44"
            aria-label="Date"
            max={todayISO()}
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        }
      />
      {day.isError ? (
        <ErrorAlert error={new Error(explain(day.error))} />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Registration classes</CardTitle>
              <CardDescription>
                Daily register of the sections you are class teacher of.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable<DailyItem>
                rows={data?.daily as DailyItem[] | undefined}
                isPending={day.isPending}
                rowKey={(r) => r.classSectionId}
                empty="You are not class teacher of a section this year."
                columns={[
                  {
                    key: "name",
                    label: "Section",
                    render: (r) => (
                      <span className="font-medium">{r.name}</span>
                    ),
                  },
                  {
                    key: "marked",
                    label: "Marked",
                    render: (r) => (
                      <Progress marked={r.marked} students={r.students} />
                    ),
                  },
                  {
                    key: "editable",
                    label: "Edit window",
                    render: (r) => <Window editable={r.editable} />,
                  },
                ]}
                actions={(r) => (
                  <>
                    <Button
                      size="xs"
                      nativeButton={false}
                      render={
                        <Link
                          href={`/dashboard/attendance/daily?sectionId=${r.classSectionId}&date=${date}`}
                        />
                      }
                    >
                      <ClipboardCheckIcon /> Register
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      nativeButton={false}
                      render={
                        <Link
                          href={`/dashboard/attendance/section-day?sectionId=${r.classSectionId}&date=${date}`}
                        />
                      }
                    >
                      <LayoutGridIcon /> Day grid
                    </Button>
                  </>
                )}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Lessons</CardTitle>
              <CardDescription>
                Period-wise registers of your lessons (including cover) in year
                groups that take lesson attendance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable<PeriodItem>
                rows={data?.periods as PeriodItem[] | undefined}
                isPending={day.isPending}
                rowKey={(r) => `${r.teachingGroupId}|${r.periodDefinitionId}`}
                empty="No period-wise lessons on this date."
                columns={[
                  {
                    key: "label",
                    label: "Period",
                    render: (r) => (
                      <>
                        <div className="font-medium">{r.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {hhmm(r.startsAt)}–{hhmm(r.endsAt)}
                        </div>
                      </>
                    ),
                  },
                  {
                    key: "groupName",
                    label: "Group",
                    render: (r) => (
                      <>
                        {r.groupName}
                        {r.cover && (
                          <span className="badge badge-warning badge-soft badge-sm ml-2">
                            Cover
                          </span>
                        )}
                      </>
                    ),
                  },
                  {
                    key: "marked",
                    label: "Marked",
                    render: (r) => (
                      <Progress marked={r.marked} students={r.students} />
                    ),
                  },
                  {
                    key: "editable",
                    label: "Edit window",
                    render: (r) => <Window editable={r.editable} />,
                  },
                ]}
                actions={(r) => (
                  <Button
                    size="xs"
                    nativeButton={false}
                    render={
                      <Link
                        href={`/dashboard/attendance/periods/${r.teachingGroupId}/${r.periodDefinitionId}?date=${date}`}
                      />
                    }
                  >
                    <ClipboardCheckIcon /> Take register
                  </Button>
                )}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

/** Dates, ids and URL params are read at request time, so the page streams behind a boundary (Cache Components). */
export default function MyDayPage() {
  return (
    <Suspense fallback={<Loading />}>
      <MyDayPageContent />
    </Suspense>
  );
}
