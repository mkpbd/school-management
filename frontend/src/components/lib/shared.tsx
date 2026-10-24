"use client";

import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { FormDialog } from "@/components/crud/form-dialog";
import { RefSelect } from "@/components/crud/fields";
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
import { api, type Row } from "@/lib/api";
import type { BorrowerType, CopyStatus } from "@/lib/api/services/lib";
import { humanize } from "@/lib/format";
import { refs, type RefSource } from "@/lib/refs";

/** Book titles as a select source (["ref", "bookTitles"]). */
export const bookTitlesRef: RefSource = {
  key: "bookTitles",
  load: async () => (await api.lib.titles.list({ pageSize: 500 })).data,
  label: (r) => `${String(r.title)}${r.isbn ? ` (${String(r.isbn)})` : ""}`,
};

export const MANUAL_COPY_STATUSES = [
  "available",
  "withdrawn",
  "in_repair",
  "damaged",
  "lost",
] as const;
export const COPY_STATUSES: CopyStatus[] = [
  "available",
  "on_loan",
  "reserved",
  "lost",
  "damaged",
  "withdrawn",
  "in_repair",
];
export const MEDIA_TYPES = [
  "book",
  "journal",
  "magazine",
  "dvd",
  "audio",
  "kit",
] as const;

export function borrowerHref(type: BorrowerType, id: string): string {
  return `/dashboard/library/borrowers/${type}/${id}`;
}

/** Presigned upload: start -> PUT to storage -> complete. Returns the file id. */
export async function uploadFile(file: File, purpose: string): Promise<string> {
  const { data } = await api.files.startUpload<{
    fileId: string;
    upload: { url: string; method: "PUT"; headers: Record<string, string> };
  }>({
    purpose,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  });
  const put = await fetch(data.upload.url, {
    method: "PUT",
    headers: data.upload.headers,
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  await api.files.complete(data.fileId);
  return data.fileId;
}

/** Offset paging for limit/offset list endpoints (no total: "next" is enabled when a full page came back). */
export function OffsetPager({
  offset,
  limit,
  count,
  onChange,
}: {
  offset: number;
  limit: number;
  count: number;
  onChange: (offset: number) => void;
}) {
  if (offset === 0 && count < limit) return null;
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-sm text-muted-foreground">
        {offset + 1}–{offset + count}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        Previous
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={count < limit}
        onClick={() => onChange(offset + limit)}
      >
        Next
      </Button>
    </div>
  );
}

/** Pick a student or staff member by search. */
export function BorrowerPicker({
  type,
  onTypeChange,
  value,
  onChange,
}: {
  type: BorrowerType;
  onTypeChange: (t: BorrowerType) => void;
  value: { id: string; name: string } | null;
  onChange: (v: { id: string; name: string } | null) => void;
}) {
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const results = useQuery({
    queryKey: ["lib.borrowerSearch", type, search],
    enabled: search.length >= 2,
    queryFn: async (): Promise<
      Array<{ id: string; name: string; sub: string }>
    > => {
      if (type === "student") {
        const { data } = await api.sis.students.search({
          q: search,
          limit: 10,
        });
        return data.map((s) => ({
          id: s.id,
          name: s.fullNameEn,
          sub: s.admissionNo,
        }));
      }
      const { data } = await api.hrm.staff.search({ q: search, limit: 10 });
      return data.map((s) => ({
        id: String(s.id),
        name: String(s.fullNameEn),
        sub: String(s.staffNo ?? ""),
      }));
    },
  });

  return (
    <div className="space-y-2">
      <div role="tablist" className="tabs tabs-box tabs-sm w-fit">
        {(["student", "staff"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className={`tab ${type === t ? "tab-active" : ""}`}
            onClick={() => {
              onTypeChange(t);
              onChange(null);
            }}
          >
            {humanize(t)}
          </button>
        ))}
      </div>
      {value ? (
        <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
          <span className="font-medium">{value.name}</span>
          <Button
            type="button"
            variant="link"
            size="xs"
            onClick={() => onChange(null)}
          >
            Change
          </Button>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="relative">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={
                type === "student"
                  ? "Student name or admission no"
                  : "Staff name, staff no or phone"
              }
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {results.isFetching && (
            <span className="loading loading-dots loading-xs" />
          )}
          {results.data && (
            <ul className="menu menu-sm w-full rounded-box border p-1">
              {results.data.length === 0 && (
                <li className="p-2 text-muted-foreground">No match</li>
              )}
              {results.data.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onChange({ id: r.id, name: r.name })}
                  >
                    {r.name}{" "}
                    <span className="text-muted-foreground">{r.sub}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Row action: manual copy status change. */
export function CopyStatusButton({
  copy,
  invalidate,
}: {
  copy: Row;
  invalidate: string[];
}) {
  const [open, setOpen] = useState(false);
  const save = useAction(
    (status: string) =>
      api.lib.copies.setStatus(String(copy.id), {
        status: status as (typeof MANUAL_COPY_STATUSES)[number],
      }),
    { invalidate: invalidate.map((k) => [k]), toastError: false },
  );
  const locked = copy.status === "on_loan" || copy.status === "reserved";
  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        disabled={locked}
        onClick={() => setOpen(true)}
        title={locked ? "Changes through circulation" : undefined}
      >
        Status
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Copy ${String(copy.accessionNo ?? "")}`}
        description="On loan / reserved copies change only through issue, return and reservations."
        fields={[
          {
            name: "status",
            label: "Status",
            type: "select",
            options: MANUAL_COPY_STATUSES,
            required: true,
          },
        ]}
        row={{ status: copy.status }}
        submitLabel="Change status"
        onSubmit={(body) => save.mutateAsync(String(body.status))}
      />
    </>
  );
}

/** Join the reservation queue for a title on behalf of a reader (or yourself when no reader is picked). */
export function ReserveDialog({
  open,
  onOpenChange,
  titleId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed title; otherwise the dialog shows a title select. */
  titleId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && (
          <ReserveForm titleId={titleId} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReserveForm({
  titleId,
  onDone,
}: {
  titleId?: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(titleId ?? "");
  const [campusId, setCampusId] = useState("");
  const [type, setType] = useState<BorrowerType>("student");
  const [borrower, setBorrower] = useState<{ id: string; name: string } | null>(
    null,
  );
  const reserve = useAction(
    () =>
      api.lib.reservations.create({
        titleId: title,
        ...(campusId ? { campusId } : {}),
        ...(borrower ? { borrowerType: type, borrowerId: borrower.id } : {}),
      }),
    {
      success: (r) => `Reserved — position ${r.data.position} in the queue`,
      invalidate: [["lib.reservations"], ["lib.title"], ["lib.catalogue"]],
      onSuccess: onDone,
    },
  );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        reserve.mutate(undefined);
      }}
    >
      <DialogHeader>
        <DialogTitle>Reserve a title</DialogTitle>
        <DialogDescription>
          Only titles with no copy on the shelf can be reserved. Leave the
          reader empty to reserve for yourself.
        </DialogDescription>
      </DialogHeader>
      {!titleId && (
        <div className="space-y-1.5">
          <Label>Title</Label>
          <RefSelect
            source={bookTitlesRef}
            value={title}
            onChange={setTitle}
            required
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Campus</Label>
        <RefSelect
          source={refs.campuses}
          value={campusId}
          onChange={setCampusId}
          placeholder="Reader's campus"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Reader</Label>
        <BorrowerPicker
          type={type}
          onTypeChange={setType}
          value={borrower}
          onChange={setBorrower}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!title || reserve.isPending}>
          {reserve.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Reserve
        </Button>
      </DialogFooter>
    </form>
  );
}
