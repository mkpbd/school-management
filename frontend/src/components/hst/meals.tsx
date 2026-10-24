"use client";

import { useQuery } from "@tanstack/react-query";
import { UndoIcon, UtensilsCrossedIcon } from "lucide-react";
import { useState } from "react";
import { Empty, ErrorAlert, Loading } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { api } from "@/lib/api";
import type { Meal, MenuEntry } from "@/lib/api/services/hst";
import { formatDate, humanize, todayISO } from "@/lib/format";
import { addDays, DAYS, dayOfWeek, MEALS } from "./shared";

const DAYS_AHEAD = 8; // today + the next 7 days (what GET /students/:id/meals returns)

/** Menu text of a day and meal (English, Bangla below). */
export function MenuText({ entry }: { entry: MenuEntry | undefined }) {
  if (!entry) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="block">
      {entry.items}
      {entry.itemsBn && (
        <span className="block text-xs text-muted-foreground">
          {entry.itemsBn}
        </span>
      )}
    </span>
  );
}

/**
 * The resident's meals for the next days: the menu, meals already skipped (take back) and a dates × meals grid to
 * skip more. Residents and guardians can change a meal until the cutoff before it; the warden until it is served.
 */
export function StudentMealsPanel({ studentId }: { studentId: string }) {
  const meals = useQuery({
    queryKey: ["hst.studentMeals", studentId],
    queryFn: async () => (await api.hst.mess.studentMeals(studentId)).data,
    retry: false,
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const optOut = useAction(
    () =>
      api.hst.mess.optOut(studentId, {
        entries: [...picked].map((k) => {
          const [date, meal] = k.split("|") as [string, Meal];
          return { date, meal };
        }),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    {
      success: (r) =>
        `${r.data.added} meal${r.data.added === 1 ? "" : "s"} skipped`,
      invalidate: [["hst.studentMeals", studentId], ["hst.meals"]],
      onSuccess: () => {
        setPicked(new Set());
        setReason("");
      },
    },
  );
  const takeBack = useAction(
    ({ date, meal }: { date: string; meal: Meal }) =>
      api.hst.mess.cancelOptOut(studentId, date, meal),
    {
      success: "Meal taken back",
      invalidate: [["hst.studentMeals", studentId], ["hst.meals"]],
    },
  );

  if (meals.isPending) return <Loading />;
  if (meals.isError) return <ErrorAlert error={meals.error} />;
  const data = meals.data;
  if (!data.hostelId) return <Empty>Not living in a hostel.</Empty>;

  const today = todayISO();
  const dates = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));
  const skipped = new Set(data.optOuts.map((o) => `${o.date}|${o.meal}`));
  const menu = (date: string, meal: Meal) =>
    data.menu.find((m) => m.dayOfWeek === dayOfWeek(date) && m.meal === meal);
  const toggle = (key: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UtensilsCrossedIcon className="size-4" /> Meals
        </CardTitle>
        <CardDescription>
          Meal plan: {humanize(data.mealPlan)}.{" "}
          {data.mealPlan === "full"
            ? "Tick the meals to skip (home visit, outing, fasting); changes close a few hours before each meal."
            : "Without the meal plan there are no mess meals to skip."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                {MEALS.map((m) => (
                  <TableHead key={m}>{humanize(m)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {dates.map((date) => (
                <TableRow key={date}>
                  <TableCell className="whitespace-nowrap">
                    <div className="font-medium">{DAYS[dayOfWeek(date)]}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(date)}
                    </div>
                  </TableCell>
                  {MEALS.map((meal) => {
                    const key = `${date}|${meal}`;
                    const isSkipped = skipped.has(key);
                    return (
                      <TableCell
                        key={meal}
                        className={`min-w-36 align-top ${isSkipped ? "bg-warning/10" : ""}`}
                      >
                        <div className="text-xs">
                          <MenuText entry={menu(date, meal)} />
                        </div>
                        {data.mealPlan === "full" && (
                          <div className="mt-1">
                            {isSkipped ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="badge badge-warning badge-soft badge-sm">
                                  Skipped
                                </span>
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  disabled={takeBack.isPending}
                                  onClick={() =>
                                    takeBack.mutate({ date, meal })
                                  }
                                >
                                  <UndoIcon /> Take back
                                </Button>
                              </span>
                            ) : (
                              <label className="flex items-center gap-1.5 text-xs">
                                <input
                                  type="checkbox"
                                  className="checkbox checkbox-xs"
                                  checked={picked.has(key)}
                                  onChange={() => toggle(key)}
                                />
                                Skip
                              </label>
                            )}
                          </div>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {data.mealPlan === "full" && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              className="sm:w-80"
              placeholder="Reason (optional)"
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              disabled={picked.size === 0 || optOut.isPending}
              onClick={() => optOut.mutate(undefined)}
            >
              {optOut.isPending && (
                <span className="loading loading-spinner loading-xs" />
              )}
              Skip {picked.size} meal{picked.size === 1 ? "" : "s"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
