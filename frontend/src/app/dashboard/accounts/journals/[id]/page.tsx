"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, BookOpenIcon, Undo2Icon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Money } from "@/components/acc/accounting";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { DetailList, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { JournalLine } from "@/lib/api/services/acc-accounting";
import { formatDate, formatMoney, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function JournalPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: me } = useMe();
  const [reversing, setReversing] = useState(false);

  const journal = useQuery({
    queryKey: ["acc.journal", id],
    queryFn: () => api.acc.journals.get(id),
  });
  const reverse = useAction(
    (body: { reason: string; date?: string }) =>
      api.acc.journals.reverse(id, body),
    {
      invalidate: [
        ["acc.journal"],
        ["acc.journals"],
        ["acc.trialBalance"],
        ["acc.ledger"],
      ],
      toastError: false,
      onSuccess: (r) =>
        router.push(`/dashboard/accounts/journals/${r.data.id}`),
    },
  );

  if (journal.isPending) return <Loading />;
  if (journal.isError) return <ErrorAlert error={journal.error} />;

  const j = journal.data.data;
  const lines = j.lines ?? [];
  const debit = lines.reduce((s, l) => s + l.debitPaisa, 0);
  const credit = lines.reduce((s, l) => s + l.creditPaisa, 0);
  const canReverse =
    can(me, "acc.journal.approve") && !j.reversalOfId && !j.reversedById;

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href="/dashboard/accounts/journals" />}
      >
        <ArrowLeftIcon /> Journals
      </Button>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{j.journalNo}</span>
            <span className="badge badge-soft badge-sm badge-ghost">
              {humanize(j.voucherType)}
            </span>
            {j.reversedById && (
              <span className="badge badge-soft badge-sm badge-error">
                Reversed
              </span>
            )}
            {j.reversalOfId && (
              <span className="badge badge-soft badge-sm badge-info">
                Reversal
              </span>
            )}
          </span>
        }
        description={j.narration}
        actions={
          canReverse && (
            <Button variant="outline" onClick={() => setReversing(true)}>
              <Undo2Icon /> Reverse
            </Button>
          )
        }
      />

      <Card className="mb-4">
        <CardContent>
          <DetailList
            items={[
              ["Date", formatDate(j.journalDate)],
              [
                "Campus",
                <RefLabel key="c" source={refs.campuses} id={j.campusId} />,
              ],
              ["Amount", formatMoney(j.totalPaisa)],
              [
                "Source",
                j.sourceModule
                  ? `${j.sourceModule} · ${humanize(j.sourceType)}`
                  : "Manual voucher",
              ],
              [
                "Reversal of",
                j.reversalOfId ? (
                  <Link
                    className="link"
                    href={`/dashboard/accounts/journals/${j.reversalOfId}`}
                  >
                    Original journal
                  </Link>
                ) : (
                  "—"
                ),
              ],
              [
                "Reversed by",
                j.reversedById ? (
                  <Link
                    className="link"
                    href={`/dashboard/accounts/journals/${j.reversedById}`}
                  >
                    Reversing journal
                  </Link>
                ) : (
                  "—"
                ),
              ],
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable<JournalLine>
            rows={lines}
            rowKey={(l, i) => `${l.accountId}-${i}`}
            empty="No lines."
            columns={[
              {
                key: "accountCode",
                label: "Code",
                render: (l) => (
                  <span className="font-mono text-xs">{l.accountCode}</span>
                ),
              },
              { key: "accountName", label: "Account" },
              {
                key: "memo",
                label: "Memo",
                render: (l) =>
                  l.memo ?? <span className="text-muted-foreground">—</span>,
              },
              {
                key: "party",
                label: "Party",
                render: (l) =>
                  l.partyType ? (
                    humanize(l.partyType)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              {
                key: "debitPaisa",
                label: "Debit",
                className: "text-right",
                render: (l) => <Money paisa={l.debitPaisa} blankZero />,
              },
              {
                key: "creditPaisa",
                label: "Credit",
                className: "text-right",
                render: (l) => <Money paisa={l.creditPaisa} blankZero />,
              },
              {
                key: "ledger",
                label: "",
                className: "text-right",
                render: (l) => (
                  <Button
                    nativeButton={false}
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Ledger"
                    render={
                      <Link
                        href={`/dashboard/accounts/ledger?accountId=${l.accountId}`}
                      />
                    }
                  >
                    <BookOpenIcon />
                  </Button>
                ),
              },
            ]}
          />
          <div className="flex justify-end gap-6 border-t pt-3 text-sm font-medium">
            <span>
              Debit <span className="tabular-nums">{formatMoney(debit)}</span>
            </span>
            <span>
              Credit <span className="tabular-nums">{formatMoney(credit)}</span>
            </span>
          </div>
        </CardContent>
      </Card>

      <FormDialog
        open={reversing}
        onOpenChange={setReversing}
        title={`Reverse ${j.journalNo}?`}
        description="Posts a new journal with every debit and credit swapped. The original stays as it is. A reversal cannot itself be reversed."
        submitLabel="Post reversal"
        successMessage="Reversal posted"
        fields={[
          {
            name: "reason",
            label: "Reason",
            type: "textarea",
            required: true,
            help: "3–200 characters; added to the narration",
          },
          {
            name: "date",
            label: "Reversal date",
            type: "date",
            help: "Default: today (its period must not be locked)",
          },
        ]}
        onSubmit={(body) =>
          reverse.mutateAsync(body as { reason: string; date?: string })
        }
      />
    </>
  );
}
