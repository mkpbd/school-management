"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldAlertIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { DetailList } from "@/components/page";
import { Input } from "@/components/ui/input";
import { api, type Me, type Row } from "@/lib/api";
import type {
  ApplicationStatus,
  CampaignChannel,
  EnquiryActivityKind,
  EnquiryStage,
} from "@/lib/api/services/adm-office";
import { humanize } from "@/lib/format";
import type { RefSource } from "@/lib/refs";

export { BackLink, Field, Stat } from "@/components/acc/procurement";
export { fromLocalInput, toLocalInput } from "@/components/com/shared";

// ---- enums ----

export const STAGES: EnquiryStage[] = [
  "enquiry",
  "visit_scheduled",
  "visited",
  "applied",
  "test_scheduled",
  "tested",
  "offered",
  "admitted",
  "lost",
];

/** Sources the office can record (POST /adm/enquiries). */
export const OFFICE_SOURCES = [
  "phone",
  "walk_in",
  "facebook",
  "referral",
  "event",
  "email",
  "other",
] as const;
export type OfficeSource = (typeof OFFICE_SOURCES)[number];

export const CHANNELS: CampaignChannel[] = [
  "website",
  "facebook",
  "google",
  "instagram",
  "youtube",
  "qr",
  "sms",
  "email",
  "event",
  "referral",
  "print",
  "other",
];

/** Every lead source an enquiry can carry: office sources and the website / campaign channels. */
export const SOURCES: string[] = [
  ...new Set<string>([...CHANNELS, ...OFFICE_SOURCES]),
];

export const PREFERRED_CONTACTS = [
  "phone",
  "sms",
  "email",
  "whatsapp",
] as const;

export const ACTIVITY_KINDS: Exclude<EnquiryActivityKind, "stage_change">[] = [
  "call",
  "sms",
  "email",
  "visit",
  "note",
  "task",
];

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "draft",
  "submitted",
  "fee_pending",
  "under_review",
  "test_scheduled",
  "tested",
  "shortlisted",
  "waitlisted",
  "offered",
  "accepted",
  "declined",
  "enrolled",
  "rejected",
  "withdrawn",
  "expired",
];

