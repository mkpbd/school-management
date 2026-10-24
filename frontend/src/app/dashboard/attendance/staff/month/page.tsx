"use client";

import { useState, Suspense } from "react";
import { StaffMonthView } from "@/components/att/staff-month";
import { RefSelect } from "@/components/crud/fields";
import { Empty, Loading, PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { currentPeriod } from "@/lib/format";
import { refs } from "@/lib/refs";

function StaffMonthPageContent() {
  const [staffId, setStaffId] = useState("");
  const [month, setMonth] = useState(currentPeriod);

  return (
    <>
      <PageHeader
        title="Staff month"
        description="A staff member's days and what payroll reads from them: unpaid days (with breakdown) and overtime."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="sm:w-72">
              <RefSelect
                source={refs.staff}
                value={staffId}
                placeholder="Pick a staff member"
                onChange={setStaffId}
              />
            </div>
            <Input
              type="month"
              className="sm:w-44"
              aria-label="Month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          </div>
          {staffId ? (
            <StaffMonthView staffId={staffId} month={month} />
          ) : (
            <Empty>Pick a staff member and a month.</Empty>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** Dates, ids and URL params are read at request time, so the page streams behind a boundary (Cache Components). */
export default function StaffMonthPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StaffMonthPageContent />
    </Suspense>
  );
}
