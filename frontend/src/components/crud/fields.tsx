"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useHydrated } from "@/hooks/use-hydrated";
import type { Row } from "@/lib/api";
import { humanize, toPaisa } from "@/lib/format";
import type { RefSource } from "@/lib/refs";

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "money" // entered in taka, sent as integer paisa
  | "date"
  | "time"
  | "month" // YYYY-MM
  | "email"
  | "phone" // E.164
  | "password"
  | "select"
  | "boolean"
  | "ref"
  | "refs" // multi-select of ids
  | "list" // comma separated strings -> string[]
  | "numbers" // comma separated integers -> number[]
  | "json";

/** Form state: strings for inputs, booleans for switches, string[] for multi selects. */
export type FormValues = Record<string, string | boolean | string[]>;

export interface FieldDef {
  name: string;
  label: string;
  type?: FieldType;
  /** Enum values for "select". */
  options?: readonly string[];
  /** Option source for "ref" / "refs". */
  ref?: RefSource;
  /** Narrow ref options using the other values (e.g. terms of the chosen year). */
  refFilter?: (row: Row, values: FormValues) => boolean;
  required?: boolean;
  /** Show only when creating or only when editing (default: both). */
  mode?: "create" | "edit";
  /** On edit, an emptied field is sent as null (column is nullable). */
  nullable?: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: string | boolean | string[];
  /** Take the full row of the 2-column form grid. */
  wide?: boolean;
}

// ---- value conversion ----

export function toFormValue(
  field: FieldDef,
  value: unknown,
): string | boolean | string[] {
  const type = field.type ?? "text";
  if (type === "boolean") return value === true;
  if (type === "refs") return Array.isArray(value) ? value.map(String) : [];
  if (value === null || value === undefined) return "";
  if (type === "money") return String(Number(value) / 100);
  if (type === "time") return String(value).slice(0, 5);
  if (type === "list" || type === "numbers")
    return Array.isArray(value) ? value.join(", ") : String(value);
  if (type === "json")
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return String(value);
}

export function initialValues(fields: FieldDef[], row?: Row): FormValues {
  const out: FormValues = {};
  for (const f of fields) {
    out[f.name] =
      row && f.name in row
        ? toFormValue(f, row[f.name])
        : (f.defaultValue ?? toFormValue(f, undefined));
  }
  return out;
}

function isEmpty(v: string | boolean | string[]): boolean {
  return v === "" || (Array.isArray(v) && v.length === 0);
}

export function fromFormValue(
  field: FieldDef,
  value: string | boolean | string[],
): unknown {
  const type = field.type ?? "text";
  if (type === "boolean") return value === true;
  if (Array.isArray(value)) return value;
  const v = String(value).trim();
  switch (type) {
    case "number":
      return Number(v);
    case "money":
      return toPaisa(v);
    case "list":
      return v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    case "numbers":
      return v
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n));
    case "json":
      return JSON.parse(v);
    default:
      return v;
  }
}

/**
 * Request body from form values. Create: every non-empty field. Edit: only changed fields; an emptied
 * nullable field becomes null.
 */
export function buildBody(
  fields: FieldDef[],
  values: FormValues,
  initial?: FormValues,
): Row {
  const body: Row = {};
  for (const f of fields) {
    const v = values[f.name];
    if (v === undefined) continue;
    if (initial) {
      if (JSON.stringify(v) === JSON.stringify(initial[f.name])) continue;
      if (isEmpty(v)) {
        if (f.nullable) body[f.name] = null;
        continue;
      }
    } else if (
      isEmpty(v) ||
      (f.type === "boolean" && v === false && f.defaultValue === undefined)
    ) {
      continue;
    }
    body[f.name] = fromFormValue(f, v);
  }
  return body;
}

export function visibleFields(
  fields: FieldDef[],
  mode: "create" | "edit",
): FieldDef[] {
  return fields.filter((f) => !f.mode || f.mode === mode);
}

// ---- inputs ----

/**
 * Ref options are shared queries (["ref", key]) that another component may already have loaded by the time a
 * late Suspense boundary hydrates. Render the server's "loading" markup until hydration is done so they match.
 */
function useRefQuery(source: RefSource) {
  const hydrated = useHydrated();
  const q = useQuery({
    queryKey: ["ref", source.key],
    queryFn: source.load,
    staleTime: 60_000,
  });
  return {
    data: hydrated ? q.data : undefined,
    isPending: !hydrated || q.isPending,
    isError: hydrated && q.isError,
  };
}

