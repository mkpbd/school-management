"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ExternalLinkIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { useDeferredValue, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/crud/data-table";
import {
  buildBody,
  FieldInput,
  initialValues,
  RefLabel,
  RefSelect,
  type FieldDef,
  type FormValues,
} from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { OffsetPager, uploadFile } from "@/components/lib/shared";
import { ConfirmButton, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { api, isApiError, type Row } from "@/lib/api";
import type { DigitalItemRow, DigitalKind } from "@/lib/api/services/lib";
import { humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

const LIMIT = 50;
const KINDS: DigitalKind[] = ["ebook", "past_paper", "journal", "video"];

const CREATE_FIELDS: FieldDef[] = [
  { name: "title", label: "Title", required: true, wide: true },
  {
    name: "kind",
    label: "Kind",
    type: "select",
    options: KINDS,
    required: true,
  },
  {
    name: "url",
    label: "Link (https)",
    placeholder: "https://…",
    help: "Or upload a file below",
  },
  {
    name: "programmeId",
    label: "Programme",
    type: "ref",
    ref: refs.programmes,
  },
  { name: "subjectId", label: "Subject", type: "ref", ref: refs.subjects },
  {
    name: "yearGroupIds",
    label: "Year groups (empty: open to all)",
    type: "refs",
    ref: refs.yearGroups,
  },
];

const EDIT_FIELDS: FieldDef[] = [
  { name: "title", label: "Title", required: true, wide: true },
  {
    name: "subjectId",
    label: "Subject",
    type: "ref",
    ref: refs.subjects,
    nullable: true,
  },
  {
    name: "yearGroupIds",
    label: "Year groups (empty: open to all)",
    type: "refs",
    ref: refs.yearGroups,
  },
];

export default function DigitalLibraryPage() {
  const { data: me } = useMe();
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const [kind, setKind] = useState<"" | DigitalKind>("");
  const [subjectId, setSubjectId] = useState("");
  const [yearGroupId, setYearGroupId] = useState("");
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  const query = {
    limit: LIMIT,
    offset,
    ...(search ? { q: search } : {}),
    ...(kind ? { kind } : {}),
    ...(subjectId ? { subjectId } : {}),
    ...(yearGroupId ? { yearGroupId } : {}),
  };
  const list = useQuery({
    queryKey: ["lib.digital", query],
    queryFn: () => api.lib.digitalItems.list(query),
  });
  const rows = list.data?.data ?? [];

  const remove = useAction((id: string) => api.lib.digitalItems.remove(id), {
    success: "Item deleted",
    invalidate: [["lib.digital"]],
  });
  const save = useAction(
    ({
      id,
      body,
      rowVersion,
    }: {
      id: string;
      body: Row;
      rowVersion?: number;
    }) => api.lib.digitalItems.update(id, body as never, { rowVersion }),
    { invalidate: [["lib.digital"]], toastError: false },
  );
  // list rows carry no row version: load the item (ETag) before editing
  const startEdit = useAction(
    async (id: string) => {
      const r = await api.lib.digitalItems.get(id);
      return { ...r.data, rowVersion: r.rowVersion ?? r.data.rowVersion };
    },
    { onSuccess: setEditing },
  );

  async function open(item: DigitalItemRow) {
    try {
      if (item.url) {
        window.open(item.url, "_blank", "noopener");
        return;
      }
      if (!item.fileId) return;
      const { data } = await api.files.downloadUrl<{ url: string }>(
        item.fileId,
      );
      window.open(data.url, "_blank", "noopener");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not open the file",
      );
    }
  }

  const setFilter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setOffset(0);
    };

  return (
    <>
      <PageHeader
        title="Digital library"
        description="E-books, past papers, journals and videos. Students see their own class plus items open to all."
        actions={
          can(me, "lib.digital.create") && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New item
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <div className="relative sm:w-64">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search…"
                value={q}
                onChange={(e) => setFilter(setQ)(e.target.value)}
              />
            </div>
            <select
              aria-label="Kind"
              className="select select-sm h-8 sm:w-40"
              value={kind}
              onChange={(e) =>
                setFilter(setKind)(e.target.value as typeof kind)
              }
            >
              <option value="">All kinds</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {humanize(k)}
                </option>
              ))}
            </select>
            <div className="sm:w-52">
              <RefSelect
                source={refs.subjects}
                value={subjectId}
                placeholder="All subjects"
                onChange={setFilter(setSubjectId)}
              />
            </div>
            <div className="sm:w-52">
              <RefSelect
                source={refs.yearGroups}
                value={yearGroupId}
                placeholder="All year groups"
                onChange={setFilter(setYearGroupId)}
              />
            </div>
          </div>
          <DataTable<DigitalItemRow>
            rows={rows}
            isPending={list.isPending}
            error={list.error}
            empty="No digital items."
            columns={[
              { key: "title", label: "Title" },
              { key: "kind", label: "Kind", type: "enum" },
              { key: "programmeId", label: "Programme", ref: refs.programmes },
              { key: "subjectId", label: "Subject", ref: refs.subjects },
              {
                key: "yearGroupIds",
                label: "Year groups",
                render: (d) =>
                  d.yearGroupIds.length === 0 ? (
                    <span className="text-muted-foreground">All</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {d.yearGroupIds.map((y) => (
                        <span key={y} className="badge badge-ghost badge-sm">
                          <RefLabel source={refs.yearGroups} id={y} />
                        </span>
                      ))}
                    </div>
                  ),
              },
            ]}
            actions={(d) => (
              <>
                {(d.url || d.fileId) && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void open(d)}
                  >
                    <ExternalLinkIcon /> Open
                  </Button>
                )}
                {can(me, "lib.digital.edit") && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit"
                      disabled={startEdit.isPending}
                      onClick={() => startEdit.mutate(d.id)}
                    >
                      <PencilIcon />
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      size="icon-sm"
                      destructive
                      title={`Delete "${d.title}"?`}
                      description="This cannot be undone."
                      confirmLabel="Delete"
                      onConfirm={() => remove.mutateAsync(d.id)}
                    >
                      <Trash2Icon className="text-destructive" />
                    </ConfirmButton>
                  </>
                )}
              </>
            )}
          />
          <OffsetPager
            offset={offset}
            limit={LIMIT}
            count={rows.length}
            onChange={setOffset}
          />
        </CardContent>
      </Card>

      <CreateDigitalDialog open={creating} onOpenChange={setCreating} />
      <FormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title="Edit digital item"
        fields={EDIT_FIELDS}
        row={editing ?? undefined}
        onSubmit={(body, values) =>
          save.mutateAsync({
            id: String(editing!.id),
            // an emptied multi-select is skipped by buildBody; send [] to open the item to every class
            body:
              Array.isArray(values.yearGroupIds) &&
              values.yearGroupIds.length === 0 &&
              Array.isArray(editing!.yearGroupIds) &&
              editing!.yearGroupIds.length > 0
                ? { ...body, yearGroupIds: [] }
                : body,
            rowVersion:
              typeof editing!.rowVersion === "number"
                ? editing!.rowVersion
                : undefined,
          })
        }
      />
    </>
  );
}

