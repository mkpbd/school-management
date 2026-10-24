"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import {
  BudgetLinesEditor,
  emptyBudgetLine,
  toBudgetDrafts,
  toBudgetInputs,
  type BudgetLineDraft,
} from "@/components/acc/accounting-budget-lines";
import { RefLabel, RefSelect } from "@/components/crud/fields";
import { ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import { api } from "@/lib/api";
import type { BudgetDetail } from "@/lib/api/services/acc-accounting";
import { refs } from "@/lib/refs";

export default function NewBudgetPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewBudget />
    </Suspense>
  );
}

function NewBudget() {
  const revisionOf = useSearchParams().get("revisionOf") ?? "";
  const base = useQuery({
    queryKey: ["acc.budget", revisionOf],
    enabled: Boolean(revisionOf),
    queryFn: () => api.acc.budgets.get(revisionOf),
  });

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={
          <Link
            href={
              revisionOf
                ? `/dashboard/accounts/budgets/${revisionOf}`
                : "/dashboard/accounts/budgets"
            }
          />
        }
      >
        <ArrowLeftIcon /> {revisionOf ? "Approved budget" : "Budgets"}
      </Button>
      <PageHeader
        title={revisionOf ? "Revise budget" : "New budget"}
        description={
          revisionOf
            ? "A revision starts from the approved budget's lines. Once it is approved it supersedes the approved budget."
            : "Annual budget of a campus for an academic year. Months are calendar months; an annual amount is spread evenly (the remainder in December)."
        }
      />
      {!revisionOf ? (
        <BudgetForm />
      ) : base.isPending ? (
        <Loading />
      ) : base.isError ? (
        <ErrorAlert error={base.error} />
      ) : base.data.data.status !== "approved" ? (
        <ErrorAlert
          error={new Error("Only the approved budget can be revised.")}
        />
      ) : (
        <BudgetForm base={base.data.data} />
      )}
    </>
  );
}

function BudgetForm({ base }: { base?: BudgetDetail }) {
  const router = useRouter();
  const [name, setName] = useState(base ? `${base.name} (revision)` : "");
  const [academicYearId, setAcademicYearId] = useState(
    base?.academicYearId ?? "",
  );
  const [campusId, setCampusId] = useState(base?.campusId ?? "");
  const [lines, setLines] = useState<BudgetLineDraft[]>(() =>
    base ? toBudgetDrafts(base.lines) : [emptyBudgetLine()],
  );
  const [error, setError] = useState<string | null>(null);

  const create = useAction(
    (body: Parameters<typeof api.acc.budgets.create>[0]) =>
      api.acc.budgets.create(body),
    {
      success: base ? "Revision created" : "Budget created",
      invalidate: [["acc.budgets"]],
      toastError: false,
      onSuccess: (r) => router.push(`/dashboard/accounts/budgets/${r.data.id}`),
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const out = toBudgetInputs(lines);
    if (out.error !== undefined) return setError(out.error);
    create.mutate(
      {
        name: name.trim(),
        academicYearId,
        ...(campusId ? { campusId } : {}),
        ...(base ? { revisionOfId: base.id } : {}),
        lines: out.lines,
      },
      {
        onError: (err) =>
          setError(
            err instanceof Error ? err.message : "Something went wrong.",
          ),
      },
    );
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardContent className="space-y-4">
          {error && (
            <div role="alert" className="alert alert-error alert-soft text-sm">
              {error}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="b-name">
                Name<span className="text-destructive">*</span>
              </Label>
              <Input
                id="b-name"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Academic year<span className="text-destructive">*</span>
              </Label>
              {base ? (
                <div className="pt-1 text-sm">
                  <RefLabel source={refs.academicYears} id={academicYearId} />
                </div>
              ) : (
                <RefSelect
                  source={refs.academicYears}
                  value={academicYearId}
                  required
                  onChange={setAcademicYearId}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Campus</Label>
              {base ? (
                <div className="pt-1 text-sm">
                  <RefLabel source={refs.campuses} id={campusId} />
                </div>
              ) : (
                <RefSelect
                  source={refs.campuses}
                  value={campusId}
                  placeholder="Active campus"
                  onChange={setCampusId}
                />
              )}
            </div>
          </div>
          <BudgetLinesEditor lines={lines} onChange={setLines} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  href={
                    base
                      ? `/dashboard/accounts/budgets/${base.id}`
                      : "/dashboard/accounts/budgets"
                  }
                />
              }
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && (
                <span className="loading loading-spinner loading-xs" />
              )}
              {base ? "Create revision" : "Create budget"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