/** Native select (daisyUI) fed by a RefSource. */
export function RefSelect({
  source,
  value,
  onChange,
  filter,
  required,
  placeholder = "Select…",
  id,
  className = "",
}: {
  source: RefSource;
  value: string;
  onChange: (value: string) => void;
  filter?: (row: Row) => boolean;
  required?: boolean;
  placeholder?: string;
  id?: string;
  className?: string;
}) {
  const q = useRefQuery(source);
  const rows = (q.data ?? []).filter(
    (r) => !filter || filter(r) || String(r.id) === value,
  );
  return (
    <select
      id={id}
      className={`select select-sm h-8 w-full ${className}`}
      value={value}
      required={required}
      disabled={q.isPending}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">
        {q.isPending ? "Loading…" : q.isError ? "Could not load" : placeholder}
      </option>
      {rows.map((r) => (
        <option key={String(r.id)} value={String(r.id)}>
          {source.label(r)}
        </option>
      ))}
    </select>
  );
}

/** Label of a referenced row (table cells). */
export function RefLabel({ source, id }: { source: RefSource; id: unknown }) {
  const q = useRefQuery(source);
  if (id === null || id === undefined || id === "")
    return <span className="text-muted-foreground">—</span>;
  const row = q.data?.find((r) => r.id === id);
  return (
    <>
      {row ? (
        source.label(row)
      ) : (
        <span className="font-mono text-xs">{String(id).slice(0, 8)}…</span>
      )}
    </>
  );
}

function RefMulti({
  source,
  value,
  onChange,
}: {
  source: RefSource;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const q = useRefQuery(source);
  return (
    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
      {q.isPending && <span className="loading loading-spinner loading-xs" />}
      {(q.data ?? []).map((r) => {
        const id = String(r.id);
        return (
          <label key={id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={value.includes(id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, id]
                    : value.filter((x) => x !== id),
                )
              }
            />
            {source.label(r)}
          </label>
        );
      })}
    </div>
  );
}

export function FieldInput({
  field,
  value,
  values,
  onChange,
  error,
}: {
  field: FieldDef;
  value: string | boolean | string[];
  values: FormValues;
  onChange: (v: string | boolean | string[]) => void;
  error?: string;
}) {
  const type = field.type ?? "text";
  const id = `f-${field.name}`;
  let control: ReactNode;

  if (type === "boolean") {
    control = (
      <Switch
        id={id}
        checked={value === true}
        onCheckedChange={(c) => onChange(Boolean(c))}
      />
    );
  } else if (type === "select") {
    control = (
      <select
        id={id}
        className="select select-sm h-8 w-full"
        value={String(value)}
        required={field.required}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{field.placeholder ?? "Select…"}</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {humanize(o)}
          </option>
        ))}
      </select>
    );
  } else if (type === "ref" && field.ref) {
    control = (
      <RefSelect
        id={id}
        source={field.ref}
        value={String(value)}
        required={field.required}
        placeholder={field.placeholder}
        filter={
          field.refFilter ? (r) => field.refFilter!(r, values) : undefined
        }
        onChange={onChange}
      />
    );
  } else if (type === "refs" && field.ref) {
    control = (
      <RefMulti
        source={field.ref}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
      />
    );
  } else if (type === "textarea" || type === "json") {
    control = (
      <Textarea
        id={id}
        rows={type === "json" ? 6 : 3}
        className={type === "json" ? "font-mono text-xs" : ""}
        required={field.required}
        placeholder={field.placeholder}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else {
    const inputType =
      type === "money" || type === "number"
        ? "number"
        : type === "phone"
          ? "tel"
          : ["date", "time", "month", "email", "password"].includes(type)
            ? type
            : "text";
    control = (
      <Input
        id={id}
        type={inputType}
        step={type === "money" ? "0.01" : type === "number" ? "any" : undefined}
        pattern={type === "phone" ? "^\\+[1-9]\\d{7,14}$" : undefined}
        required={field.required}
        placeholder={
          field.placeholder ??
          (type === "phone"
            ? "+8801712345678"
            : type === "list"
              ? "a, b, c"
              : "")
        }
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div
      className={`space-y-1.5 ${field.wide || type === "textarea" || type === "json" || type === "refs" ? "sm:col-span-2" : ""}`}
    >
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="text-destructive">*</span>}
        {type === "money" && (
          <span className="text-xs text-muted-foreground">(৳)</span>
        )}
      </Label>
      {control}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        field.help && (
          <p className="text-xs text-muted-foreground">{field.help}</p>
        )
      )}
    </div>
  );
}
