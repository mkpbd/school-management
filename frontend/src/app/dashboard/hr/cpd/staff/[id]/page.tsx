"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { RefLabel } from "@/components/crud/fields";
import { currentYear, StaffCpdView, YearSelect } from "@/components/hrm/cpd";
import { Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { refs } from "@/lib/refs";

export default function StaffCpdPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StaffCpd />
    </Suspense>
  );
}

function StaffCpd() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const [year, setYear] = useState(
    () => Number(params.get("year")) || currentYear(),
  );
  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href="/dashboard/hr/cpd/summary" />}
      >
        <ArrowLeftIcon /> CPD summary
      </Button>
      <PageHeader
        title={<RefLabel source={refs.staff} id={id} />}
        description="CPD hours, training records and certificates. Log external training on the staff member's behalf."
        actions={<YearSelect value={year} onChange={setYear} />}
      />
      <StaffCpdView staffId={id} year={year} />
    </>
  );
}
