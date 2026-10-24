"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleIcon,
  FootprintsIcon,
  MailIcon,
  MessageSquareIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  ShieldCheckIcon,
  ShieldXIcon,
  StickyNoteIcon,
  UserCheckIcon,
  WorkflowIcon,
} from "lucide-react";
import { useRouter, useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  ActivityDialog,
  ENQUIRY_INVALIDATE,
  EnquiryEditDialog,
  LostDialog,
} from "@/components/adm/enquiry";
import {
  ApplicationStatusBadge,
  AssigneeLabel,
  BackLink,
  childNameOf,
  CounsellorSelect,
  Field,
  fromLocalInput,
  isOverdue,
  SpamAlert,
  SpamBadge,
  StageBadge,
  STAGES,
  toLocalInput,
  TrackingList,
  useLostReasons,
} from "@/components/adm/shared";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel } from "@/components/crud/fields";
import {
  ConfirmButton,
  DetailList,
  Empty,
  ErrorAlert,
  Loading,
  PageHeader,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type Me } from "@/lib/api";
import type {
  ApplicationRow,
  EnquiryActivity,
  EnquiryActivityKind,
  EnquiryDetail,
  EnquiryStage,
} from "@/lib/api/services/adm-office";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

type ActivityKind = Exclude<EnquiryActivityKind, "stage_change">;

const KIND_ICON: Record<EnquiryActivityKind, ReactNode> = {
  call: <PhoneIcon className="size-4" />,
  sms: <MessageSquareIcon className="size-4" />,
  email: <MailIcon className="size-4" />,
  visit: <FootprintsIcon className="size-4" />,
  note: <StickyNoteIcon className="size-4" />,
  task: <CalendarClockIcon className="size-4" />,
  stage_change: <WorkflowIcon className="size-4" />,
};

const ADD_BUTTONS: Array<[ActivityKind, string]> = [
  ["call", "Call note"],
  ["sms", "SMS"],
  ["email", "E-mail"],
  ["visit", "Visit"],
  ["note", "Note"],
  ["task", "Task"],
];

