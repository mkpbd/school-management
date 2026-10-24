"use client";

import { useQuery } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { FormDialog } from "@/components/crud/form-dialog";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { MemberPolicy } from "@/lib/api/services/lib";
import { humanize } from "@/lib/format";

export default function PoliciesPage() {
  const { data: me } = useMe();
  const [editing, setEditing] = useState<MemberPolicy | null>(null);
  const policies = useQuery({
    queryKey: ["lib.policies"],
    queryFn: () => api.lib.policies.list(),
  });
  const save = useAction(
    (p: MemberPolicy) =>
      api.lib.policies.set(p.memberType, {
        maxLoans: p.maxLoans,
        loanDays: p.loanDays,
        maxRenewals: p.maxRenewals,
        finePerDayPaisa: p.finePerDayPaisa,
      }),
    { invalidate: [["lib.policies"]], toastError: false },
  );

  return (
    <>
      <PageHeader
        title="Loan policies"
        description="Limits per member type. Students from the senior year group up are senior; teaching staff are teachers."
      />
      <Card>
        <CardContent>
          <DataTable<MemberPolicy>
            rows={policies.data?.data}
            isPending={policies.isPending}
            error={policies.error}
            rowKey={(p) => p.memberType}
            columns={[
              {
                key: "memberType",
                label: "Member type",
                render: (p) => (
                  <span className="font-medium">{humanize(p.memberType)}</span>
                ),
              },
              { key: "maxLoans", label: "Max books" },
              { key: "loanDays", label: "Loan days" },
              { key: "maxRenewals", label: "Renewals" },
              { key: "finePerDayPaisa", label: "Fine per day", type: "money" },
            ]}
            actions={
              can(me, "lib.policy.edit")
                ? (p) => (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit"
                      onClick={() => setEditing(p)}
                    >
                      <PencilIcon />
                    </Button>
                  )
                : undefined
            }
          />
        </CardContent>
      </Card>
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={`${humanize(editing?.memberType)} policy`}
        row={editing ?? undefined}
        fields={[
          {
            name: "maxLoans",
            label: "Max books on loan",
            type: "number",
            required: true,
            help: "0–50",
          },
          {
            name: "loanDays",
            label: "Loan days",
            type: "number",
            required: true,
            help: "1–365",
          },
          {
            name: "maxRenewals",
            label: "Max renewals",
            type: "number",
            required: true,
            help: "0–10",
          },
          {
            name: "finePerDayPaisa",
            label: "Fine per late day",
            type: "money",
            required: true,
          },
        ]}
        // PUT replaces the policy: merge the changed fields into the current one.
        onSubmit={(body) =>
          save.mutateAsync({ ...editing!, ...(body as Partial<MemberPolicy>) })
        }
      />
    </>
  );
}
