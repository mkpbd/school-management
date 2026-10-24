"use client";

import { useQuery } from "@tanstack/react-query";
import { PaperclipIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RefLabel, RefSelect } from "@/components/crud/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type Row } from "@/lib/api";
import { humanize } from "@/lib/format";
import { refs, type RefSource } from "@/lib/refs";

// ---- response shapes (backend/src/modules/com/application/noticePorts.ts, NoticeUseCases.ts, MessagingUseCases.ts) ----

export type NoticeStatus = "draft" | "scheduled" | "published" | "withdrawn";
export type NoticePriority = "normal" | "urgent" | "emergency";
export type AudienceType =
  | "everyone"
  | "campus"
  | "year_group"
  | "class_section"
  | "house"
  | "role"
  | "staff"
  | "guardians"
  | "students"
  | "user";

export interface Audience {
  type: AudienceType;
  id: string | null;
}

export type NoticeRow = {
  id: string;
  campusId: string | null;
  titleEn: string;
  titleBn: string | null;
  bodyEn: string;
  bodyBn: string | null;
  category: string;
  isCircular: boolean;
  circularNo: string | null;
  attachmentFileIds: string[];
  priority: NoticePriority;
  publishAt: string;
  expiresAt: string | null;
  publishToWebsite: boolean;
  sendSms: boolean;
  status: NoticeStatus;
  publishedAt: string | null;
  recipientCount: number | null;
  createdBy: string | null;
  audiences?: Audience[];
  /** Board / recipient view only. */
  readAt?: string | null;
};

export type ReadReceipts = {
  noticeId: string;
  recipients: number;
  read: number;
  readPercent: number;
  byType: Record<string, { recipients: number; read: number }>;
  unread: Array<{ userId: string; userType: string; contact: string | null }>;
};

export type WebsiteNotice = Pick<
  NoticeRow,
  | "id"
  | "titleEn"
  | "titleBn"
  | "bodyEn"
  | "bodyBn"
  | "category"
  | "circularNo"
  | "publishedAt"
  | "expiresAt"
>;

export type Preferences = {
  quietHours: { from: string; to: string } | null;
  schoolQuietHours: { from: string; to: string } | null;
  events: Array<{
    eventCode: string;
    label: string;
    mandatory: boolean;
    channels: Array<{ channel: string; enabled: boolean }>;
  }>;
};

export type PushDevice = {
  id: string;
  app: string;
  platform: string;
  lastSeenAt: string;
  tokenTail: string;
};

export type InboxMessage = {
  id: string;
  eventCode: string;
  subject: string | null;
  body: string;
  createdAt: string;
};

export type TemplateRow = {
  id: string;
  eventCode: string;
  channel: TemplateChannel;
  locale: "en" | "bn";
  version: number;
  subject: string | null;
  body: string;
  isActive: boolean;
};

// ---- enums (backend/src/modules/com/presentation/*Controller.ts) ----

export const NOTICE_STATUSES: NoticeStatus[] = [
  "draft",
  "scheduled",
  "published",
  "withdrawn",
];
export const CATEGORIES = [
  "general",
  "academic",
  "exam",
  "event",
  "holiday",
  "fee",
  "transport",
  "circular",
] as const;
export type NoticeCategory = (typeof CATEGORIES)[number];
export const PRIORITIES: NoticePriority[] = ["normal", "urgent", "emergency"];
export const AUDIENCE_TYPES: AudienceType[] = [
  "everyone",
  "campus",
  "year_group",
  "class_section",
  "house",
  "role",
  "staff",
  "guardians",
  "students",
  "user",
];
/** Types that point at one thing (need an id); the others take none. */
export const NEEDS_ID: ReadonlySet<AudienceType> = new Set([
  "campus",
  "year_group",
  "class_section",
  "house",
  "role",
  "user",
]);
export const PREF_CHANNELS = ["sms", "email", "push", "whatsapp"] as const;
export type PrefChannel = (typeof PREF_CHANNELS)[number];
export const TEMPLATE_CHANNELS = [
  "sms",
  "email",
  "push",
  "whatsapp",
  "in_app",
] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];
export const LOCALES = ["en", "bn"] as const;

// ---- option sources for audience ids ----

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export const roleRef: RefSource = {
  key: "com.roles",
  load: async () => (await api.iam.roles.list<Row[]>()).data,
  label: (r) => `${s(r.nameEn)} (${s(r.code)})`,
};

const userLabel = (r: Row) =>
  `${s(r.username ?? r.email ?? r.phone ?? r.id)} · ${humanize(r.userType)}`;

