"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, EyeIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import {
  LOCALES,
  TEMPLATE_CHANNELS,
  type TemplateChannel,
  type TemplateRow,
} from "@/components/com/shared";
import { DataTable } from "@/components/crud/data-table";
import { PageHeader } from "@/components/page";
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
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";

type Draft = Pick<TemplateRow, "eventCode" | "channel" | "locale" | "body"> & {
  subject: string;
  version?: number;
};

const EMPTY: Draft = {
  eventCode: "",
  channel: "sms",
  locale: "en",
  subject: "",
  body: "",
};

/** Message templates: versions per event / channel / locale; a new version is live once activated. */
export default function TemplatesPage() {
  const { data: me } = useMe();
  const [eventCode, setEventCode] = useState("");
  const [channel, setChannel] = useState<TemplateChannel | "">("");
  const [locale, setLocale] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);

  const query = channel ? { channel } : {};
  const templates = useQuery({
    queryKey: ["com.templates", query],
    queryFn: () => api.com.templates.list<TemplateRow[]>(query),
  });
  const list = templates.data?.data ?? [];
  const eventCodes = [...new Set(list.map((t) => t.eventCode))].sort();
  const q = eventCode.trim().toLowerCase();
  const rows = list.filter(
    (t) =>
      (!q || t.eventCode.includes(q)) &&
      (!locale || t.locale === locale) &&
      (!activeOnly || t.isActive),
  );

  const activate = useAction(
    (id: string) => api.com.templates.activate<TemplateRow>(id),
    {
      success: (r) => `Version ${r.data.version} is live`,
      invalidate: [["com.templates"]],
    },
  );
  const canEdit = can(me, "com.template.edit");
  const canApprove = can(me, "com.template.approve");

  return (
    <>
      <PageHeader
        title="Message templates"
        description="SMS, e-mail, push, WhatsApp and in-app texts per notification. Handlebars placeholders, e.g. {{student_name}}."
        actions={
          canEdit && (
            <Button onClick={() => setEditing(EMPTY)}>
              <PlusIcon /> New template
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <Input
              className="h-8 lg:w-64"
              placeholder="Filter by event code"
              list="com-event-codes"
              value={eventCode}
              onChange={(e) => setEventCode(e.target.value)}
            />
            <datalist id="com-event-codes">
              {eventCodes.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <select
              aria-label="Channel"
              className="select select-sm h-8 lg:w-36"
              value={channel}
              onChange={(e) =>
                setChannel(e.target.value as TemplateChannel | "")
              }
            >
              <option value="">All channels</option>
              {TEMPLATE_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </select>
            <select
              aria-label="Locale"
              className="select select-sm h-8 lg:w-32"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
            >
              <option value="">All languages</option>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {l === "en" ? "English" : "Bangla"}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
              />
              Live versions only
            </label>
          </div>
          <DataTable<TemplateRow>
            rows={rows}
            isPending={templates.isPending}
            error={templates.error}
            empty="No templates."
            onRowClick={(t) => setEditing({ ...t, subject: t.subject ?? "" })}
            columns={[
              { key: "eventCode", label: "Event", type: "mono" },
              { key: "channel", label: "Channel", type: "enum" },
              {
                key: "locale",
                label: "Language",
                render: (t) => t.locale.toUpperCase(),
              },
              {
                key: "version",
                label: "Version",
                className: "tabular-nums",
                render: (t) => `v${t.version}`,
              },
              {
                key: "subject",
                label: "Subject / text",
                render: (t) => (
                  <span className="line-clamp-1 max-w-sm text-muted-foreground">
                    {t.subject ?? t.body}
                  </span>
                ),
              },
              {
                key: "isActive",
                label: "Status",
                render: (t) =>
                  t.isActive ? (
                    <span className="badge badge-soft badge-success badge-sm">
                      Live
                    </span>
                  ) : (
                    <span className="badge badge-ghost badge-sm">Inactive</span>
                  ),
              },
            ]}
            actions={(t) => (
              <>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditing({ ...t, subject: t.subject ?? "" })}
                >
                  <EyeIcon /> {canEdit ? "Open" : "Preview"}
                </Button>
                {canApprove && !t.isActive && (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={activate.isPending}
                    onClick={() => activate.mutate(t.id)}
                  >
                    <CheckCircle2Icon /> Activate
                  </Button>
                )}
              </>
            )}
          />
        </CardContent>
      </Card>
      <TemplateDialog
        draft={editing}
        canEdit={canEdit}
        eventCodes={eventCodes}
        onClose={() => setEditing(null)}
        onSaved={() => void templates.refetch()}
      />
    </>
  );
}

/** Sample data from the placeholders of a template ({{name}} / {{{name}}}), skipping block helpers. */
function sampleData(...sources: string[]): string {
  const data: Record<string, string> = {};
  for (const src of sources) {
    for (const m of src.matchAll(/\{\{\{?\s*([a-zA-Z_][\w.]*)\s*\}?\}\}/g)) {
      const key = m[1]!;
      if (key !== "else" && key !== "this")
        data[key] = `Sample ${key.replace(/_/g, " ")}`;
    }
  }
  return JSON.stringify(data, null, 2);
}

function TemplateDialog({
  draft,
  canEdit,
  eventCodes,
  onClose,
  onSaved,
}: {
  draft: Draft | null;
  canEdit: boolean;
  eventCodes: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
        {draft && (
          <TemplateForm
            draft={draft}
            canEdit={canEdit}
            eventCodes={eventCodes}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TemplateForm({
  draft,
  canEdit,
  eventCodes,
  onClose,
  onSaved,
}: {
  draft: Draft;
  canEdit: boolean;
  eventCodes: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = draft.version === undefined;
  const [eventCode, setEventCode] = useState(draft.eventCode);
  const [channel, setChannel] = useState<TemplateChannel>(draft.channel);
  const [locale, setLocale] = useState<"en" | "bn">(draft.locale);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [data, setData] = useState(() => sampleData(draft.subject, draft.body));
  const [school, setSchool] = useState("");
  const [preview, setPreview] = useState<{
    subject: string | null;
    body: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runPreview = useAction(
    async () => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data || "{}") as Record<string, unknown>;
      } catch {
        throw new Error("Sample data is not valid JSON");
      }
      return api.com.templates.preview<{
        subject: string | null;
        body: string;
      }>({
        channel,
        body,
        data: parsed,
        ...(subject.trim() ? { subject } : {}),
        ...(school.trim() ? { school: school.trim() } : {}),
      });
    },
    { onSuccess: (r) => setPreview(r.data) },
  );
  const save = useAction(
    () =>
      api.com.templates.create<TemplateRow>({
        eventCode: eventCode.trim(),
        channel,
        locale,
        body,
        ...(subject.trim() ? { subject: subject.trim() } : {}),
      }),
    {
      success: (r) =>
        `Saved as version ${r.data.version} (inactive until activated)`,
      invalidate: [["com.templates"]],
      toastError: false,
      onSuccess: () => {
        onSaved();
        onClose();
      },
    },
  );

  const validEvent = /^[a-z_]+\.[a-z_]+$/.test(eventCode.trim());

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>
          {isNew
            ? "New template"
            : `${draft.eventCode} · ${humanize(draft.channel)} · ${draft.locale.toUpperCase()} · v${draft.version}`}
        </DialogTitle>
        <DialogDescription>
          {canEdit
            ? "Saving creates a new version; it goes live when someone with approval rights activates it. E-mail bodies are HTML (values are escaped)."
            : "Render this template with sample data."}
        </DialogDescription>
      </DialogHeader>
      {error && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {error}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="t-event">Event code</Label>
              <Input
                id="t-event"
                className="font-mono text-xs"
                list="com-event-codes-form"
                placeholder="att.absent"
                disabled={!isNew}
                value={eventCode}
                onChange={(e) => setEventCode(e.target.value)}
              />
              <datalist id="com-event-codes-form">
                {eventCodes.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-channel">Channel</Label>
              <select
                id="t-channel"
                className="select select-sm h-8 w-full"
                disabled={!isNew}
                value={channel}
                onChange={(e) => setChannel(e.target.value as TemplateChannel)}
              >
                {TEMPLATE_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-locale">Language</Label>
              <select
                id="t-locale"
                className="select select-sm h-8 w-full"
                disabled={!isNew}
                value={locale}
                onChange={(e) => setLocale(e.target.value as "en" | "bn")}
              >
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {l === "en" ? "English" : "Bangla"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-subject">
              Subject{" "}
              {channel !== "email" && channel !== "push" && (
                <span className="text-xs text-muted-foreground">
                  (e-mail / push title)
                </span>
              )}
            </Label>
            <Input
              id="t-subject"
              maxLength={200}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-body">Body</Label>
            <Textarea
              id="t-body"
              rows={10}
              className="font-mono text-xs"
              maxLength={50_000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            {channel === "sms" && (
              <p className="text-xs text-muted-foreground">
                {body.length} characters (before placeholders are filled)
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="t-data">Sample data (JSON)</Label>
              <Button
                type="button"
                variant="link"
                size="xs"
                className="px-0"
                onClick={() => setData(sampleData(subject, body))}
              >
                From placeholders
              </Button>
            </div>
            <Textarea
              id="t-data"
              rows={5}
              className="font-mono text-xs"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </div>
          {channel === "email" && (
            <div className="space-y-1.5">
              <Label htmlFor="t-school">School name in the e-mail layout</Label>
              <Input
                id="t-school"
                maxLength={100}
                placeholder="School"
                value={school}
                onChange={(e) => setSchool(e.target.value)}
              />
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!body || runPreview.isPending}
            onClick={() => runPreview.mutate(undefined)}
          >
            {runPreview.isPending ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <EyeIcon />
            )}
            Preview
          </Button>
          {preview && (
            <div className="space-y-2 rounded-lg border p-3">
              {preview.subject && (
                <div className="text-sm font-medium">{preview.subject}</div>
              )}
              {channel === "email" ? (
                <iframe
                  title="E-mail preview"
                  sandbox=""
                  srcDoc={preview.body}
                  className="h-96 w-full rounded border bg-white"
                />
              ) : (
                <>
                  <p className="text-sm whitespace-pre-wrap">{preview.body}</p>
                  {channel === "sms" && (
                    <p className="text-xs text-muted-foreground">
                      {preview.body.length} characters
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        {canEdit && (
          <Button
            type="button"
            disabled={!validEvent || !body || save.isPending}
            onClick={() => {
              setError(null);
              save.mutate(undefined, {
                onError: (err) =>
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Something went wrong.",
                  ),
              });
            }}
          >
            {save.isPending && (
              <span className="loading loading-spinner loading-xs" />
            )}
            {isNew ? "Save (inactive)" : "Save as new version"}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}
