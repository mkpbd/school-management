"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardCheckIcon, UtensilsIcon } from "lucide-react";
import { Suspense, useState } from "react";
import { FormDialog } from "@/components/crud/form-dialog";
import { HostelSelect, useUrlState } from "@/components/hst/shared";
import { MenuText } from "@/components/hst/meals";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Diet, Meal, MealHeadcount } from "@/lib/api/services/hst";
import { formatDate, humanize, todayISO } from "@/lib/format";

export default function KitchenPage() {
  return (
    <Suspense fallback={<Loading />}>
      <KitchenView />
    </Suspense>
  );
}

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function KitchenView() {
  const { data: me } = useMe();
  const [{ hostelId, date }, setUrl] = useUrlState({
    hostelId: "",
    date: todayISO(),
  });
  const [recording, setRecording] = useState<MealHeadcount | null>(null);
  const day = useQuery({
    queryKey: ["hst.meals", hostelId, date],
    queryFn: async () =>
      (await api.hst.mess.headcount(hostelId, { date })).data,
    enabled: Boolean(hostelId),
  });
  const record = useAction(
    (body: { date: string; meal: Meal; served: number; note?: string }) =>
      api.hst.mess.recordService(hostelId, body),
    { invalidate: [["hst.meals"], ["hst.messReport"]], toastError: false },
  );
  const canRecord = can(me, "hst.mess.create");
  // when the sheet was loaded (refetched on focus), so the button state does not change between renders
  const now = day.dataUpdatedAt;

  return (
    <>
      <PageHeader
        title="Kitchen headcount"
        description="Plates to cook per meal: residents on the meal plan, minus those away on an out-pass at meal time and those who skipped the meal."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <HostelSelect
              value={hostelId}
              onChange={(id) => setUrl({ hostelId: id })}
            />
            <Input
              type="date"
              aria-label="Date"
              className="sm:w-44"
              value={date}
              onChange={(e) =>
                e.target.value && setUrl({ date: e.target.value })
              }
            />
          </div>
          {!hostelId ? (
            <Empty>Choose a hostel.</Empty>
          ) : day.isPending ? (
            <Loading />
          ) : day.isError ? (
            <ErrorAlert error={day.error} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {day.data.meals.map((m) => {
                const menu = day.data.menu.find((e) => e.meal === m.meal);
                const diets = Object.entries(m.diets).filter(
                  ([d, n]) => d !== "regular" && n,
                ) as Array<[Diet, number]>;
                const diff = m.served === null ? null : m.served - m.expected;
                // the backend accepts servings from an hour before the meal
                const recordable = new Date(m.at).getTime() <= now + 3_600_000;
                return (
                  <Card key={m.meal} className="shadow-none">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <UtensilsIcon className="size-4" /> {humanize(m.meal)}
                      </CardTitle>
                      <CardDescription>
                        {timeFmt.format(new Date(m.at))} ·{" "}
                        {formatDate(day.data.date)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="text-xs">
                        <MenuText entry={menu} />
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-semibold tabular-nums">
                          {m.expected}
                        </span>
                        <span className="text-muted-foreground">
                          plates expected
                        </span>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <dt className="text-muted-foreground">Residents</dt>
                        <dd className="tabular-nums">{m.residents}</dd>
                        <dt className="text-muted-foreground">On meal plan</dt>
                        <dd className="tabular-nums">{m.onMealPlan}</dd>
                        <dt className="text-muted-foreground">
                          Away (out-pass)
                        </dt>
                        <dd className="tabular-nums">{m.away}</dd>
                        <dt className="text-muted-foreground">Opted out</dt>
                        <dd className="tabular-nums">{m.optedOut}</dd>
                      </dl>
                      <div className="flex flex-wrap gap-1">
                        {diets.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            All regular diet
                          </span>
                        ) : (
                          diets.map(([d, n]) => (
                            <span
                              key={d}
                              className="badge badge-info badge-soft badge-sm"
                            >
                              {humanize(d)}: {n}
                            </span>
                          ))
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 border-t pt-3">
                        {m.served === null ? (
                          <span className="text-xs text-muted-foreground">
                            Servings not recorded
                          </span>
                        ) : (
                          <span className="text-xs">
                            Served <b className="tabular-nums">{m.served}</b>{" "}
                            <span
                              className={
                                diff! > 0
                                  ? "text-warning"
                                  : diff! < 0
                                    ? "text-info"
                                    : "text-success"
                              }
                            >
                              ({diff! > 0 ? "+" : ""}
                              {diff})
                            </span>
                          </span>
                        )}
                        {canRecord && (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={!recordable}
                            onClick={() => setRecording(m)}
                          >
                            <ClipboardCheckIcon />{" "}
                            {m.served === null ? "Record served" : "Update"}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      <FormDialog
        open={recording !== null}
        onOpenChange={(o) => !o && setRecording(null)}
        title={`Served — ${humanize(recording?.meal)} ${formatDate(date)}`}
        description={
          recording
            ? `${recording.expected} plates were expected; the difference goes into the month report.`
            : undefined
        }
        submitLabel="Save"
        successMessage="Servings recorded"
        fields={[
          {
            name: "served",
            label: "Plates served",
            type: "number",
            required: true,
            defaultValue:
              recording?.served !== null && recording
                ? String(recording.served)
                : String(recording?.expected ?? ""),
          },
          {
            name: "note",
            label: "Note",
            type: "textarea",
            placeholder: "Guests, leftovers…",
          },
        ]}
        onSubmit={(body) =>
          record.mutateAsync({
            date,
            meal: recording!.meal,
            served: Number(body.served),
            ...(typeof body.note === "string" ? { note: body.note } : {}),
          })
        }
      />
    </>
  );
}
