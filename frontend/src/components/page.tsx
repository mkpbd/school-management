"use client";

import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { humanize } from "@/lib/format";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  const message =
    error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div role="alert" className="alert alert-error alert-soft text-sm">
      {message}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <span className="loading loading-spinner loading-md" />
      {label}
    </div>
  );
}

export function Empty({
  children = "Nothing here yet.",
}: {
  children?: ReactNode;
}) {
  return (
    <div className="py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

const GOOD = new Set([
  "active",
  "open",
  "published",
  "approved",
  "verified",
  "paid",
  "present",
  "available",
  "ready",
  "fulfilled",
  "completed",
  "closed",
]);
const BAD = new Set([
  "void",
  "rejected",
  "withdrawn",
  "terminated",
  "lost",
  "damaged",
  "absent",
  "cancelled",
  "expired",
  "overdue",
  "retired",
]);
const WAIT = new Set([
  "pending",
  "draft",
  "planned",
  "issued",
  "partially_paid",
  "late",
  "waiting",
  "on_hold",
  "in_repair",
  "probation",
  "onboarding",
  "on_leave",
]);

/** Status pill coloured by meaning (daisyUI badge colours). */
export function StatusBadge({ status }: { status: unknown }) {
  const s = String(status ?? "");
  const tone = GOOD.has(s)
    ? "badge-success"
    : BAD.has(s)
      ? "badge-error"
      : WAIT.has(s)
        ? "badge-warning"
        : "badge-ghost";
  return (
    <span className={`badge badge-soft badge-sm ${tone} whitespace-nowrap`}>
      {humanize(s)}
    </span>
  );
}

export function BoolBadge({ value }: { value: unknown }) {
  return value ? (
    <Badge variant="secondary">Yes</Badge>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

/** Button that asks before running a (destructive or irreversible) action. */
export function ConfirmButton({
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  children,
  variant = "outline",
  size = "sm",
  destructive,
}: {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<unknown> | void;
  children: ReactNode;
  variant?: "outline" | "ghost" | "default" | "destructive" | "secondary";
  size?: "sm" | "xs" | "default" | "icon-sm";
  destructive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <span className="loading loading-spinner loading-xs" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Label/value grid for detail pages. */
export function DetailList({
  items,
}: {
  items: Array<[ReactNode, ReactNode]>;
}) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="text-sm">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
