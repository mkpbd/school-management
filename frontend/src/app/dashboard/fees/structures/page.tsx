"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RefSelect } from "@/components/crud/fields";
import { ResourcePage } from "@/components/crud/resource-page";
import { ErrorAlert } from "@/components/page";
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
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { toPaisa } from "@/lib/format";
import { refs } from "@/lib/refs";

const STATUSES = ["draft", "active", "retired"] as const;
const APPLIES_TO = ["all", "new_admission", "continuing"] as const;

interface LineDraft {
  feeHeadId: string;
  amount: string;
  /** academic-year month numbers (1 = first month of the year); empty = every month */
  months: number[];
  dueDay: string;
  appliesTo: (typeof APPLIES_TO)[number];
}

const emptyLine = (): LineDraft => ({
  feeHeadId: "",
  amount: "",
  months: [],
  dueDay: "",
  appliesTo: "all",
});

export default function FeeStructuresPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <ResourcePage
        title="Fee structures"
        description="Per campus, academic year and year group. Activating a structure retires the previous active one."
        queryKey="fee.structures"
        entity="fee structure"
        resource={{ list: api.fee.structures.list }}
        onRowClick={(r) =>
          router.push(`/dashboard/fees/structures/${String(r.id)}`)
        }
        filters={[
          {
            name: "campusId",
            label: "Campuses",
            type: "ref",
            ref: refs.campuses,
          },
          {
            name: "academicYearId",
            label: "Years",
            type: "ref",
            ref: refs.academicYears,
          },
          {
            name: "yearGroupId",
            label: "Year groups",
            type: "ref",
            ref: refs.yearGroups,
          },
          {
            name: "status",
            label: "Statuses",
            type: "select",
            options: STATUSES,
          },
        ]}
        columns={[
          { key: "name", label: "Name" },
          { key: "campusId", label: "Campus", ref: refs.campuses },
          { key: "academicYearId", label: "Year", ref: refs.academicYears },
          { key: "yearGroupId", label: "Year group", ref: refs.yearGroups },
          { key: "version", label: "Version" },
          { key: "status", label: "Status", type: "status" },
        ]}
        actions={
          can(me, "fee.structure.create") && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New fee structure
            </Button>
          )
        }
      />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
          {creating && (
            <CreateStructureForm
              onClose={() => setCreating(false)}
              onCreated={(id) =>
                router.push(`/dashboard/fees/structures/${id}`)
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateStructureForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [campusId, setCampusId] = useState("");
  const [academicYearId, setAcademicYearId] = useState("");
  const [yearGroupId, setYearGroupId] = useState("");
  const [name, setName] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const create = useAction(
    () =>
      api.fee.structures.create({
        ...(campusId ? { campusId } : {}),
        academicYearId,
        yearGroupId,
        name: name.trim(),
        lines: lines.map((l) => ({
          feeHeadId: l.feeHeadId,
          amountPaisa: toPaisa(l.amount),
          billingMonths: l.months.length
            ? [...l.months].sort((a, b) => a - b)
            : null,
          ...(l.dueDay ? { dueDay: Number(l.dueDay) } : {}),
          appliesTo: l.appliesTo,
        })),
      }),
    {
      success: "Draft fee structure created",
      invalidate: [["fee.structures"]],
      toastError: false,
      onSuccess: (r) => onCreated(r.data.id),
    },
  );

  const update = (i: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(undefined);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>New fee structure</DialogTitle>
        <DialogDescription>
          Created as a draft; activate it from its page.
        </DialogDescription>
      </DialogHeader>
      {create.error && <ErrorAlert error={create.error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Campus</Label>
          <RefSelect
            source={refs.campuses}
            value={campusId}
            onChange={setCampusId}
            placeholder="Active campus"
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            Academic year<span className="text-destructive">*</span>
          </Label>
          <RefSelect
            source={refs.academicYears}
            value={academicYearId}
            onChange={setAcademicYearId}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            Year group<span className="text-destructive">*</span>
          </Label>
          <RefSelect
            source={refs.yearGroups}
            value={yearGroupId}
            onChange={setYearGroupId}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="structure-name">
            Name<span className="text-destructive">*</span>
          </Label>
          <Input
            id="structure-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Lines</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines((p) => [...p, emptyLine()])}
          >
            <PlusIcon /> Add line
          </Button>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="space-y-3 rounded-lg border p-3">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label>Fee head</Label>
                <RefSelect
                  source={refs.feeHeads}
                  value={l.feeHeadId}
                  onChange={(v) => update(i, { feeHeadId: v })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Amount (৳)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={l.amount}
                  onChange={(e) => update(i, { amount: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Due day</Label>
                <Input
                  type="number"
                  min="1"
                  max="28"
                  placeholder="Default"
                  value={l.dueDay}
                  onChange={(e) => update(i, { dueDay: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Applies to</Label>
                <select
                  className="select select-sm h-8 w-full"
                  value={l.appliesTo}
                  onChange={(e) =>
                    update(i, {
                      appliesTo: e.target.value as LineDraft["appliesTo"],
                    })
                  }
                >
                  {APPLIES_TO.map((a) => (
                    <option key={a} value={a}>
                      {a.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove line"
                disabled={lines.length === 1}
                onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
              >
                <Trash2Icon className="text-destructive" />
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Billing months (month of the academic year; none selected =
                every month)
              </Label>
              <div className="join flex-wrap">
                {Array.from({ length: 12 }, (_, m) => m + 1).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`btn btn-xs join-item ${l.months.includes(m) ? "btn-primary" : ""}`}
                    onClick={() =>
                      update(i, {
                        months: l.months.includes(m)
                          ? l.months.filter((x) => x !== m)
                          : [...l.months, m],
                      })
                    }
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Create draft
        </Button>
      </DialogFooter>
    </form>
  );
}
