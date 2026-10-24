"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, Suspense } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { PageHeader, Loading } from "@/components/page";
import type { RosterRow } from "@/components/sis/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

function RosterPageContent() {
  const router = useRouter();
  const [sectionId, setSectionId] = useState("");
  const [date, setDate] = useState(todayISO);

  const roster = useQuery({
    queryKey: ["sis", "roster", sectionId, date],
    queryFn: () => api.sis.roster<RosterRow[]>(sectionId, { date }),
    enabled: Boolean(sectionId),
  });

  return (
    <>
      <PageHeader
        title="Class roster"
        description="Students placed in a section on a date, in roll order."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="sm:w-64">
              <RefSelect
                source={refs.sections}
                value={sectionId}
                placeholder="Pick a section"
                onChange={setSectionId}
              />
            </div>
            <Input
              type="date"
              className="sm:w-44"
              aria-label="Date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            {roster.data && (
              <span className="self-center text-sm text-muted-foreground">
                {roster.data.data.length} students
              </span>
            )}
          </div>
          {!sectionId ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Pick a section to see its roster.
            </p>
          ) : (
            <DataTable<RosterRow>
              rows={roster.data?.data}
              isPending={roster.isPending}
              error={roster.error}
              rowKey={(r) => r.enrolmentId}
              empty="No students placed on this date."
              onRowClick={(r) =>
                router.push(`/dashboard/students/${r.studentId}`)
              }
              columns={[
                { key: "rollNo", label: "Roll" },
                { key: "fullNameEn", label: "Name" },
                { key: "fullNameBn", label: "Name (Bangla)" },
                { key: "gender", label: "Gender", type: "enum" },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** Dates, ids and URL params are read at request time, so the page streams behind a boundary (Cache Components). */
export default function RosterPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RosterPageContent />
    </Suspense>
  );
}