/** Create form = the usual fields + an optional file (uploaded with purpose library_digital). */
function CreateDigitalDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {open && <CreateDigitalForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateDigitalForm({ onDone }: { onDone: () => void }) {
  const [values, setValues] = useState<FormValues>(() =>
    initialValues(CREATE_FIELDS),
  );
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const create = useAction(
    (body: Row) => api.lib.digitalItems.create(body as never),
    {
      success: "Item added",
      invalidate: [["lib.digital"]],
      toastError: false,
    },
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const body = buildBody(CREATE_FIELDS, values);
    if (!file && !body.url) {
      setError("Upload a file or give a link.");
      return;
    }
    setBusy(true);
    try {
      if (file) body.fileId = await uploadFile(file, "library_digital");
      await create.mutateAsync(body);
      onDone();
    } catch (err) {
      if (isApiError(err)) {
        const byField: Record<string, string> = {};
        for (const [path, msg] of Object.entries(err.fieldErrors))
          byField[path.replace(/^body\./, "")] = msg;
        setFieldErrors(byField);
      }
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>New digital item</DialogTitle>
        <DialogDescription>
          PDF / EPUB / MP4 / MP3 up to 200 MB, or an https link.
        </DialogDescription>
      </DialogHeader>
      {error && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {error}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {CREATE_FIELDS.map((f) => (
          <FieldInput
            key={f.name}
            field={f}
            value={values[f.name] ?? ""}
            values={values}
            error={fieldErrors[f.name]}
            onChange={(v) => setValues((p) => ({ ...p, [f.name]: v }))}
          />
        ))}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="digital-file">File</Label>
          <input
            id="digital-file"
            type="file"
            className="file-input file-input-sm w-full"
            accept=".pdf,.doc,.docx,.epub,video/mp4,audio/mpeg,application/pdf,application/epub+zip"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <span className="loading loading-spinner loading-xs" />}
          {file && busy ? "Uploading…" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}
