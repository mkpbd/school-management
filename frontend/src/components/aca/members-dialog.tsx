"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { RefLabel, RefSelect } from "@/components/crud/fields";
import { ErrorAlert, Loading } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import { api, isApiError, type Row } from "@/lib/api";
import { todayISO } from "@/lib/format";
import { refs } from "@/lib/refs";

interface CurrentMember {
  enrolmentId: string;
  joinedOn: string;
  rollNo: number | null;
  fullNameEn: string | null;
}

interface RosterEntry {
  enrolmentId: string;
  studentId: string;
  rollNo: number | null;
  fullNameEn: string;
  fullNameBn: string | null;
}

/**
 * Members of an elective (explicit) teaching group: pick students from the rosters of sections of the same
 * year group. Saving replaces the whole membership (leavers get left_on = the chosen date).
 */
export function MembersDialog({
  group,
  onClose,
}: {
  group: Row | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={group !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {group && <MembersForm group={group} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function MembersForm({ group, onClose }: { group: Row; onClose: () => void }) {
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [picking, setPicking] = useState("");
  // null until the user changes something: the current members are the starting selection
  const [touched, setTouched] = useState<Set<string> | null>(null);
  const [onDate, setOnDate] = useState(todayISO());

  const current = useQuery({
    queryKey: ["aca.groupMembers", String(group.id), onDate],
    queryFn: async () =>
      (
        await api.aca.teachingGroups.members<CurrentMember[]>(
          String(group.id),
          {
            onDate,
          },
        )
      ).data,
  });
  const selected =
    touched ?? new Set((current.data ?? []).map((m) => m.enrolmentId));
  const [error, setError] = useState<string | null>(null);

  const rosters = useQueries({
    queries: sectionIds.map((id) => ({
      queryKey: ["sis.roster", id, onDate],
      queryFn: async () =>
        (await api.sis.roster<RosterEntry[]>(id, { date: onDate })).data,
    })),
  });

  const save = useAction(
    () =>
      api.aca.teachingGroups.setMembers<{ members: number }>(String(group.id), {
        enrolmentIds: [...selected],
        onDate,
      }),
    {
      invalidate: [["aca.teachingGroups"], ["aca.groupMembers"]],
      toastError: false,
    },
  );

  function toggle(id: string, on: boolean) {
    setTouched((prev) => {
      const next = new Set(prev ?? selected);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function submit() {
    setError(null);
    try {
      const r = await save.mutateAsync(undefined);
      toast.success(`${r.data.members} member(s) saved`);
      onClose();
    } catch (err) {
      setError(isApiError(err) ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Members of {String(group.name)}</DialogTitle>
        <DialogDescription>
          Saving replaces the whole membership: unticked students leave the
          group on the chosen date.
        </DialogDescription>
      </DialogHeader>
      {error && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {error}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Add students from section</Label>
          <RefSelect
            source={refs.sections}
            value={picking}
            placeholder="Pick a section…"
            filter={(s) =>
              s.yearGroupId === group.yearGroupId &&
              s.academicYearId === group.academicYearId &&
              !sectionIds.includes(String(s.id))
            }
            onChange={(id) => {
              if (id) setSectionIds((prev) => [...prev, id]);
              setPicking("");
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="members-on">Effective on</Label>
          <Input
            id="members-on"
            type="date"
            value={onDate}
            onChange={(e) => setOnDate(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-lg border p-3">
        <div className="mb-2 text-sm font-medium">
          Current members on {onDate}
        </div>
        {current.isPending ? (
          <Loading />
        ) : current.isError ? (
          <ErrorAlert error={current.error} />
        ) : (current.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2">
            {(current.data ?? []).map((m) => (
              <label
                key={m.enrolmentId}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={selected.has(m.enrolmentId)}
                  onChange={(e) => toggle(m.enrolmentId, e.target.checked)}
                />
                <span className="w-6 text-right tabular-nums text-muted-foreground">
                  {m.rollNo ?? "–"}
                </span>
                {m.fullNameEn ?? m.enrolmentId.slice(0, 8)}
              </label>
            ))}
          </div>
        )}
      </div>

      {sectionIds.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Pick one or more sections to add more students.
        </p>
      )}
      {sectionIds.map((id, i) => {
        const q = rosters[i];
        const rows = q?.data ?? [];
        return (
          <div key={id} className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                <RefLabel source={refs.sections} id={id} />
              </span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    rows.forEach((r) => toggle(r.enrolmentId, true))
                  }
                >
                  All
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    setSectionIds((prev) => prev.filter((x) => x !== id))
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
            {q?.isPending ? (
              <Loading />
            ) : q?.isError ? (
              <ErrorAlert error={q.error} />
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No enrolled students on this date.
              </p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2">
                {rows.map((r) => (
                  <label
                    key={r.enrolmentId}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={selected.has(r.enrolmentId)}
                      onChange={(e) => toggle(r.enrolmentId, e.target.checked)}
                    />
                    <span className="w-6 text-right tabular-nums text-muted-foreground">
                      {r.rollNo ?? "–"}
                    </span>
                    {r.fullNameEn}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <DialogFooter>
        <span className="mr-auto self-center text-sm text-muted-foreground">
          {selected.size} selected
        </span>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={save.isPending} onClick={submit}>
          {save.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Save members
        </Button>
      </DialogFooter>
    </div>
  );
}
