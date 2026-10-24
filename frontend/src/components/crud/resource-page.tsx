"use client";

import { useQuery } from "@tanstack/react-query";
import { PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useDeferredValue, useState, type ReactNode } from "react";
import { ConfirmButton, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import type { ApiResult, OffsetMeta, Row, UpdateOptions } from "@/lib/api";
import { humanize } from "@/lib/format";
import type { RefSource } from "@/lib/refs";
import { DataTable, type Column } from "./data-table";
import { RefSelect, type FieldDef } from "./fields";
import { FormDialog } from "./form-dialog";

/** Any `resource()` from src/lib/api/resource.ts (params are `never` so typed bodies are accepted). */
export interface AnyResource {
  list: (
    query?: never,
  ) => Promise<ApiResult<Row[], OffsetMeta | Record<string, unknown>>>;
  create?: (body: never) => Promise<ApiResult<Row>>;
  update?: (
    id: string,
    body: never,
    opts?: UpdateOptions,
  ) => Promise<ApiResult<Row>>;
  remove?: (id: string) => Promise<unknown>;
}

export interface FilterDef {
  name: string;
  label: string;
  type: "select" | "ref" | "bool";
  options?: readonly string[];
  ref?: RefSource;
}

export interface ResourcePageProps {
  title: string;
  description?: ReactNode;
  /** Query key root, e.g. "core.campuses". */
  queryKey: string;
  resource: AnyResource;
  columns: Column[];
  /** Create / edit form. Omit for read-only pages. */
  fields?: FieldDef[];
  filters?: FilterDef[];
  /** Fixed query params (e.g. a parent id). */
  baseQuery?: Record<string, unknown>;
  searchable?: boolean;
  permissions?: { create?: string; edit?: string; delete?: string };
  /** Extra per-row buttons. */
  rowActions?: (row: Row) => ReactNode;
  /** Extra header buttons. */
  actions?: ReactNode;
  entity?: string;
  onRowClick?: (row: Row) => void;
}

const PAGE_SIZE = 50;

/** List (search, filters, offset paging) + create / edit dialog + delete for a master-data resource. */
export function ResourcePage({
  title,
  description,
  queryKey,
  resource,
  columns,
  fields,
  filters = [],
  baseQuery = {},
  searchable = true,
  permissions = {},
  rowActions,
  actions,
  entity = "record",
  onRowClick,
}: ResourcePageProps) {
  const { data: me } = useMe();
  const [q, setQ] = useState("");
  const search = useDeferredValue(q.trim());
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);

  const query = {
    ...baseQuery,
    page,
    pageSize: PAGE_SIZE,
    ...(search ? { q: search } : {}),
    ...Object.fromEntries(
      Object.entries(filterValues).filter(([, v]) => v !== ""),
    ),
  };
  const list = useQuery({
    queryKey: [queryKey, "list", query],
    queryFn: () => resource.list(query as never),
  });
  const meta = list.data?.meta as Partial<OffsetMeta> | undefined;

  const remove = useAction((id: string) => resource.remove!(id), {
    success: `${humanize(entity)} deleted`,
    invalidate: [[queryKey]],
  });
  const save = useAction(
    async ({ body, row }: { body: Row; row: Row | null }) =>
      row
        ? resource.update!(String(row.id), body as never, {
            rowVersion:
              typeof row.rowVersion === "number" ? row.rowVersion : undefined,
          })
        : resource.create!(body as never),
    { invalidate: [[queryKey]], toastError: false },
  );

  const allowed = (perm?: string) => !perm || can(me, perm);
  const canCreate = Boolean(
    fields && resource.create && allowed(permissions.create),
  );
  const canEdit = Boolean(
    fields && resource.update && allowed(permissions.edit),
  );
  const canDelete = Boolean(resource.remove && allowed(permissions.delete));
  const hasRowActions = canEdit || canDelete || rowActions;

  function setFilter(name: string, value: string) {
    setFilterValues((prev) => ({ ...prev, [name]: value }));
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {actions}
            {canCreate && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon /> New {entity}
              </Button>
            )}
          </>
        }
      />
      <Card>
        <CardContent className="space-y-4">
          {(searchable || filters.length > 0) && (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {searchable && (
                <div className="relative sm:w-64">
                  <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search…"
                    className="pl-8"
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
              )}
              {filters.map((f) =>
                f.type === "ref" && f.ref ? (
                  <div key={f.name} className="sm:w-52">
                    <RefSelect
                      source={f.ref}
                      value={filterValues[f.name] ?? ""}
                      placeholder={`All ${f.label.toLowerCase()}`}
                      onChange={(v) => setFilter(f.name, v)}
                    />
                  </div>
                ) : (
                  <select
                    key={f.name}
                    aria-label={f.label}
                    className="select select-sm h-8 sm:w-44"
                    value={filterValues[f.name] ?? ""}
                    onChange={(e) => setFilter(f.name, e.target.value)}
                  >
                    <option value="">{`All ${f.label.toLowerCase()}`}</option>
                    {(f.type === "bool"
                      ? ["true", "false"]
                      : (f.options ?? [])
                    ).map((o) => (
                      <option key={o} value={o}>
                        {f.type === "bool"
                          ? `${f.label}: ${o === "true" ? "yes" : "no"}`
                          : humanize(o)}
                      </option>
                    ))}
                  </select>
                ),
              )}
            </div>
          )}

          <DataTable
            columns={columns}
            rows={list.data?.data}
            isPending={list.isPending}
            error={list.error}
            onRowClick={onRowClick}
            empty={`No ${entity}s found.`}
            actions={
              hasRowActions
                ? (row) => (
                    <>
                      {rowActions?.(row)}
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Edit"
                          onClick={() => setEditing(row)}
                        >
                          <PencilIcon />
                        </Button>
                      )}
                      {canDelete && (
                        <ConfirmButton
                          variant="ghost"
                          size="icon-sm"
                          destructive
                          title={`Delete this ${entity}?`}
                          description="This cannot be undone."
                          confirmLabel="Delete"
                          onConfirm={() => remove.mutateAsync(String(row.id))}
                        >
                          <Trash2Icon className="text-destructive" />
                        </ConfirmButton>
                      )}
                    </>
                  )
                : undefined
            }
          />

          {(page > 1 || meta?.hasMore) && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-sm text-muted-foreground">Page {page}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!meta?.hasMore}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {fields && (
        <FormDialog
          open={creating || editing !== null}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
          title={editing ? `Edit ${entity}` : `New ${entity}`}
          fields={fields}
          row={editing ?? undefined}
          onSubmit={(body) => save.mutateAsync({ body, row: editing })}
        />
      )}
    </>
  );
}
