"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, CheckCircleIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel } from "@/components/crud/fields";
import {
  ConfirmButton,
  DetailList,
  ErrorAlert,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { StructureLine } from "@/lib/api/services/fee";
import { humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function FeeStructurePage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const structure = useQuery({
    queryKey: ["fee.structures", "get", id],
    queryFn: async () => (await api.fee.structures.get(id)).data,
  });
  const activate = useAction(() => api.fee.structures.activate(id), {
    success: "Fee structure activated",
    invalidate: [["fee.structures"]],
  });

  if (structure.isPending) return <Loading />;
  if (structure.isError) return <ErrorAlert error={structure.error} />;
  const s = structure.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={s.name}
        description={`Version ${s.version}`}
        actions={
          <>
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/dashboard/fees/structures" />}
            >
              <ArrowLeftIcon /> All structures
            </Button>
            {s.status === "draft" && can(me, "fee.structure.approve") && (
              <ConfirmButton
                variant="default"
                size="default"
                title="Activate this fee structure?"
                description="Billing runs will use it from now on. The current active structure for the same campus, year and year group is retired."
                confirmLabel="Activate"
                onConfirm={() => activate.mutateAsync(undefined)}
              >
                <CheckCircleIcon /> Activate
              </ConfirmButton>
            )}
          </>
        }
      />
      <Card>
        <CardContent>
          <DetailList
            items={[
              ["Status", <StatusBadge key="s" status={s.status} />],
              [
                "Campus",
                <RefLabel key="c" source={refs.campuses} id={s.campusId} />,
              ],
              [
                "Academic year",
                <RefLabel
                  key="y"
                  source={refs.academicYears}
                  id={s.academicYearId}
                />,
              ],
              [
                "Year group",
                <RefLabel
                  key="g"
                  source={refs.yearGroups}
                  id={s.yearGroupId}
                />,
              ],
              ["Lines", s.lines.length],
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<StructureLine>
            rows={s.lines}
            empty="No lines."
            columns={[
              { key: "headCode", label: "Code", type: "mono" },
              { key: "headName", label: "Fee head" },
              {
                key: "amountPaisa",
                label: "Amount",
                type: "money",
                className: "text-right",
              },
              {
                key: "billingMonths",
                label: "Billing months",
                render: (l) =>
                  l.billingMonths?.length
                    ? l.billingMonths.join(", ")
                    : "Every month",
              },
              { key: "dueDay", label: "Due day" },
              {
                key: "appliesTo",
                label: "Applies to",
                render: (l) => humanize(l.appliesTo ?? "all"),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
