"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { FormDialog } from "@/components/crud/form-dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { api, getActiveCampus, type Row } from "@/lib/api";
import type {
  EnquiryActivityKind,
  EnquiryRow,
} from "@/lib/api/services/adm-office";
import { humanize } from "@/lib/format";
import { refs } from "@/lib/refs";
import {
  ACTIVITY_KINDS,
  campaignsRef,
  Field,
  fromLocalInput,
  OFFICE_SOURCES,
  PREFERRED_CONTACTS,
  useLostReasons,
} from "./shared";

type CreateBody = Parameters<typeof api.adm.enquiries.create>[0];
type ActivityKind = Exclude<EnquiryActivityKind, "stage_change">;

/** Query keys refreshed after any enquiry change. */
export const ENQUIRY_INVALIDATE = [["adm.enquiries"], ["adm.enquiry"]];

/** Phone call, walk-in, social message or event lead recorded by the office. */
export function EnquiryCreateDialog({
  open,
  onOpenChange,
  onCreated,
  canSeeCampaigns,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (e: EnquiryRow) => void;
  canSeeCampaigns: boolean;
}) {
  const years = useQuery({
    queryKey: ["ref", refs.academicYears.key],
    queryFn: refs.academicYears.load,
    staleTime: 60_000,
  });
  const currentYear = years.data?.find((y) => y.isCurrent);
  const create = useAction(
    (body: CreateBody) => api.adm.enquiries.create(body),
    {
      invalidate: ENQUIRY_INVALIDATE,
      toastError: false,
      onSuccess: (r) => onCreated?.(r.data),
    },
  );
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New enquiry"
      description="A phone call, walk-in, social message or event lead. It is assigned to you."
      successMessage="Enquiry recorded"
      fields={[
        {
          name: "sourceCode",
          label: "Source",
          type: "select",
          options: OFFICE_SOURCES,
          required: true,
          defaultValue: "phone",
        },
        ...(canSeeCampaigns
          ? [
              {
                name: "campaignId",
                label: "Campaign",
                type: "ref" as const,
                ref: campaignsRef,
                refFilter: (r: Row) => r.isActive !== false,
                placeholder: "None",
              },
            ]
          : []),
        {
          name: "campusId",
          label: "Campus",
          type: "ref",
          ref: refs.campuses,
          required: true,
          defaultValue: getActiveCampus() ?? "",
        },
        {
          name: "academicYearId",
          label: "Academic year",
          type: "ref",
          ref: refs.academicYears,
          required: true,
          defaultValue: currentYear ? String(currentYear.id) : "",
        },
        {
          name: "yearGroupId",
          label: "Class",
          type: "ref",
          ref: refs.yearGroups,
        },
        { name: "childName", label: "Child's name", required: true },
        { name: "childDob", label: "Child's date of birth", type: "date" },
        { name: "guardianName", label: "Guardian's name", required: true },
        { name: "phone", label: "Phone", type: "phone", required: true },
        { name: "email", label: "E-mail", type: "email" },
        {
          name: "preferredContact",
          label: "Preferred contact",
          type: "select",
          options: PREFERRED_CONTACTS,
        },
        {
          name: "message",
          label: "Message / notes",
          type: "textarea",
        },
      ]}
      onSubmit={(body) => create.mutateAsync(body as CreateBody)}
    />
  );
}

/** Class and e-mail of an enquiry. */
export function EnquiryEditDialog({
  enquiry,
  open,
  onOpenChange,
}: {
  enquiry: EnquiryRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useAction(
    (body: Parameters<typeof api.adm.enquiries.update>[1]) =>
      api.adm.enquiries.update(enquiry.id, body),
    { invalidate: ENQUIRY_INVALIDATE, toastError: false },
  );
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${enquiry.enquiryNo ?? "enquiry"}`}
      row={enquiry}
      fields={[
        {
          name: "yearGroupId",
          label: "Class",
          type: "ref",
          ref: refs.yearGroups,
          nullable: true,
        },
        { name: "email", label: "E-mail", type: "email", nullable: true },
      ]}
      onSubmit={(body) => update.mutateAsync(body)}
    />
  );
}

/** Moving an enquiry to "lost" needs the reason. */
export function LostDialog({
  enquiry,
  open,
  onOpenChange,
}: {
  enquiry: EnquiryRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reasons = useLostReasons();
  const [code, setCode] = useState("");
  const lost = useAction(
    (lostReasonCode: string) =>
      api.adm.enquiries.update(enquiry.id, { stage: "lost", lostReasonCode }),
    {
      success: "Marked as lost",
      invalidate: ENQUIRY_INVALIDATE,
      onSuccess: () => onOpenChange(false),
    },
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    if (code) lost.mutate(code);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Lost — {enquiry.childName}</DialogTitle>
            <DialogDescription>
              Why did the family not go ahead? Follow-ups stop.
            </DialogDescription>
          </DialogHeader>
          <Field label="Reason" required>
            <select
              className="select select-sm h-8 w-full"
              value={code}
              required
              onChange={(e) => setCode(e.target.value)}
            >
              <option value="">Select…</option>
              {reasons.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!code || lost.isPending}
            >
              {lost.isPending && (
                <span className="loading loading-spinner loading-xs" />
              )}
              Mark as lost
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Call note, SMS / e-mail sent, visit, note, or a task with a due time (a task sets the next follow-up). */
export function ActivityDialog({
  enquiry,
  kind: initialKind,
  open,
  onOpenChange,
}: {
  enquiry: EnquiryRow;
  kind: ActivityKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && (
          <ActivityForm
            enquiry={enquiry}
            initialKind={initialKind}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const NOTE_HINT: Record<ActivityKind, string> = {
  call: "What was discussed on the call?",
  sms: "Text of the SMS sent",
  email: "Subject / summary of the e-mail sent",
  visit: "Campus visit: who came, impressions",
  note: "Internal note",
  task: "What needs doing (e.g. call back about fees)",
};

function ActivityForm({
  enquiry,
  initialKind,
  onDone,
}: {
  enquiry: EnquiryRow;
  initialKind: ActivityKind;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<ActivityKind>(initialKind);
  const [notes, setNotes] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [done, setDone] = useState(false);
  const add = useAction(
    () =>
      api.adm.enquiries.addActivity(enquiry.id, {
        kind,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(kind === "task" && dueAt ? { dueAt: fromLocalInput(dueAt) } : {}),
        ...(kind === "task" && done ? { done: true } : {}),
      }),
    {
      success: `${humanize(kind)} added`,
      invalidate: ENQUIRY_INVALIDATE,
      onSuccess: onDone,
    },
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate(undefined);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Add to timeline</DialogTitle>
        <DialogDescription>
          {enquiry.childName} · {enquiry.guardianName} {enquiry.phone}
        </DialogDescription>
      </DialogHeader>
      <div role="tablist" className="tabs tabs-box tabs-sm w-fit flex-wrap">
        {ACTIVITY_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            className={`tab ${kind === k ? "tab-active" : ""}`}
            onClick={() => setKind(k)}
          >
            {k === "sms" ? "SMS" : k === "email" ? "E-mail" : humanize(k)}
          </button>
        ))}
      </div>
      {kind === "task" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Due" required help="Becomes the next follow-up.">
            <Input
              type="datetime-local"
              required
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 self-center text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={done}
              onChange={(e) => setDone(e.target.checked)}
            />
            Already done
          </label>
        </div>
      )}
      <Field label="Notes">
        <Textarea
          rows={4}
          maxLength={2000}
          placeholder={NOTE_HINT[kind]}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Add
        </Button>
      </DialogFooter>
    </form>
  );
}