/** Login account picker (audience "user"): search by username / e-mail / phone. */
export function UserPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const users = useQuery({
    queryKey: ["com.users", q],
    queryFn: async () =>
      (await api.iam.users.list<Row[]>({ q: q || undefined, limit: 50 })).data,
    staleTime: 30_000,
  });
  const rows = users.data ?? [];
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row">
      <Input
        className="h-8 sm:w-40"
        placeholder="Search user…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        className="select select-sm h-8 w-full min-w-0"
        value={value}
        required
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {users.isPending
            ? "Loading…"
            : users.isError
              ? "Could not load users"
              : "Select user…"}
        </option>
        {value && !rows.some((r) => r.id === value) && (
          <option value={value}>{value.slice(0, 8)}…</option>
        )}
        {rows.map((r) => (
          <option key={String(r.id)} value={String(r.id)}>
            {userLabel(r)}
          </option>
        ))}
      </select>
    </div>
  );
}

const AUDIENCE_REF: Partial<Record<AudienceType, RefSource>> = {
  campus: refs.campuses,
  year_group: refs.yearGroups,
  class_section: refs.sections,
  role: roleRef,
  house: refs.houses,
};

/** "Year group: Class 6" style label of one audience entry. */
export function AudienceLabel({ audience }: { audience: Audience }) {
  const source = AUDIENCE_REF[audience.type];
  return (
    <span className="badge badge-soft badge-sm whitespace-nowrap">
      {humanize(audience.type)}
      {audience.id && (
        <>
          :{" "}
          {source ? (
            <RefLabel source={source} id={audience.id} />
          ) : (
            <span className="font-mono text-xs">
              {audience.id.slice(0, 8)}…
            </span>
          )}
        </>
      )}
    </span>
  );
}

/** Audience builder: one row per type + id (the right picker per type). */
export function AudienceEditor({
  value,
  onChange,
}: {
  value: Audience[];
  onChange: (v: Audience[]) => void;
}) {
  const set = (i: number, a: Audience) =>
    onChange(value.map((x, j) => (j === i ? a : x)));
  return (
    <div className="space-y-2">
      {value.map((a, i) => {
        const source = AUDIENCE_REF[a.type];
        return (
          <div
            key={i}
            className="flex flex-col gap-1 rounded-lg border p-2 sm:flex-row sm:items-center"
          >
            <select
              aria-label="Audience type"
              className="select select-sm h-8 sm:w-40"
              value={a.type}
              onChange={(e) => {
                const type = e.target.value as AudienceType;
                set(i, { type, id: null });
              }}
            >
              {AUDIENCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
            {NEEDS_ID.has(a.type) ? (
              source ? (
                <div className="min-w-0 flex-1">
                  <RefSelect
                    source={source}
                    value={a.id ?? ""}
                    required
                    onChange={(id) => set(i, { ...a, id: id || null })}
                  />
                </div>
              ) : a.type === "user" ? (
                <UserPicker
                  value={a.id ?? ""}
                  onChange={(id) => set(i, { ...a, id: id || null })}
                />
              ) : (
                <Input
                  className="h-8 flex-1 font-mono text-xs"
                  placeholder="House id (UUID)"
                  required
                  pattern="^[0-9a-fA-F-]{36}$"
                  value={a.id ?? ""}
                  onChange={(e) =>
                    set(i, { ...a, id: e.target.value.trim() || null })
                  }
                />
              )
            ) : (
              <span className="flex-1 text-xs text-muted-foreground">
                {a.type === "everyone"
                  ? "All students, guardians and staff of the notice's campus"
                  : `All ${a.type} of the notice's campus`}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={value.length === 1}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={value.length >= 100}
        onClick={() => onChange([...value, { type: "guardians", id: null }])}
      >
        Add audience
      </Button>
    </div>
  );
}

// ---- badges ----

export function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "normal")
    return <span className="badge badge-ghost badge-sm">Normal</span>;
  const tone = priority === "emergency" ? "badge-error" : "badge-warning";
  return (
    <span className={`badge badge-soft badge-sm ${tone}`}>
      {humanize(priority)}
    </span>
  );
}

// ---- attachments ----

/** Opens a notice attachment through the notice (recipients / notice managers), not the generic file link. */
export async function openNoticeAttachment(
  noticeId: string,
  fileId: string,
): Promise<void> {
  try {
    const { data } = await api.com.notices.attachmentUrl<{
      url: string;
      fileName: string | null;
    }>(noticeId, fileId);
    window.open(data.url, "_blank", "noopener");
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : "Could not open the attachment",
    );
  }
}

export function NoticeAttachments({
  noticeId,
  fileIds,
}: {
  noticeId: string;
  fileIds: string[];
}) {
  if (!fileIds.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {fileIds.map((f, i) => (
        <Button
          key={f}
          type="button"
          variant="outline"
          size="xs"
          onClick={() => openNoticeAttachment(noticeId, f)}
        >
          <PaperclipIcon /> Attachment {i + 1}
        </Button>
      ))}
    </div>
  );
}

// ---- dates ----

/** ISO instant -> value of a datetime-local input (browser time). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

/** datetime-local value -> ISO instant (undefined when empty). */
export function fromLocalInput(v: string): string | undefined {
  return v ? new Date(v).toISOString() : undefined;
}
