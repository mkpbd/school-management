"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeCheckIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import {
  CertificateFileButton,
  currentYear,
  hours,
  YearSelect,
  type CpdRecord,
} from "@/components/hrm/cpd";
import { ConfirmButton, PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

export default function CpdVerificationPage() {
  const { data: me } = useMe();
  const [year, setYear] = useState(currentYear);
  const pending = useQuery({
    queryKey: ["hrm.cpdPending", year],
    queryFn: () => api.hrm.cpdRecords.pending<CpdRecord[]>({ year }),
  });
  const verify = useAction((id: string) => api.hrm.cpdRecords.verify(id), {
    success: "Verified — the hours now count towards the target",
    invalidate: [["hrm.cpdPending"], ["hrm.cpd"], ["hrm.cpdSummary"]],
  });
  const canOpenFiles = can(me, "hrm.cpd.view");

  return (
    <>
      <PageHeader
        title="CPD verification"
        description="External training logged by staff, waiting for HR to check the certificate. Verified hours count towards the yearly target; you cannot verify your own."
        actions={<YearSelect value={year} onChange={setYear} />}
      />
      <Card>
        <CardContent>
          <DataTable<CpdRecord>
            rows={pending.data?.data}
            isPending={pending.isPending}
            error={pending.error}
            empty={`Nothing waiting for verification in ${year}.`}
            columns={[
              {
                key: "staffName",
                label: "Staff",
                render: (r) => (
                  <Link
                    className="link link-hover"
                    href={`/dashboard/hr/cpd/staff/${r.staffId}?year=${year}`}
                  >
                    {r.staffName}
                  </Link>
                ),
              },
              {
                key: "title",
                label: "Training",
                render: (r) => (
                  <div>
                    <div className="font-medium">{r.title}</div>
                    {r.provider && (
                      <div className="text-xs text-muted-foreground">
                        {r.provider}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: "completedOn",
                label: "Completed",
                render: (r) => formatDate(r.completedOn),
              },
              {
                key: "hours",
                label: "Hours",
                render: (r) => (
                  <span className="tabular-nums">{hours(r.hours)}</span>
                ),
              },
              {
                key: "certificateFileId",
                label: "Certificate",
                render: (r) =>
                  r.certificateFileId ? (
                    canOpenFiles ? (
                      <CertificateFileButton fileId={r.certificateFileId} />
                    ) : (
                      "Attached"
                    )
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  ),
              },
            ]}
            actions={(r) => (
              <ConfirmButton
                title="Verify this training?"
                description={`${r.staffName}: ${r.title}, ${hours(r.hours)} on ${formatDate(r.completedOn)}.`}
                confirmLabel="Verify"
                onConfirm={() => verify.mutateAsync(r.id)}
              >
                <BadgeCheckIcon /> Verify
              </ConfirmButton>
            )}
          />
        </CardContent>
      </Card>
    </>
  );
}
