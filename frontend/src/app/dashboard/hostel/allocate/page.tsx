"use client";

import { BedDoubleIcon } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  AllocateFields,
  emptyAllocation,
  useAllocate,
  type AllocateDraft,
} from "@/components/hst/dialogs";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate, formatMoney, humanize } from "@/lib/format";
import type { AllocationRow } from "@/lib/api/services/hst";

export default function AllocatePage() {
  const [draft, setDraft] = useState<AllocateDraft>(() => emptyAllocation());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    allocation: AllocationRow;
    name: string;
  } | null>(null);
  const allocate = useAllocate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { data } = await allocate.mutateAsync(draft);
      setDone({ allocation: data, name: draft.student?.fullNameEn ?? "" });
      // keep hostel, date and meal plan for the next student
      setDraft((d) => ({ ...d, student: null, bedId: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <>
      <PageHeader
        title="Allocate bed"
        description="Give a student a bed from a date. Rent (room rate) and, with the full meal plan, the meal fee are added to the student's monthly invoice."
        actions={
          draft.hostelId && (
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  href={`/dashboard/hostel/occupancy?hostelId=${draft.hostelId}&date=${draft.validFrom}`}
                />
              }
            >
              <BedDoubleIcon /> Occupancy map
            </Button>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="alert alert-error alert-soft text-sm"
                >
                  {error}
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <AllocateFields value={draft} onChange={setDraft} />
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={
                    allocate.isPending || !draft.student || !draft.bedId
                  }
                >
                  {allocate.isPending && (
                    <span className="loading loading-spinner loading-xs" />
                  )}
                  Allocate
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
        {done && (
          <Card>
            <CardHeader>
              <CardTitle>Allocated</CardTitle>
              <CardDescription>{done.name}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div>From {formatDate(done.allocation.validFrom)}</div>
              <div>
                Rent {formatMoney(done.allocation.monthlyFeePaisa)} / month
              </div>
              <div>
                Meal plan {humanize(done.allocation.mealPlan)}
                {done.allocation.mealFeePaisa > 0 &&
                  ` · ${formatMoney(done.allocation.mealFeePaisa)} / month`}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                nativeButton={false}
                render={
                  <Link
                    href={`/dashboard/hostel/student?studentId=${done.allocation.studentId}`}
                  />
                }
              >
                Student hostel view
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