export default function EnquiryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: me } = useMe();
  const [editing, setEditing] = useState(false);
  const [losing, setLosing] = useState(false);
  const [adding, setAdding] = useState<ActivityKind | null>(null);

  const enquiry = useQuery({
    queryKey: ["adm.enquiry", id],
    queryFn: () => api.adm.enquiries.get(id),
  });
  const spam = useAction(
    (isSpam: boolean) => api.adm.enquiries.spam(id, isSpam),
    {
      success: (r) =>
        r.data.isSpam ? "Moved to spam" : "Released into the inbox",
      invalidate: ENQUIRY_INVALIDATE,
    },
  );
  const setStage = useAction(
    (stage: EnquiryStage) => api.adm.enquiries.update(id, { stage }),
    {
      success: (r) => `Stage: ${humanize(r.data.stage)}`,
      invalidate: ENQUIRY_INVALIDATE,
    },
  );

  if (enquiry.isPending) return <Loading />;
  if (enquiry.isError) return <ErrorAlert error={enquiry.error} />;
  const e = enquiry.data.data;
  const canEdit = can(me, "adm.enquiry.edit");
  const canApps = can(me, "adm.application.view");

  return (
    <>
      <BackLink href="/dashboard/admissions/enquiries">Enquiries</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {e.enquiryNo && <span className="font-mono">{e.enquiryNo}</span>}
            {e.childName} <StageBadge stage={e.stage} />
            {e.isSpam && <SpamBadge score={e.spamScore} />}
          </span>
        }
        description={`${e.guardianName} · ${e.phone} · received ${formatDateTime(e.createdAt)}`}
        actions={
          canEdit && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
              >
                <PencilIcon /> Edit
              </Button>
              {!e.isSpam && (
                <ConfirmButton
                  destructive
                  title="Mark as spam?"
                  description="It leaves the inbox and stops counting in the funnel. You can release it later from the Spam tab."
                  confirmLabel="Mark as spam"
                  onConfirm={() => spam.mutateAsync(true)}
                >
                  <ShieldXIcon /> Mark as spam
                </ConfirmButton>
              )}
            </>
          )
        }
      />

      <SpamAlert
        isSpam={e.isSpam}
        score={e.spamScore}
        reasons={e.spamReasons}
        action={
          e.isSpam &&
          canEdit && (
            <Button
              size="sm"
              variant="outline"
              disabled={spam.isPending}
              onClick={() => spam.mutate(false)}
            >
              <ShieldCheckIcon /> Not spam
            </Button>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  ["Child", e.childName],
                  ["Date of birth", formatDate(e.childDob)],
                  [
                    "Class",
                    <RefLabel
                      key="c"
                      source={refs.yearGroups}
                      id={e.yearGroupId}
                    />,
                  ],
                  ["Guardian", e.guardianName],
                  [
                    "Phone",
                    <a key="p" className="link font-mono" href={`tel:${e.phone}`}>
                      {e.phone}
                    </a>,
                  ],
                  [
                    "E-mail",
                    e.email ? (
                      <a key="m" className="link" href={`mailto:${e.email}`}>
                        {e.email}
                      </a>
                    ) : (
                      "—"
                    ),
                  ],
                  ["Preferred contact", humanize(e.preferredContact)],
                  [
                    "Campus",
                    <RefLabel key="cp" source={refs.campuses} id={e.campusId} />,
                  ],
                  [
                    "Academic year",
                    <RefLabel
                      key="y"
                      source={refs.academicYears}
                      id={e.academicYearId}
                    />,
                  ],
                  [
                    "Repeat enquiries",
                    e.repeatCount ? String(e.repeatCount) : "—",
                  ],
                ]}
              />
              {e.message && (
                <div className="mt-4">
                  <div className="text-xs text-muted-foreground">Message</div>
                  <p className="text-sm whitespace-pre-line">{e.message}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tracking</CardTitle>
              <CardDescription>
                Where the lead came from (campaign link, UTM tags, referring
                site).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TrackingList
                source={e.sourceCode}
                campaign={
                  e.campaign
                    ? `${e.campaign.name} (${e.campaign.code})`
                    : e.campaignCode
                }
                utm={e.utm}
                referrer={e.referrer}
                landingUrl={e.landingUrl}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
              <CardDescription>
                Calls, messages, visits, tasks and stage changes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  {ADD_BUTTONS.map(([k, label]) => (
                    <Button
                      key={k}
                      size="xs"
                      variant="outline"
                      onClick={() => setAdding(k)}
                    >
                      <PlusIcon /> {label}
                    </Button>
                  ))}
                </div>
              )}
              <Timeline activities={e.activities} me={me} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <StageStepper stage={e.stage} />
              {e.stage === "lost" && (
                <LostReason code={e.lostReasonCode} />
              )}
              {canEdit ? (
                <Field label="Stage">
                  <select
                    className="select select-sm h-8 w-full"
                    value={e.stage}
                    disabled={setStage.isPending}
                    onChange={(ev) => {
                      const next = ev.target.value as EnquiryStage;
                      if (next === "lost") setLosing(true);
                      else setStage.mutate(next);
                    }}
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {humanize(s)}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {canEdit ? (
                <AssignForm key={e.assignedTo ?? ""} enquiry={e} me={me} />
              ) : (
                <DetailList
                  items={[
                    [
                      "Counsellor",
                      <AssigneeLabel key="a" id={e.assignedTo} me={me} />,
                    ],
                  ]}
                />
              )}
              {canEdit ? (
                <FollowUpForm key={e.nextFollowUpAt ?? ""} enquiry={e} />
              ) : (
                <DetailList
                  items={[
                    ["Next follow-up", formatDateTime(e.nextFollowUpAt)],
                  ]}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Applications</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable<ApplicationRow>
                rows={e.applications}
                empty="No application yet."
                onRowClick={
                  canApps
                    ? (a) =>
                        router.push(`/dashboard/admissions/applications/${a.id}`)
                    : undefined
                }
                columns={[
                  {
                    key: "applicationNo",
                    label: "No",
                    render: (a) => (
                      <span className="font-mono text-xs">
                        {a.applicationNo ?? "draft"}
                      </span>
                    ),
                  },
                  {
                    key: "child",
                    label: "Child",
                    render: (a) => childNameOf(a),
                  },
                  {
                    key: "status",
                    label: "Status",
                    render: (a) => <ApplicationStatusBadge status={a.status} />,
                  },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <EnquiryEditDialog
        enquiry={e}
        open={editing}
        onOpenChange={setEditing}
      />
      <LostDialog enquiry={e} open={losing} onOpenChange={setLosing} />
      <ActivityDialog
        enquiry={e}
        kind={adding ?? "call"}
        open={adding !== null}
        onOpenChange={(o) => !o && setAdding(null)}
      />
    </>
  );
}

/** enquiry → … → admitted as steps (lost shown apart). */
function StageStepper({ stage }: { stage: EnquiryStage }) {
  const steps = STAGES.filter((s) => s !== "lost");
  const at = steps.indexOf(stage);
  return (
    <ul className="steps steps-vertical w-full text-xs">
      {steps.map((s, i) => (
        <li
          key={s}
          className={`step ${i <= at ? "step-primary" : ""} ${stage === "lost" ? "opacity-50" : ""}`}
        >
          <span className={s === stage ? "font-semibold" : undefined}>
            {humanize(s)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function LostReason({ code }: { code: string | null }) {
  const reasons = useLostReasons();
  return (
    <div role="status" className="alert alert-error alert-soft text-sm">
      Lost: {reasons.find((r) => r.code === code)?.label ?? humanize(code)}
    </div>
  );
}

function AssignForm({ enquiry, me }: { enquiry: EnquiryDetail; me: Me | undefined }) {
  const [value, setValue] = useState(enquiry.assignedTo ?? "");
  const assign = useAction(
    (assignedTo: string | null) =>
      api.adm.enquiries.update(enquiry.id, { assignedTo }),
    { success: "Counsellor assigned", invalidate: ENQUIRY_INVALIDATE },
  );
  const changed = value !== (enquiry.assignedTo ?? "");
  return (
    <Field label="Counsellor">
      <CounsellorSelect value={value} onChange={setValue} me={me} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          disabled={!changed || assign.isPending}
          onClick={() => assign.mutate(value || null)}
        >
          Save
        </Button>
        {me && enquiry.assignedTo !== me.id && (
          <Button
            size="xs"
            variant="outline"
            disabled={assign.isPending}
            onClick={() => assign.mutate(me.id)}
          >
            <UserCheckIcon /> Assign to me
          </Button>
        )}
      </div>
    </Field>
  );
}

function FollowUpForm({ enquiry }: { enquiry: EnquiryDetail }) {
  const [value, setValue] = useState(toLocalInput(enquiry.nextFollowUpAt));
  const save = useAction(
    (nextFollowUpAt: string | null) =>
      api.adm.enquiries.update(enquiry.id, { nextFollowUpAt }),
    { success: "Follow-up saved", invalidate: ENQUIRY_INVALIDATE },
  );
  const overdue = isOverdue(enquiry.nextFollowUpAt);
  return (
    <Field
      label="Next follow-up"
      help={
        overdue ? (
          <span className="font-medium text-error">Overdue</span>
        ) : undefined
      }
    >
      <Input
        type="datetime-local"
        className={overdue ? "border-error" : undefined}
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          disabled={
            !value ||
            value === toLocalInput(enquiry.nextFollowUpAt) ||
            save.isPending
          }
          onClick={() => save.mutate(fromLocalInput(value) ?? null)}
        >
          Save
        </Button>
        {enquiry.nextFollowUpAt && (
          <Button
            size="xs"
            variant="outline"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            Clear
          </Button>
        )}
      </div>
    </Field>
  );
}

function Timeline({
  activities,
  me,
}: {
  activities: EnquiryActivity[];
  me: Me | undefined;
}) {
  if (!activities.length) return <Empty>No activity yet.</Empty>;
  const sorted = [...activities].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return (
    <ul className="space-y-3">
      {sorted.map((a) => (
        <li key={a.id} className="flex gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            {KIND_ICON[a.kind]}
          </div>
          <div className="min-w-0 flex-1 border-b pb-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">
                {a.kind === "sms"
                  ? "SMS"
                  : a.kind === "email"
                    ? "E-mail"
                    : humanize(a.kind)}
              </span>
              {a.kind === "task" && a.dueAt && (
                <span
                  className={`flex items-center gap-1 text-xs ${
                    !a.doneAt && isOverdue(a.dueAt)
                      ? "font-medium text-error"
                      : "text-muted-foreground"
                  }`}
                >
                  {a.doneAt ? (
                    <CheckCircle2Icon className="size-3 text-success" />
                  ) : (
                    <CircleIcon className="size-3" />
                  )}
                  due {formatDateTime(a.dueAt)}
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {formatDateTime(a.createdAt)}
                {a.actorId && (
                  <>
                    {" · "}
                    <AssigneeLabel id={a.actorId} me={me} />
                  </>
                )}
              </span>
            </div>
            {a.notes && (
              <p className="mt-1 text-sm whitespace-pre-line">{a.notes}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
