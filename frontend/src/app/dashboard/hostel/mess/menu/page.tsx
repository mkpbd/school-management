"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, SaveIcon } from "lucide-react";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import {
  HostelSelect,
  DAYS,
  MEALS,
  useUrlState,
} from "@/components/hst/shared";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Meal, MenuEntry } from "@/lib/api/services/hst";
import { humanize } from "@/lib/format";

export default function MessMenuPage() {
  return (
    <Suspense fallback={<Loading />}>
      <MenuView />
    </Suspense>
  );
}

function MenuView() {
  const [{ hostelId }, setUrl] = useUrlState({ hostelId: "" });
  const menu = useQuery({
    queryKey: ["hst.menu", hostelId],
    queryFn: async () => (await api.hst.mess.menu(hostelId)).data,
    enabled: Boolean(hostelId),
  });
  return (
    <>
      <PageHeader
        title="Mess menu"
        description="Weekly menu per day and meal in English and Bangla. Guardians and residents see it with their meals."
      />
      <Card>
        <CardContent className="space-y-4">
          <HostelSelect
            value={hostelId}
            onChange={(id) => setUrl({ hostelId: id })}
          />
          {!hostelId ? (
            <Empty>Choose a hostel.</Empty>
          ) : menu.isPending ? (
            <Loading />
          ) : menu.isError ? (
            <ErrorAlert error={menu.error} />
          ) : (
            <MenuEditor
              key={`${hostelId}:${menu.dataUpdatedAt}`}
              hostelId={hostelId}
              menu={menu.data.menu}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

type Cell = { items: string; itemsBn: string };
const key = (day: number, meal: Meal) => `${day}|${meal}`;

function MenuEditor({
  hostelId,
  menu,
}: {
  hostelId: string;
  menu: MenuEntry[];
}) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const canEdit = can(me, "hst.mess.create");
  const [cells, setCells] = useState<Record<string, Cell>>(() =>
    Object.fromEntries(
      menu.map((m) => [
        key(m.dayOfWeek, m.meal),
        { items: m.items, itemsBn: m.itemsBn ?? "" },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (k: string, patch: Partial<Cell>) =>
    setCells((c) => ({
      ...c,
      [k]: { ...(c[k] ?? { items: "", itemsBn: "" }), ...patch },
    }));

  /** Copy Sunday's menu to the empty cells of the other days. */
  function fillFromSunday() {
    setCells((c) => {
      const next = { ...c };
      for (let day = 1; day < 7; day++)
        for (const meal of MEALS) {
          const src = c[key(0, meal)];
          if (src?.items.trim() && !next[key(day, meal)]?.items.trim())
            next[key(day, meal)] = { ...src };
        }
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      const entries = Object.entries(cells)
        .filter(([, c]) => c.items.trim())
        .map(([k, c]) => {
          const [day, meal] = k.split("|") as [string, Meal];
          return {
            dayOfWeek: Number(day),
            meal,
            items: c.items.trim(),
            itemsBn: c.itemsBn.trim() || null,
          };
        });
      const missingEnglish = Object.values(cells).some(
        (c) => !c.items.trim() && c.itemsBn.trim(),
      );
      if (missingEnglish)
        throw new Error(
          "Each meal with a Bangla menu needs the English text too.",
        );
      const { data } = await api.hst.mess.setMenu(hostelId, { entries });
      toast.success(`Menu saved (${data.entries} meals)`);
      await queryClient.invalidateQueries({ queryKey: ["hst.menu", hostelId] });
    } catch (err) {
      setProblem(
        err instanceof Error ? err.message : "Could not save the menu.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {problem && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {problem}
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={fillFromSunday}>
            <CopyIcon /> Fill empty days from Sunday
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <SaveIcon />
            )}
            Save menu
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Day</TableHead>
              {MEALS.map((m) => (
                <TableHead key={m}>{humanize(m)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {DAYS.map((name, day) => (
              <TableRow key={day}>
                <TableCell className="align-top font-medium">{name}</TableCell>
                {MEALS.map((meal) => {
                  const k = key(day, meal);
                  const c = cells[k] ?? { items: "", itemsBn: "" };
                  return (
                    <TableCell
                      key={meal}
                      className="min-w-48 space-y-1 align-top"
                    >
                      <Textarea
                        rows={2}
                        maxLength={500}
                        disabled={!canEdit}
                        placeholder="Rice, dal, chicken curry"
                        aria-label={`${name} ${meal} (English)`}
                        value={c.items}
                        onChange={(e) => set(k, { items: e.target.value })}
                      />
                      <Input
                        lang="bn"
                        maxLength={500}
                        disabled={!canEdit}
                        placeholder="বাংলা"
                        aria-label={`${name} ${meal} (Bangla)`}
                        value={c.itemsBn}
                        onChange={(e) => set(k, { itemsBn: e.target.value })}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Saving replaces the whole weekly menu; empty cells are left out.
      </p>
    </div>
  );
}
