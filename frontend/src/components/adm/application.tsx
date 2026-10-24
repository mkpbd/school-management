"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { api } from "@/lib/api";
import type { ApplicationRow } from "@/lib/api/services/adm-office";
import { humanize } from "@/lib/format";
import { childNameOf, Field, type ReviewStatus } from "./shared";

/** Query keys refreshed after any application change (the linked enquiry may move to lost). */
export const APPLICATION_INVALIDATE = [
  ["adm.applications"],
  ["adm.application"],
  ["adm.enquiries"],
  ["adm.enquiry"],
];

const LABEL: Record<ReviewStatus, string> = {
  under_review: "Start review",
  shortlisted: "Shortlist",
  waitlisted: "Waitlist",
  rejected: "Reject",
  withdrawn: "Mark withdrawn",
};

const HINT: Record<ReviewStatus, string> = {
  under_review: "The application is being looked at.",
  shortlisted: "Goes on to the admission test / interview.",
  waitlisted: "Kept in line in case a seat frees up.",
  rejected:
    "The family is told the application was not successful; the enquiry is closed as lost.",
  withdrawn:
    "The family no longer wants the seat; the enquiry is closed as lost.",
};

/** Review decision with a note (required when rejecting). */
export function ReviewDialog({
  application,
  status,
  onOpenChange,
}: {
  application: ApplicationRow;
  status: ReviewStatus | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={status !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {status && (
          <ReviewForm
            application={application}
            status={status}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewForm({
  application: a,
  status,
  onDone,
}: {
  application: ApplicationRow;
  status: ReviewStatus;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const needsNote = status === "rejected";
  const review = useAction(
    () =>
      api.adm.applications.setStatus(a.id, {
        status,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    {
      success: `${a.applicationNo ?? "Application"}: ${humanize(status)}`,
      invalidate: APPLICATION_INVALIDATE,
      onSuccess: onDone,
    },
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    review.mutate(undefined);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>
          {LABEL[status]} — {childNameOf(a)}
        </DialogTitle>
        <DialogDescription>{HINT[status]}</DialogDescription>
      </DialogHeader>
      <Field label={needsNote ? "Reason" : "Note"} required={needsNote}>
        <Textarea
          rows={3}
          maxLength={2000}
          required={needsNote}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant={
            status === "rejected" || status === "withdrawn"
              ? "destructive"
              : "default"
          }
          disabled={review.isPending || (needsNote && !note.trim())}
        >
          {review.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          {LABEL[status]}
        </Button>
      </DialogFooter>
    </form>
  );
}