/** Review decisions the office can take here (POST /adm/applications/{id}/status). */
export const REVIEW_STATUSES = [
  "under_review",
  "shortlisted",
  "waitlisted",
  "rejected",
  "withdrawn",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Statuses an application can be reviewed from (backend REVIEWABLE). */
export const REVIEWABLE: ApplicationStatus[] = [
  "submitted",
  "fee_pending",
  "under_review",
  "shortlisted",
  "waitlisted",
  "tested",
];

/** Fallback when the `lost_reason` lookup list cannot be read. */
const DEFAULT_LOST_REASONS: Array<{ code: string; label: string }> = [
  { code: "fees", label: "Fees too high" },
  { code: "distance", label: "Distance" },
  { code: "other_school", label: "Chose another school" },
  { code: "no_seat", label: "No seat" },
  { code: "not_reachable", label: "Not reachable" },
  { code: "other", label: "Other" },
];

/** Lost reasons from the `lost_reason` lookup list (Setup → Lookups), else a built-in list. */
export function useLostReasons() {
  const q = useQuery({
    queryKey: ["ref", "adm.lostReasons"],
    queryFn: async () =>
      (
        await api.core.lookups.list({
          listCode: "lost_reason",
          isActive: "true",
          pageSize: 500,
        })
      ).data,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const rows = (q.data ?? []).map((r: Row) => ({
    code: String(r.code),
    label: String(r.labelEn ?? r.code),
  }));
  return rows.length ? rows : DEFAULT_LOST_REASONS;
}

// ---- badges ----

const STAGE_TONE: Record<string, string> = {
  enquiry: "badge-info",
  visit_scheduled: "badge-warning",
  visited: "badge-primary",
  applied: "badge-primary",
  test_scheduled: "badge-warning",
  tested: "badge-primary",
  offered: "badge-accent",
  admitted: "badge-success",
  lost: "badge-error",
};

const STATUS_TONE: Record<string, string> = {
  draft: "badge-ghost",
  submitted: "badge-info",
  fee_pending: "badge-warning",
  under_review: "badge-warning",
  test_scheduled: "badge-warning",
  tested: "badge-primary",
  shortlisted: "badge-primary",
  waitlisted: "badge-warning",
  offered: "badge-accent",
  accepted: "badge-success",
  enrolled: "badge-success",
  declined: "badge-error",
  rejected: "badge-error",
  withdrawn: "badge-error",
  expired: "badge-neutral",
};

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={`badge badge-soft badge-sm whitespace-nowrap ${tone}`}>
      {children}
    </span>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  return (
    <Pill tone={STAGE_TONE[stage] ?? "badge-ghost"}>{humanize(stage)}</Pill>
  );
}

export function ApplicationStatusBadge({ status }: { status: string }) {
  return (
    <Pill tone={STATUS_TONE[status] ?? "badge-ghost"}>{humanize(status)}</Pill>
  );
}

export function SpamBadge({ score }: { score: number }) {
  return (
    <span className="badge badge-error badge-outline badge-sm whitespace-nowrap">
      Spam {score}
    </span>
  );
}

/** Spam score and the reasons the filter gave (shown when flagged or scored). */
export function SpamAlert({
  isSpam,
  score,
  reasons,
  action,
}: {
  isSpam: boolean;
  score: number;
  reasons: string[];
  action?: ReactNode;
}) {
  if (!isSpam && !score && !reasons.length) return null;
  return (
    <div
      role="alert"
      className={`alert alert-soft mb-4 text-sm ${isSpam ? "alert-error" : "alert-warning"}`}
    >
      <ShieldAlertIcon className="size-4" />
      <div>
        <div className="font-medium">
          {isSpam ? "Flagged as spam" : "Not spam"} · score {score}
        </div>
        {reasons.length > 0 && (
          <ul className="mt-1 list-inside list-disc text-xs">
            {reasons.map((r) => (
              <li key={r}>{humanize(r)}</li>
            ))}
          </ul>
        )}
      </div>
      {action}
    </div>
  );
}

/** Source with its campaign code underneath. */
export function SourceCell({
  source,
  campaign,
}: {
  source: string | null;
  campaign?: string | null;
}) {
  return (
    <div>
      <div>{humanize(source)}</div>
      {campaign && (
        <div className="font-mono text-xs text-muted-foreground">
          {campaign}
        </div>
      )}
    </div>
  );
}

/** Lead tracking: source, campaign, UTM, referrer, landing URL. */
export function TrackingList({
  source,
  campaign,
  utm,
  referrer,
  landingUrl,
}: {
  source: string | null;
  campaign: ReactNode;
  utm: Record<string, string> | null;
  referrer: string | null;
  landingUrl: string | null;
}) {
  const utmText = utm
    ? Object.entries(utm)
        .map(([k, v]) => `${k}=${v}`)
        .join(" · ")
    : "";
  return (
    <DetailList
      items={[
        ["Source", humanize(source)],
        ["Campaign", campaign],
        ["UTM", utmText ? <span className="text-xs">{utmText}</span> : "—"],
        [
          "Referrer",
          referrer ? (
            <span className="break-all text-xs">{referrer}</span>
          ) : (
            "—"
          ),
        ],
        [
          "Landing URL",
          landingUrl ? (
            <span className="break-all text-xs">{landingUrl}</span>
          ) : (
            "—"
          ),
        ],
      ]}
    />
  );
}

// ---- campaigns ----

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Campaigns (ended ones marked) — ["ref", "adm.campaigns"]; needs adm.campaign.view. */
export const campaignsRef: RefSource = {
  key: "adm.campaigns",
  load: async () => (await api.adm.campaigns.list<Row[]>()).data,
  label: (r) =>
    `${s(r.name)} (${s(r.code)})${r.isActive === false ? " — ended" : ""}`,
};

// ---- counsellors (login accounts) ----

export type UserOption = {
  id: string;
  username: string | null;
  email: string | null;
  phone: string | null;
};

const userName = (u: UserOption) =>
  u.username ?? u.email ?? u.phone ?? u.id.slice(0, 8);

/** Staff accounts for assigning a counsellor; fails (isError) without iam.user.view. */
export function useStaffUsers(q = "") {
  return useQuery({
    queryKey: ["adm.staffUsers", q],
    queryFn: async () =>
      (
        await api.iam.users.list<UserOption[]>({
          userType: "staff",
          status: "active",
          limit: 100,
          ...(q ? { q } : {}),
        })
      ).data,
    staleTime: 60_000,
    retry: false,
  });
}

/** "Me" for the signed-in user, else the account name when it can be looked up. */
export function AssigneeLabel({
  id,
  me,
}: {
  id: string | null;
  me: Me | undefined;
}) {
  const users = useStaffUsers();
  if (!id) return <span className="text-muted-foreground">Unassigned</span>;
  if (me && id === me.id) return <>Me</>;
  const u = users.data?.find((x) => x.id === id);
  return u ? (
    <>{userName(u)}</>
  ) : (
    <span className="font-mono text-xs">{id.slice(0, 8)}…</span>
  );
}

/**
 * Counsellor picker: searchable list of staff accounts. Without permission to list accounts it offers only
 * "Me" (and keeps the current value).
 */
export function CounsellorSelect({
  value,
  onChange,
  me,
}: {
  value: string;
  onChange: (id: string) => void;
  me: Me | undefined;
}) {
  const [q, setQ] = useState("");
  const users = useStaffUsers(q.trim());
  const rows = (users.data ?? []).filter((u) => u.id !== me?.id);
  return (
    <div className="flex flex-col gap-1">
      {!users.isError && (
        <Input
          className="h-8"
          placeholder="Search staff account…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <select
        className="select select-sm h-8 w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Unassigned</option>
        {me && <option value={me.id}>Me ({me.username ?? "you"})</option>}
        {value && value !== me?.id && !rows.some((u) => u.id === value) && (
          <option value={value}>{value.slice(0, 8)}…</option>
        )}
        {rows.map((u) => (
          <option key={u.id} value={u.id}>
            {userName(u)}
          </option>
        ))}
      </select>
      {users.isError && (
        <p className="text-xs text-muted-foreground">
          You cannot list staff accounts; assign to yourself or leave it.
        </p>
      )}
    </div>
  );
}

// ---- dates ----

/** 1 January of this year and today (Asia/Dhaka), YYYY-MM-DD. */
export function thisYearRange(today: string): { from: string; to: string } {
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

/** Follow-up time is in the past. */
export const isOverdue = (iso: string | null | undefined) =>
  Boolean(iso && new Date(iso).getTime() < Date.now());

export const childNameOf = (a: {
  childFirstName: string;
  childLastName: string | null;
}) => [a.childFirstName, a.childLastName].filter(Boolean).join(" ");
