"use client";

import { CalendarDaysIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { currentYear, StaffCpdView, YearSelect } from "@/components/hrm/cpd";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";

export default function MyCpdPage() {
  const [year, setYear] = useState(currentYear);
  return (
    <>
      <PageHeader
        title="My CPD"
        description="Your continuing professional development hours against the yearly target, with certificates."
        actions={
          <>
            <YearSelect value={year} onChange={setYear} />
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/dashboard/hr/cpd/sessions" />}
            >
              <CalendarDaysIcon /> Browse sessions
            </Button>
          </>
        }
      />
      <StaffCpdView year={year} />
    </>
  );
}
