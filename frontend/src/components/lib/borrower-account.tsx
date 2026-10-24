"use client";

import { RotateCwIcon, XIcon } from "lucide-react";
import { DataTable } from "@/components/crud/data-table";
import { ConfirmButton, DetailList, StatusBadge } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { api } from "@/lib/api";
import type { BorrowerAccount, LoanRow } from "@/lib/api/services/lib";
import { formatMoney, humanize } from "@/lib/format";

/** Reader account: summary, active loans (renew), open reservations (cancel), recent history. */
export function BorrowerAccountView({
  account,
  queryKey,
}: {
  account: BorrowerAccount;
  queryKey: unknown[];
}) {
  const renew = useAction((id: string) => api.lib.circulation.renew(id), {
    success: (r) => `Renewed — now due ${r.data.dueOn}`,
    invalidate: [queryKey, ["lib.loans"]],
  });
  const cancel = useAction((id: string) => api.lib.reservations.cancel(id), {
    success: "Reservation cancelled",
    invalidate: [queryKey, ["lib.reservations"]],
  });
  const { borrower, policy, totals } = account;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {borrower.name || "Reader"}
            <StatusBadge status={borrower.active ? "active" : "withdrawn"} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DetailList
            items={[
              ["Type", humanize(borrower.type)],
              ["Member type", humanize(borrower.memberType)],
              [
                "Loan limit",
                policy
                  ? `${policy.maxLoans} books × ${policy.loanDays} days`
                  : "—",
              ],
              ["Renewals", policy ? String(policy.maxRenewals) : "—"],
              [
                "Fine per day",
                policy ? formatMoney(policy.finePerDayPaisa) : "—",
              ],
            ]}
          />
          <div className="stats stats-vertical w-full border bg-card sm:stats-horizontal">
            <div className="stat">
              <div className="stat-title">On loan</div>
              <div className="stat-value text-2xl">{totals.active}</div>
            </div>
            <div className="stat">
              <div className="stat-title">Overdue</div>
              <div
                className={`stat-value text-2xl ${totals.overdue ? "text-error" : ""}`}
              >
                {totals.overdue}
              </div>
            </div>
            <div className="stat">
              <div className="stat-title">Fines (recent history)</div>
              <div className="stat-value text-2xl">
                {formatMoney(totals.finesPaisa)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>On loan</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<LoanRow>
            rows={account.activeLoans}
            empty="Nothing on loan."
            columns={[
              { key: "title", label: "Title" },
              { key: "accessionNo", label: "Accession", type: "mono" },
              { key: "issuedAt", label: "Issued", type: "datetime" },
              { key: "dueOn", label: "Due", type: "date" },
              {
                key: "overdueDays",
                label: "Late",
                render: (l) =>
                  l.overdueDays ? (
                    <span className="badge badge-error badge-soft badge-sm">
                      {l.overdueDays} days
                    </span>
                  ) : (
                    "—"
                  ),
              },
              { key: "renewCount", label: "Renewed" },
            ]}
            actions={(l) => (
              <Button
                variant="ghost"
                size="xs"
                disabled={renew.isPending}
                onClick={() => renew.mutate(l.id)}
              >
                <RotateCwIcon /> Renew
              </Button>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reservations</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={account.reservations}
            empty="No open reservations."
            columns={[
              { key: "title", label: "Title" },
              { key: "reservedAt", label: "Reserved", type: "datetime" },
              { key: "status", label: "Status", type: "status" },
              { key: "expiresAt", label: "Collect by", type: "datetime" },
            ]}
            actions={(r) => (
              <ConfirmButton
                variant="ghost"
                size="xs"
                destructive
                title="Cancel this reservation?"
                description="A held copy moves to the next reader."
                confirmLabel="Cancel reservation"
                onConfirm={() => cancel.mutateAsync(String(r.id))}
              >
                <XIcon /> Cancel
              </ConfirmButton>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent history</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<LoanRow>
            rows={account.history}
            empty="No returned loans yet."
            columns={[
              { key: "title", label: "Title" },
              { key: "issuedAt", label: "Issued", type: "datetime" },
              { key: "returnedAt", label: "Returned", type: "datetime" },
              { key: "returnCondition", label: "Condition", type: "enum" },
              { key: "finePaisa", label: "Fine", type: "money" },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
