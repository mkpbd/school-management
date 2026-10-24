"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ChartColumnIcon,
  CheckIcon,
  CopyPlusIcon,
  PencilIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { BudgetStatusBadge, Money, MONTHS } from "@/components/acc/accounting";
import {
  BudgetLinesEditor,
  toBudgetDrafts,
  toBudgetInputs,
  type BudgetLineDraft,
} from "@/components/acc/accounting-budget-lines";
import { RefLabel } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import {
  ConfirmButton,
  DetailList,
  Empty,
  ErrorAlert,
  Loading,
  PageHeader,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { BudgetDetail } from "@/lib/api/services/acc-accounting";
import { formatDateTime, formatMoney } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function BudgetPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const [editing, setEditing] = useState<BudgetLineDraft[] | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(
    null,
  );

  const budget = useQuery({
    queryKey: ["acc.budget", id],
    queryFn: () => api.acc.budgets.get(id),
  });
  const invalidate = [["acc.budget"], ["acc.budgets"], ["acc.budgetVsActual"]];

  const saveLines = useAction(
    (lines: Parameters<typeof api.acc.budgets.setLines>[1]["lines"]) =>
      api.acc.budgets.setLines(id, { lines }),
    {
      success: (r) => `Budget lines saved (${r.data.lines} month amounts)`,
      invalidate,
      toastError: false,
      onSuccess: () => setEditing(null),
    },
  );
  const submit = useAction(() => api.acc.budgets.submit(id), {
    success: "Submitted for approval",
    invalidate,
  });
  const decide = useAction(
    (body: { decision: "approved" | "rejected"; note?: string }) =>
      api.acc.budgets.decide(id, body),
    { invalidate, toastError: false },
  );

  if (budget.isPending) return <Loading />;
  if (budget.isError) return <ErrorAlert error={budget.error} />;

  const b = budget.data.data;
  const canCreate = can(me, "acc.budget.create");
  const canApprove = can(me, "acc.budget.approve");
  const isSubmitter = Boolean(me && b.submittedBy && b.submittedBy === me.id);
  const editable =
    canCreate && (b.status === "draft" || b.status === "rejected");

  function save() {
    setEditError(null);
    const out = toBudgetInputs(editing ?? []);
    if (out.error !== undefined) return setEditError(out.error);
    saveLines.mutate(out.lines, {
      onError: (err) =>
        setEditError(
          err instanceof Error ? err.message : "Something went wrong.",
        ),
    });
  }

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href="/dashboard/accounts/budgets" />}
      >
        <ArrowLeftIcon /> Budgets
      </Button>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {b.name} <BudgetStatusBadge status={b.status} />
          </span>
        }
        description={
          <>
            <RefLabel source={refs.academicYears} id={b.academicYearId} /> ·{" "}
            <RefLabel source={refs.campuses} id={b.campusId} />
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link href={`/dashboard/accounts/budgets/${b.id}/vs-actual`} />
              }
            >
              <ChartColumnIcon /> Budget vs actual
            </Button>
            {editable && !editing && (
              <Button
                variant="outline"
                onClick={() => {
                  setEditError(null);
                  setEditing(toBudgetDrafts(b.lines));
                }}
              >
                <PencilIcon /> Edit lines
              </Button>
            )}
            {b.status === "draft" && canCreate && !editing && (
              <ConfirmButton
                variant="default"
                size="default"
                title="Submit for approval?"
                description="Lines cannot be changed while it is submitted. Someone other than you must approve it."
                confirmLabel="Submit"
                onConfirm={() => submit.mutateAsync(undefined)}
              >
                <SendIcon /> Submit
              </ConfirmButton>
            )}
            {b.status === "submitted" && canApprove && (
              <>
                <Button
                  disabled={isSubmitter}
                  onClick={() => setDecision("approved")}
                >
                  <CheckIcon /> Approve
                </Button>
                <Button
                  variant="outline"
                  disabled={isSubmitter}
                  onClick={() => setDecision("rejected")}
                >
                  <XIcon /> Reject
                </Button>
              </>
            )}
            {b.status === "approved" && canCreate && (
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    href={`/dashboard/accounts/budgets/new?revisionOf=${b.id}`}
                  />
                }
              >
                <CopyPlusIcon /> Revise
              </Button>
            )}
          </>
        }
      />

      {b.status === "submitted" && canApprove && isSubmitter && (
        <div role="alert" className="alert alert-info alert-soft mb-4 text-sm">
          You submitted this budget, so someone else must approve or reject it.
        </div>
      )}
      {b.status === "rejected" && (
        <div
          role="alert"
          className="alert alert-warning alert-soft mb-4 block text-sm"
        >
          <p className="font-medium">
            Rejected{b.decisionNote ? `: ${b.decisionNote}` : ""}
          </p>
          {editable && (
            <p>Edit the lines (it goes back to draft) and submit again.</p>
          )}
        </div>
      )}

      <Card className="mb-4">
        <CardContent>
          <DetailList
            items={[
              [
                "Annual total",
                <span key="t" className="font-medium">
                  {formatMoney(b.totalPaisa)}
                </span>,
              ],
              ["Lines", String(b.lines.length)],
              [
                "Revision of",
                b.revisionOfId ? (
                  <Link
                    className="link"
                    href={`/dashboard/accounts/budgets/${b.revisionOfId}`}
                  >
                    Previous budget
                  </Link>
                ) : (
                  "—"
                ),
              ],
              ["Submitted", formatDateTime(b.submittedAt)],
              ["Decided", formatDateTime(b.decidedAt)],
              ["Decision note", b.decisionNote ?? "—"],
            ]}
          />
        </CardContent>
      </Card>

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit lines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {editError && (
              <div
                role="alert"
                className="alert alert-error alert-soft text-sm"
              >
                {editError}
              </div>
            )}
            <BudgetLinesEditor lines={editing} onChange={setEditing} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button disabled={saveLines.isPending} onClick={save}>
                {saveLines.isPending && (
                  <span className="loading loading-spinner loading-xs" />
                )}
                Save lines
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <LinesTable budget={b} />
      )}

      <FormDialog
        open={decision !== null}
        onOpenChange={(open) => !open && setDecision(null)}
        title={
          decision === "approved" ? `Approve ${b.name}?` : `Reject ${b.name}?`
        }
        description={
          decision === "approved"
            ? b.revisionOfId
              ? "This revision becomes the approved budget; the current one is superseded."
              : "It becomes the approved budget of the year; spending is checked against it."
            : "The submitter can edit the lines and submit again."
        }
        submitLabel={decision === "approved" ? "Approve" : "Reject"}
        successMessage={
          decision === "approved" ? "Budget approved" : "Budget rejected"
        }
        fields={[
          {
            name: "note",
            label: "Note",
            type: "textarea",
            required: decision === "rejected",
            help: "Up to 500 characters",
          },
        ]}
        onSubmit={(body) =>
          decide.mutateAsync({
            decision: decision!,
            ...(body as { note?: string }),
          })
        }
      />
    </>
  );
}

function LinesTable({ budget }: { budget: BudgetDetail }) {
  const monthTotals = MONTHS.map((_, i) =>
    budget.lines.reduce((s, l) => s + (l.months[i] ?? 0), 0),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Lines per account × cost centre</CardTitle>
      </CardHeader>
      <CardContent>
        {budget.lines.length === 0 ? (
          <Empty>No lines yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Cost centre</TableHead>
                  {MONTHS.map((m) => (
                    <TableHead key={m} className="text-right">
                      {m}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Year</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budget.lines.map((l) => (
                  <TableRow key={`${l.accountId}|${l.costCentreId ?? ""}`}>
                    <TableCell className="whitespace-nowrap">
                      <span className="font-mono text-xs">{l.accountCode}</span>{" "}
                      {l.accountName}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {l.costCentreCode ?? "—"}
                    </TableCell>
                    {l.months.map((m, i) => (
                      <TableCell key={i} className="text-right text-xs">
                        <Money paisa={m} blankZero />
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-medium">
                      <Money paisa={l.annualPaisa} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>Total</TableCell>
                  {monthTotals.map((t, i) => (
                    <TableCell key={i} className="text-right text-xs">
                      <Money paisa={t} blankZero />
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    <Money paisa={budget.totalPaisa} />
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
