"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BanIcon,
  ClockIcon,
  EyeIcon,
  ShieldCheckIcon,
  ShieldXIcon,
  StarIcon,
  Undo2Icon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  APPLICATION_INVALIDATE,
  ReviewDialog,
} from "@/components/adm/application";
import {
  ApplicationStatusBadge,
  BackLink,
  childNameOf,
  REVIEWABLE,
  SpamAlert,
  SpamBadge,
  TrackingList,
  type ReviewStatus,
} from "@/components/adm/shared";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel } from "@/components/crud/fields";
import {
  ConfirmButton,
  DetailList,
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
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { ApplicationGuardian } from "@/lib/api/services/adm-office";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

const ACTIONS: Array<[ReviewStatus, string, ReactNode]> = [
  ["under_review", "Under review", <EyeIcon key="r" />],
  ["shortlisted", "Shortlist", <StarIcon key="s" />],
  ["waitlisted", "Waitlist", <ClockIcon key="w" />],
  ["rejected", "Reject", <BanIcon key="x" />],
  ["withdrawn", "Withdrawn", <Undo2Icon key="u" />],
];

export default function ApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const [reviewing, setReviewing] = useState<ReviewStatus | null>(null);
  const app = useQuery({
    queryKey: ["adm.application", id],
    queryFn: () => api.adm.applications.get(id),
  });
  const spam = useAction(
    (isSpam: boolean) => api.adm.applications.spam(id, isSpam),
    {
      success: (r) => (r.data.isSpam ? "Moved to spam" : "Released from spam"),
      invalidate: APPLICATION_INVALIDATE,
    },
  );

  if (app.isPending) return <Loading />;
  if (app.isError) return <ErrorAlert error={app.error} />;
  const a = app.data.data;
  const canEdit = can(me, "adm.application.edit");
  const reviewable = REVIEWABLE.includes(a.status) && !a.isSpam;
  const guardians: ApplicationGuardian[] = Array.isArray(a.formData.guardians)
    ? a.formData.guardians
    : [];
  const answers = Object.entries(a.formData.answers ?? {});

  return (
    <>
      <BackLink href="/dashboard/admissions/applications">
        Applications
      </BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {a.applicationNo && (
              <span className="font-mono">{a.applicationNo}</span>
            )}
            {childNameOf(a)} <ApplicationStatusBadge status={a.status} />
            {a.isSpam && <SpamBadge score={a.spamScore} />}
          </span>
        }
        description={
          a.submittedAt
            ? `Submitted ${formatDateTime(a.submittedAt)}`
            : `Started ${formatDateTime(a.createdAt)} (not submitted)`
        }
        actions={
          canEdit && (
            <>
              {reviewable &&
                ACTIONS.filter(([s]) => s !== a.status).map(
                  ([s, label, icon]) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={s === "shortlisted" ? "default" : "outline"}
                      onClick={() => setReviewing(s)}
                    >
                      {icon} {label}
                    </Button>
                  ),
                )}
              {!a.isSpam && (
                <ConfirmButton
                  destructive
                  title="Mark as spam?"
                  description="It leaves the application list. You can release it later from the Spam tab."
                  confirmLabel="Mark as spam"
                  onConfirm={() => spam.mutateAsync(true)}
                >
                  <ShieldXIcon /> Spam
                </ConfirmButton>
              )}
            </>
          )
        }
      />

      <SpamAlert
        isSpam={a.isSpam}
        score={a.spamScore}
        reasons={a.spamReasons}
        action={
          a.isSpam &&
          canEdit && (
            <ConfirmButton
              title="Not spam?"
              description="The application returns to the list; one that was being submitted is submitted now (number and acknowledgement to the guardian)."
              confirmLabel="Release"
              onConfirm={() => spam.mutateAsync(false)}
            >
              <ShieldCheckIcon /> Not spam
            </ConfirmButton>
          )
        }
      />

      {a.reviewNote && (
        <div role="status" className="alert alert-info alert-soft mb-4 text-sm">
          <span>
            <span className="font-medium">Review note:</span> {a.reviewNote}
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Child</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                ["Name", childNameOf(a)],
                ["Name (Bangla)", a.childNameBn],
                ["Gender", humanize(a.childGender)],
                ["Date of birth", formatDate(a.childDob)],
                [
                  "Class",
                  <RefLabel
                    key="c"
                    source={refs.yearGroups}
                    id={a.yearGroupId}
                  />,
                ],
                [
                  "Academic year",
                  <RefLabel
                    key="y"
                    source={refs.academicYears}
                    id={a.academicYearId}
                  />,
                ],
                [
                  "Campus",
                  <RefLabel key="cp" source={refs.campuses} id={a.campusId} />,
                ],
                ["Previous school", a.previousSchool],
                [
                  "Enquiry",
                  a.enquiryId ? (
                    <Link
                      key="e"
                      className="link"
                      href={`/dashboard/admissions/enquiries/${a.enquiryId}`}
                    >
                      Open enquiry
                    </Link>
                  ) : (
                    "—"
                  ),
                ],
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Address & medical</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Address</div>
              <p className="whitespace-pre-line">{a.formData.address || "—"}</p>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Medical notes</div>
              <p className="whitespace-pre-line">
                {a.formData.medicalNotes || "—"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Parents / guardians</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable<ApplicationGuardian>
              rows={guardians}
              rowKey={(g, i) => `${g.phone}-${i}`}
              empty={
                a.guardianName
                  ? `${a.guardianName} · ${a.guardianPhone ?? ""}`
                  : "No guardian on the form."
              }
              columns={[
                { key: "name", label: "Name" },
                { key: "relationship", label: "Relationship", type: "enum" },
                {
                  key: "phone",
                  label: "Phone",
                  render: (g) => (
                    <a
                      className="link font-mono text-xs"
                      href={`tel:${g.phone}`}
                    >
                      {g.phone}
                    </a>
                  ),
                },
                { key: "email", label: "E-mail" },
                { key: "occupation", label: "Occupation", type: "enum" },
              ]}
            />
          </CardContent>
        </Card>

        {answers.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Answers</CardTitle>
              <CardDescription>
                Extra questions on the application form.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DetailList
                items={answers.map(([k, v]) => [
                  humanize(k),
                  <span key={k} className="whitespace-pre-line">
                    {v}
                  </span>,
                ])}
              />
            </CardContent>
          </Card>
        )}

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Tracking</CardTitle>
          </CardHeader>
          <CardContent>
            <TrackingList
              source={a.sourceCode}
              campaign={
                a.campaign ? `${a.campaign.name} (${a.campaign.code})` : null
              }
              utm={a.utm}
              referrer={a.referrer}
              landingUrl={a.landingUrl}
            />
          </CardContent>
        </Card>
      </div>

      <ReviewDialog
        application={a}
        status={reviewing}
        onOpenChange={(o) => !o && setReviewing(null)}
      />
    </>
  );
}
