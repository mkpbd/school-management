"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isApiError, type Row } from "@/lib/api";
import {
  buildBody,
  FieldInput,
  initialValues,
  visibleFields,
  type FieldDef,
  type FormValues,
} from "./fields";

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: FieldDef[];
  /** Existing row: edit mode (only changed fields are sent). */
  row?: Row;
  submitLabel?: string;
  /** Receives the request body built from the fields. */
  onSubmit: (body: Row, values: FormValues) => Promise<unknown>;
  successMessage?: string;
}

/** Fields -> request body -> onSubmit, with API field errors shown under the inputs. */
export function FormDialog(props: FormDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {/* remount the form each time it opens so it starts from the row */}
        {props.open && <FormBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function FormBody({
  onOpenChange,
  title,
  description,
  fields,
  row,
  submitLabel,
  onSubmit,
  successMessage,
}: FormDialogProps) {
  const mode = row ? "edit" : "create";
  const shown = visibleFields(fields, mode);
  const [initial] = useState(() => initialValues(shown, row));
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      let body: Row;
      try {
        body = buildBody(shown, values, row ? initial : undefined);
      } catch {
        setFormError("Invalid JSON in one of the fields.");
        return;
      }
      if (row && Object.keys(body).length === 0) {
        onOpenChange(false);
        return;
      }
      await onSubmit(body, values);
      toast.success(successMessage ?? (row ? "Saved" : "Created"));
      onOpenChange(false);
    } catch (err) {
      if (isApiError(err)) {
        const byField: Record<string, string> = {};
        for (const [path, msg] of Object.entries(err.fieldErrors)) {
          const f = shown.find(
            (x) =>
              path === `body.${x.name}` ||
              path.endsWith(`.${x.name}`) ||
              path === x.name,
          );
          if (f) byField[f.name] = msg;
        }
        setErrors(byField);
        setFormError(
          Object.keys(byField).length
            ? "Please fix the highlighted fields."
            : err.message,
        );
      } else {
        setFormError("Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      {formError && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {formError}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {shown.map((f) => (
          <FieldInput
            key={f.name}
            field={f}
            value={values[f.name] ?? ""}
            values={values}
            error={errors[f.name]}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))}
          />
        ))}
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <span className="loading loading-spinner loading-xs" />}
          {submitLabel ?? (row ? "Save" : "Create")}
        </Button>
      </DialogFooter>
    </form>
  );
}
