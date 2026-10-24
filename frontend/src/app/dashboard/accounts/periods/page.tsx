"use client";

import { useQuery } from "@tanstack/react-query";
import { LockIcon, LockOpenIcon, ShieldAlertIcon } from "lucide-react";
import { PeriodStatusBadge, periodLabel } from "@/components/acc/accounting";
import { DataTable } from "@/components/crud/data-table";
import { ConfirmButton, PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type {
  PeriodRow,
  PeriodStatus,
} from "@/lib/api/services/acc-accounting";
import { formatDate, humanize } from "@/lib/format";

const ACTIONS: Array<{
  status: PeriodStatus;
  label: string;
  icon: typeof LockIcon;
  description: string;
}> = [
  {
    status: "soft_locked",
    label: "Soft-lock",
    icon: ShieldAlertIcon,
    description:
      "Signals the month is being closed. Postings are still accepted until it is locked.",
  },
  {
    status: "locked",
    label: "Lock",
    icon: LockIcon,
    description:
      "No journal (manual, automatic or reversal) can be posted into a locked period until it is reopened.",
  },
  {
    status: "open",
    label: "Reopen",
    icon: LockOpenIcon,
    description: "Postings into this month are accepted again.",
  },
];

export default function FiscalPeriodsPage() {
  const { data: me } = useMe();
  const periods = useQuery({
    queryKey: ["acc.periods"],
    queryFn: () => api.acc.periods.list(),
  });
  const setStatus = useAction(
    ({ code, status }: { code: string; status: PeriodStatus }) =>
      api.acc.periods.setStatus(code, { status }),
    {
      success: (r) =>
        `${periodLabel(r.data.code)} is now ${humanize(r.data.status).toLowerCase()}`,
      invalidate: [["acc.periods"]],
    },
  );
  const canChange = can(me, "acc.journal.approve");
  const rows = [...(periods.data?.data ?? [])].sort((a, b) =>
    b.code.localeCompare(a.code),
  );

  return (
    <>
      <PageHeader
        title="Fiscal periods"
        description="One period per month, created on its first posting. Soft-lock while closing the month, lock when it is final; a locked period refuses every posting."
      />
      <Card>
        <CardContent>
          <DataTable<PeriodRow>
            rows={periods.data ? rows : undefined}
            isPending={periods.isPending}
            error={periods.error}
            empty="No fiscal periods yet. A period is created with the first journal of a month."
            columns={[
              {
                key: "code",
                label: "Period",
                render: (p) => (
                  <span className="font-medium">{periodLabel(p.code)}</span>
                ),
              },
              {
                key: "startsOn",
                label: "From",
                render: (p) => formatDate(p.startsOn),
              },
              {
                key: "endsOn",
                label: "To",
                render: (p) => formatDate(p.endsOn),
              },
              {
                key: "status",
                label: "Status",
                render: (p) => <PeriodStatusBadge status={p.status} />,
              },
            ]}
            actions={
              canChange
                ? (p) =>
                    ACTIONS.filter((a) => a.status !== p.status).map((a) => (
                      <ConfirmButton
                        key={a.status}
                        variant="ghost"
                        size="xs"
                        destructive={a.status === "locked"}
                        title={`${a.label} ${periodLabel(p.code)}?`}
                        description={a.description}
                        confirmLabel={a.label}
                        onConfirm={() =>
                          setStatus.mutateAsync({
                            code: p.code,
                            status: a.status,
                          })
                        }
                      >
                        <a.icon /> {a.label}
                      </ConfirmButton>
                    ))
                : undefined
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
