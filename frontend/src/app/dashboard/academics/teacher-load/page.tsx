"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { Empty, PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

interface LoadRow extends Record<string, unknown> {
  staffId: string;
  groups: number;
  periodsPerWeek: number;
  scheduledPeriods: number;
}

export default function TeacherLoadPage() {
  const [academicYearId, setAcademicYearId] = useState("");
  const [campusId, setCampusId] = useState("");

  const load = useQuery({
    queryKey: ["aca.teacherLoad", academicYearId, campusId],
    queryFn: async () =>
      (
        await api.aca.teacherLoad<LoadRow[]>({
          academicYearId,
          ...(campusId ? { campusId } : {}),
        })
      ).data,
    enabled: Boolean(academicYearId),
  });

  return (
    <>
      <PageHeader
        title="Teacher load"
        description="Periods allocated per teacher (teaching groups) vs periods scheduled in published timetables."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="sm:w-56">
              <RefSelect
                source={refs.academicYears}
                value={academicYearId}
                placeholder="Pick an academic year…"
                onChange={setAcademicYearId}
              />
            </div>
            <div className="sm:w-56">
              <RefSelect
                source={refs.campuses}
                value={campusId}
                placeholder="All campuses"
                onChange={setCampusId}
              />
            </div>
          </div>
          {!academicYearId ? (
            <Empty>Pick an academic year.</Empty>
          ) : (
            <DataTable
              rowKey={(r) => r.staffId}
              rows={load.data}
              isPending={load.isPending}
              error={load.error}
              empty="No teacher allocations for this year."
              columns={[
                { key: "staffId", label: "Teacher", ref: refs.staff },
                { key: "groups", label: "Groups" },
                { key: "periodsPerWeek", label: "Allocated / week" },
                { key: "scheduledPeriods", label: "Scheduled / week" },
                {
                  key: "gap",
                  label: "Gap",
                  render: (r) => {
                    const gap = r.periodsPerWeek - r.scheduledPeriods;
                    if (gap === 0)
                      return (
                        <span className="badge badge-soft badge-success badge-sm">
                          Balanced
                        </span>
                      );
                    return (
                      <span
                        className={`badge badge-soft badge-sm ${gap > 0 ? "badge-warning" : "badge-error"}`}
                      >
                        {gap > 0 ? `${gap} unscheduled` : `${-gap} over`}
                      </span>
                    );
                  },
                },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
