"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { RefSelect } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { StudentPicker } from "@/components/fee/student-picker";
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
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { api, isApiError, type StudentListItem } from "@/lib/api";
import type {
  Diet,
  MealPlan,
  OutpassKind,
  OutpassRow,
  ResidentRow,
} from "@/lib/api/services/hst";
import { formatDateTime, humanize, todayISO } from "@/lib/format";
import {
  DIETS,
  freeBedsRef,
  HostelSelect,
  localInput,
  MEAL_PLANS,
  OUTPASS_KINDS,
  ResidentPicker,
  toInstant,
} from "./shared";

/** Query keys refreshed after an allocation changes. */
export const ALLOCATION_KEYS = [
  ["hst.occupancy"],
  ["hst.residents"],
  ["hst.student"],
  ["hst.roll"],
  ["hst.studentMeals"],
];
export const OUTPASS_KEYS = [["hst.outpasses"], ["hst.student"], ["hst.roll"]];

export function Field({
  label,
  required,
  help,
  children,
  wide,
}: {
  label: string;
  required?: boolean;
  help?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <Label>
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

/** Dialog shell for custom forms: busy state and the API error above the fields. */
export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  onSubmit,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Without it the dialog is read-only (Close only). */
  submitLabel?: string;
  /** Throws to keep the dialog open (the message is shown). */
  onSubmit: () => Promise<unknown>;
  children: ReactNode;
  wide?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
      onOpenChange(false);
    } catch (err) {
      setError(
        isApiError(err) || err instanceof Error
          ? err.message
          : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent
        className={`max-h-[90svh] overflow-y-auto ${wide ? "sm:max-w-3xl" : "sm:max-w-2xl"}`}
      >
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
          {error && (
            <div role="alert" className="alert alert-error alert-soft text-sm">
              {error}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">{children}</div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {submitLabel ? "Cancel" : "Close"}
            </Button>
            {submitLabel && (
              <Button type="submit" disabled={busy}>
                {busy && (
                  <span className="loading loading-spinner loading-xs" />
                )}
                {submitLabel}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- allocation ----

/**
 * Give a student a bed: student, hostel, free bed on the start date, meal plan. Used by the allocate page (inline)
 * and the occupancy map (dialog with the bed chosen).
 */
export function AllocateFields({
  value,
  onChange,
  fixedBed,
}: {
  value: AllocateDraft;
  onChange: (v: AllocateDraft) => void;
  /** Bed picked on the map: hostel and bed are not editable. */
  fixedBed?: string;
}) {
  const set = (patch: Partial<AllocateDraft>) =>
    onChange({ ...value, ...patch });
  return (
    <>
      <Field label="Student" required wide>
        <StudentPicker
          value={value.student}
          onChange={(student) => set({ student })}
        />
      </Field>
      {fixedBed ? (
        <Field label="Bed" wide>
          <div className="flex h-8 items-center rounded-lg border px-2.5 text-sm">
            {fixedBed}
          </div>
        </Field>
      ) : (
        <>
          <Field label="Hostel" required>
            <HostelSelect
              className=""
              value={value.hostelId}
              onChange={(hostelId) => set({ hostelId, bedId: "" })}
            />
          </Field>
          <Field label="Bed" required help="Free beds on the start date">
            <RefSelect
              source={freeBedsRef(value.hostelId, value.validFrom)}
              value={value.bedId}
              required
              placeholder={
                value.hostelId ? "Choose a free bed" : "Choose a hostel first"
              }
              onChange={(bedId) => set({ bedId })}
            />
          </Field>
        </>
      )}
      <Field
        label="From"
        required
        help="Rent and meal fee are billed monthly from this date"
      >
        <Input
          type="date"
          required
          value={value.validFrom}
          onChange={(e) =>
            set({
              validFrom: e.target.value,
              ...(fixedBed ? {} : { bedId: "" }),
            })
          }
        />
      </Field>
      <Field
        label="Meal plan"
        required
        help="Full: the mess meal fee is added to the monthly invoice"
      >
        <select
          className="select select-sm h-8 w-full"
          value={value.mealPlan}
          onChange={(e) => set({ mealPlan: e.target.value as MealPlan })}
        >
          {MEAL_PLANS.map((m) => (
            <option key={m} value={m}>
              {humanize(m)}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

export interface AllocateDraft {
  student: StudentListItem | null;
  hostelId: string;
  bedId: string;
  validFrom: string;
  mealPlan: MealPlan;
}

export const emptyAllocation = (hostelId = "", bedId = ""): AllocateDraft => ({
  student: null,
  hostelId,
  bedId,
  validFrom: todayISO(),
  mealPlan: "full",
});

export function useAllocate(onSuccess?: () => void) {
  return useAction(
    (d: AllocateDraft) => {
      if (!d.student) throw new Error("Choose a student");
      if (!d.bedId) throw new Error("Choose a bed");
      return api.hst.allocations.create({
        studentId: d.student.id,
        bedId: d.bedId,
        validFrom: d.validFrom || undefined,
        mealPlan: d.mealPlan,
      });
    },
    {
      success: "Bed allocated",
      invalidate: ALLOCATION_KEYS,
      toastError: false,
      onSuccess,
    },
  );
}

/** Allocate a free bed picked on the occupancy map. */
export function AllocateDialog({
  target,
  onClose,
}: {
  target: {
    hostelId: string;
    bedId: string;
    label: string;
    date: string;
  } | null;
  onClose: () => void;
}) {
  return target ? (
    <AllocateDialogBody key={target.bedId} target={target} onClose={onClose} />
  ) : null;
}

function AllocateDialogBody({
  target,
  onClose,
}: {
  target: { hostelId: string; bedId: string; label: string; date: string };
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AllocateDraft>(() => ({
    ...emptyAllocation(target.hostelId, target.bedId),
    validFrom: target.date,
  }));
  const allocate = useAllocate();
  return (
    <ActionDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Allocate bed"
      description="Boys' hostels take male students, girls' hostels female students; one bed per student at a time."
      submitLabel="Allocate"
      onSubmit={() => allocate.mutateAsync(draft)}
    >
      <AllocateFields
        value={draft}
        onChange={setDraft}
        fixedBed={target.label}
      />
    </ActionDialog>
  );
}

/** Move a resident to another bed (same or another hostel) from a date; the meal plan can change too. */
export function TransferDialog({
  resident,
  hostelId,
  onClose,
}: {
  resident: ResidentRow | null;
  hostelId: string;
  onClose: () => void;
}) {
  return resident ? (
    <TransferBody
      key={resident.allocationId}
      resident={resident}
      hostelId={hostelId}
      onClose={onClose}
    />
  ) : null;
}

function TransferBody({
  resident,
  hostelId,
  onClose,
}: {
  resident: ResidentRow;
  hostelId: string;
  onClose: () => void;
}) {
  const [to, setTo] = useState({
    hostelId,
    bedId: "",
    fromDate: todayISO(),
    mealPlan: "" as MealPlan | "",
  });
  const transfer = useAction(
    () =>
      api.hst.allocations.transfer(resident.allocationId, {
        bedId: to.bedId,
        fromDate: to.fromDate || undefined,
        ...(to.mealPlan ? { mealPlan: to.mealPlan } : {}),
      }),
    {
      success: `${resident.studentName} moved`,
      invalidate: ALLOCATION_KEYS,
      toastError: false,
    },
  );
  return (
    <ActionDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Transfer ${resident.studentName}`}
      description={`Now in room ${resident.roomCode}, bed ${resident.bedCode} since ${resident.validFrom}. The current allocation ends the day before; rent follows the new room.`}
      submitLabel="Transfer"
      onSubmit={() => transfer.mutateAsync(undefined)}
    >
      <Field label="Hostel" required>
        <HostelSelect
          className=""
          value={to.hostelId}
          onChange={(id) => setTo((t) => ({ ...t, hostelId: id, bedId: "" }))}
        />
      </Field>
      <Field
        label="From"
        required
        help="Must be after the current allocation started"
      >
        <Input
          type="date"
          required
          value={to.fromDate}
          onChange={(e) =>
            setTo((t) => ({ ...t, fromDate: e.target.value, bedId: "" }))
          }
        />
      </Field>
      <Field label="New bed" required wide>
        <RefSelect
          source={freeBedsRef(to.hostelId, to.fromDate)}
          value={to.bedId}
          required
          placeholder="Choose a free bed"
          onChange={(bedId) => setTo((t) => ({ ...t, bedId }))}
        />
      </Field>
      <Field label="Meal plan">
        <select
          className="select select-sm h-8 w-full"
          value={to.mealPlan}
          onChange={(e) =>
            setTo((t) => ({ ...t, mealPlan: e.target.value as MealPlan | "" }))
          }
        >
          <option value="">Keep current</option>
          {MEAL_PLANS.map((m) => (
            <option key={m} value={m}>
              {humanize(m)}
            </option>
          ))}
        </select>
      </Field>
    </ActionDialog>
  );
}

/** Vacate: last night in the hostel and the reason (rent and meal billing stop after it). */
export function VacateDialog({
  resident,
  onClose,
}: {
  resident: ResidentRow | null;
  onClose: () => void;
}) {
  const vacate = useAction(
    ({
      id,
      body,
    }: {
      id: string;
      body: { lastDay?: string; reason: string };
    }) => api.hst.allocations.vacate(id, body),
    { invalidate: ALLOCATION_KEYS, toastError: false },
  );
  return (
    <FormDialog
      open={resident !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`Vacate ${resident?.studentName ?? ""}`}
      description={
        resident
          ? `Room ${resident.roomCode}, bed ${resident.bedCode}. The bed becomes free after the last day.`
          : undefined
      }
      submitLabel="Vacate"
      successMessage="Bed vacated"
      fields={[
        {
          name: "lastDay",
          label: "Last day",
          type: "date",
          required: true,
          defaultValue: todayISO(),
        },
        {
          name: "reason",
          label: "Reason",
          type: "textarea",
          required: true,
          placeholder: "Left the school, moved home…",
        },
      ]}
      onSubmit={(body) =>
        vacate.mutateAsync({
          id: resident!.allocationId,
          body: body as { lastDay?: string; reason: string },
        })
      }
    />
  );
}

/** Diet of a resident for the kitchen headcount. */
export function DietDialog({
  resident,
  onClose,
}: {
  resident: ResidentRow | null;
  onClose: () => void;
}) {
  const setDiet = useAction(
    ({
      id,
      body,
    }: {
      id: string;
      body: { diet: Diet; dietNote?: string | null };
    }) => api.hst.allocations.setDiet(id, body),
    { invalidate: [["hst.meals"]], toastError: false },
  );
  return (
    <FormDialog
      open={resident !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`Diet of ${resident?.studentName ?? ""}`}
      description="Counted per meal on the kitchen sheet. Saving replaces the previous diet and note."
      submitLabel="Save diet"
      successMessage="Diet saved"
      fields={[
        {
          name: "diet",
          label: "Diet",
          type: "select",
          options: DIETS,
          required: true,
          defaultValue: resident?.diet ?? "regular",
        },
        {
          name: "dietNote",
          label: "Note",
          type: "textarea",
          placeholder: "Allergies, doctor's advice…",
          defaultValue: resident?.dietNote ?? "",
        },
      ]}
      onSubmit={(body) =>
        setDiet.mutateAsync({
          id: resident!.allocationId,
          body: {
            diet: body.diet as Diet,
            dietNote: typeof body.dietNote === "string" ? body.dietNote : null,
          },
        })
      }
    />
  );
}

// ---- out-passes ----

/** Request an out-pass: for a fixed student (guardian / student page) or a resident chosen here (staff). */
export function OutpassRequestDialog({
  open,
  onOpenChange,
  studentId,
  hostelId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed student; otherwise a resident is chosen. */
  studentId?: string;
  hostelId?: string;
}) {
  return open ? (
    <OutpassRequestBody
      onOpenChange={onOpenChange}
      studentId={studentId}
      hostelId={hostelId}
    />
  ) : null;
}

function OutpassRequestBody({
  onOpenChange,
  studentId,
  hostelId,
}: {
  onOpenChange: (open: boolean) => void;
  studentId?: string;
  hostelId?: string;
}) {
  const [d, setD] = useState({
    studentId: studentId ?? "",
    kind: "day_out" as OutpassKind,
    destination: "",
    reason: "",
    escortName: "",
    escortPhone: "",
    outFrom: localInput(1),
    returnBy: localInput(8),
  });
  const set = (patch: Partial<typeof d>) => setD((v) => ({ ...v, ...patch }));
  const request = useAction(
    () => {
      if (!d.studentId) throw new Error("Choose a student");
      return api.hst.outpasses.request({
        studentId: d.studentId,
        kind: d.kind,
        destination: d.destination.trim(),
        outFrom: toInstant(d.outFrom),
        returnBy: toInstant(d.returnBy),
        ...(d.reason.trim() ? { reason: d.reason.trim() } : {}),
        ...(d.escortName.trim() ? { escortName: d.escortName.trim() } : {}),
        ...(d.escortPhone.trim() ? { escortPhone: d.escortPhone.trim() } : {}),
      });
    },
    {
      success: "Out-pass requested; the warden will decide",
      invalidate: OUTPASS_KEYS,
      toastError: false,
    },
  );
  return (
    <ActionDialog
      open
      onOpenChange={onOpenChange}
      title="Request out-pass"
      description="Times are Bangladesh time. The warden approves; the gate checks the student out and back in."
      submitLabel="Request"
      onSubmit={() => request.mutateAsync(undefined)}
    >
      {!studentId && (
        <Field label="Student" required wide>
          <ResidentPicker
            hostelId={hostelId}
            value={d.studentId}
            onChange={(id) => set({ studentId: id })}
          />
        </Field>
      )}
      <Field label="Kind" required>
        <select
          className="select select-sm h-8 w-full"
          value={d.kind}
          onChange={(e) => set({ kind: e.target.value as OutpassKind })}
        >
          {OUTPASS_KINDS.map((k) => (
            <option key={k} value={k}>
              {humanize(k)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Destination" required>
        <Input
          required
          minLength={2}
          maxLength={200}
          value={d.destination}
          onChange={(e) => set({ destination: e.target.value })}
        />
      </Field>
      <Field label="Leaves" required>
        <Input
          type="datetime-local"
          required
          value={d.outFrom}
          onChange={(e) => set({ outFrom: e.target.value })}
        />
      </Field>
      <Field label="Back by" required>
        <Input
          type="datetime-local"
          required
          min={d.outFrom}
          value={d.returnBy}
          onChange={(e) => set({ returnBy: e.target.value })}
        />
      </Field>
      <Field label="Escort name">
        <Input
          maxLength={100}
          value={d.escortName}
          onChange={(e) => set({ escortName: e.target.value })}
        />
      </Field>
      <Field label="Escort phone">
        <Input
          type="tel"
          pattern="^\+[1-9]\d{7,14}$"
          placeholder="+8801712345678"
          value={d.escortPhone}
          onChange={(e) => set({ escortPhone: e.target.value })}
        />
      </Field>
      <Field label="Reason" wide>
        <Textarea
          rows={2}
          maxLength={300}
          value={d.reason}
          onChange={(e) => set({ reason: e.target.value })}
        />
      </Field>
    </ActionDialog>
  );
}

/** Warden: approve or reject with an optional note (the guardian is told). */
export function DecideDialog({
  target,
  onClose,
}: {
  target: {
    pass: OutpassRow;
    decision: "approved" | "rejected";
    name: string;
  } | null;
  onClose: () => void;
}) {
  const decide = useAction(
    ({
      id,
      decision,
      note,
    }: {
      id: string;
      decision: "approved" | "rejected";
      note?: string;
    }) => api.hst.outpasses.decide(id, { decision, ...(note ? { note } : {}) }),
    { invalidate: OUTPASS_KEYS, toastError: false },
  );
  const approve = target?.decision === "approved";
  return (
    <FormDialog
      open={target !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`${approve ? "Approve" : "Reject"} out-pass of ${target?.name ?? ""}`}
      description={
        target
          ? `${humanize(target.pass.kind)} to ${target.pass.destination}: ${formatDateTime(target.pass.outFrom)} – ${formatDateTime(target.pass.returnBy)}`
          : undefined
      }
      submitLabel={approve ? "Approve" : "Reject"}
      successMessage={
        approve ? "Approved; guardian informed" : "Rejected; guardian informed"
      }
      fields={[
        { name: "note", label: "Note to the guardian", type: "textarea" },
      ]}
      onSubmit={(body) =>
        decide.mutateAsync({
          id: target!.pass.id,
          decision: target!.decision,
          note: typeof body.note === "string" ? body.note : undefined,
        })
      }
    />
  );
}

/** Gate check-in result: minutes late. */
export function checkInMessage(r: { minutesLate: number }): string {
  return r.minutesLate > 0
    ? `Back, ${r.minutesLate} min late; guardian informed`
    : "Back in time; guardian informed";
}

/** Toast helper for a known / unknown visitor. */
export function visitorMessage(r: {
  visitorName: string;
  knownContact: boolean;
}) {
  if (r.knownContact)
    toast.success(`${r.visitorName} signed in (primary guardian's phone)`);
  else
    toast.warning(
      `${r.visitorName} signed in — phone is not the primary guardian's; check the ID`,
    );
}
