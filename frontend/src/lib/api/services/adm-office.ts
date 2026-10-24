import { client, unwrap } from "../client";
import type { Body, Query } from "../types";

// Response shapes (backend/src/modules/adm/application/ports.ts, AdmissionUseCases.ts). Type aliases, so they are
// assignable to Row. Money is integer paisa; instants are ISO strings.

export type EnquiryStage =
  | "enquiry"
  | "visit_scheduled"
  | "visited"
  | "applied"
  | "test_scheduled"
  | "tested"
  | "offered"
  | "admitted"
  | "lost";

export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "fee_pending"
  | "under_review"
  | "test_scheduled"
  | "tested"
  | "shortlisted"
  | "waitlisted"
  | "offered"
  | "accepted"
  | "declined"
  | "enrolled"
  | "rejected"
  | "withdrawn"
  | "expired";

export type EnquiryRow = {
  id: string;
  enquiryNo: string | null;
  campusId: string;
  academicYearId: string;
  yearGroupId: string | null;
  sourceCode: string;
  campaignId: string | null;
  campaignCode: string | null;
  utm: Record<string, string> | null;
  referrer: string | null;
  landingUrl: string | null;
  childName: string;
  childDob: string | null;
  guardianName: string;
  phone: string;
  email: string | null;
  message: string | null;
  preferredContact: "phone" | "sms" | "email" | "whatsapp" | null;
  stage: EnquiryStage;
  lostReasonCode: string | null;
  assignedTo: string | null;
  nextFollowUpAt: string | null;
  isSpam: boolean;
  spamScore: number;
  spamReasons: string[];
  repeatCount: number;
  createdAt: string;
};

export type EnquiryActivityKind =
  "call" | "sms" | "email" | "visit" | "note" | "stage_change" | "task";

export type EnquiryActivity = {
  id: number;
  kind: EnquiryActivityKind;
  notes: string | null;
  dueAt: string | null;
  doneAt: string | null;
  actorId: string | null;
  createdAt: string;
};

export type ApplicationGuardian = {
  name: string;
  relationship: "father" | "mother" | "guardian" | "other";
  phone: string;
  email?: string;
  occupation?: string;
};

export type ApplicationRow = {
  id: string;
  applicationNo: string | null;
  campusId: string;
  academicYearId: string;
  yearGroupId: string;
  enquiryId: string | null;
  status: ApplicationStatus;
  childFirstName: string;
  childLastName: string | null;
  childNameBn: string | null;
  childGender: "male" | "female";
  childDob: string;
  previousSchool: string | null;
  /** guardians, address, medicalNotes, answers (as submitted). */
  formData: {
    guardians?: ApplicationGuardian[];
    address?: string;
    medicalNotes?: string;
    answers?: Record<string, string>;
    [key: string]: unknown;
  };
  guardianName: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  sourceCode: string | null;
  campaignId: string | null;
  utm: Record<string, string> | null;
  referrer: string | null;
  landingUrl: string | null;
  isSpam: boolean;
  spamScore: number;
  spamReasons: string[];
  submittedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  resumeExpiresAt: string | null;
};

export type CampaignChannel =
  | "website"
  | "facebook"
  | "google"
  | "instagram"
  | "youtube"
  | "qr"
  | "sms"
  | "email"
  | "event"
  | "referral"
  | "print"
  | "other";

export type CampaignRow = {
  id: string;
  campusId: string | null;
  code: string;
  name: string;
  channel: CampaignChannel | string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  landingPath: string;
  startsOn: string | null;
  endsOn: string | null;
  budgetPaisa: number | null;
  isActive: boolean;
  /** Tracked website link (`?campaign=CODE`) for ads and QR codes. */
  link: string;
};

export type EnquiryDetail = EnquiryRow & {
  activities: EnquiryActivity[];
  applications: ApplicationRow[];
  campaign: Omit<CampaignRow, "link"> | null;
};

export type ApplicationDetail = ApplicationRow & {
  campaign: Omit<CampaignRow, "link"> | null;
};

export type FunnelCounts = {
  enquiries: number;
  spam: number;
  applied: number;
  admitted: number;
  lost: number;
};

export type FunnelSourceRow = FunnelCounts & {
  sourceCode: string;
  campaignId: string | null;
  conversionPct: number | null;
};

export type FunnelCampaignRow = FunnelSourceRow & {
  code: string;
  name: string;
  costPerEnquiryPaisa: number | null;
};

export type FunnelReport = {
  from: string;
  to: string;
  bySource: FunnelSourceRow[];
  byCampaign: FunnelCampaignRow[];
  totals: FunnelCounts;
};

/**
 * Admission office (backend/src/modules/adm/presentation/AdmissionController.ts, staff routes): enquiry inbox and
 * pipeline with activity timeline, applications review, campaigns with tracked links, and the conversion funnel.
 */
export const admissionOffice = {
  enquiries: {
    /** Inbox of the active campus (spam hidden unless `spam: "true"`); newest first, limit / offset. */
    list: <T = EnquiryRow[]>(query?: Query<"/api/v1/adm/enquiries", "get">) =>
      unwrap<T>(client.GET("/api/v1/adm/enquiries", { params: { query } })),
    /** With the activity timeline, linked applications and campaign. */
    get: <T = EnquiryDetail>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/adm/enquiries/{id}", { params: { path: { id } } }),
      ),
    /** Phone / walk-in / social enquiry recorded by the office (assigned to you unless `assignedTo`). */
    create: <T = EnquiryRow>(body: Body<"/api/v1/adm/enquiries", "post">) =>
      unwrap<T>(client.POST("/api/v1/adm/enquiries", { body })),
    /** Assign a counsellor, next follow-up, stage (lost needs `lostReasonCode`), class, e-mail. */
    update: <T = EnquiryRow>(
      id: string,
      body: Body<"/api/v1/adm/enquiries/{id}", "patch">,
    ) =>
      unwrap<T>(
        client.PATCH("/api/v1/adm/enquiries/{id}", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Call note, SMS / e-mail, visit, note, or a task with `dueAt` (sets the next follow-up); answers the timeline. */
    addActivity: <T = EnquiryActivity[]>(
      id: string,
      body: Body<"/api/v1/adm/enquiries/{id}/activities", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/adm/enquiries/{id}/activities", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Flag as spam, or release a false positive into the inbox. */
    spam: <T = EnquiryRow>(id: string, isSpam: boolean) =>
      unwrap<T>(
        client.POST("/api/v1/adm/enquiries/{id}/spam", {
          params: { path: { id } },
          body: { isSpam },
        }),
      ),
  },
  applications: {
    /** Applications of the active campus (spam hidden unless `spam: "true"`). */
    list: <T = ApplicationRow[]>(
      query?: Query<"/api/v1/adm/applications", "get">,
    ) =>
      unwrap<T>(client.GET("/api/v1/adm/applications", { params: { query } })),
    /** With the submitted form (guardians, address, answers) and campaign. */
    get: <T = ApplicationDetail>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/adm/applications/{id}", {
          params: { path: { id } },
        }),
      ),
    /** Review: under review, shortlisted, waitlisted, rejected (note required), withdrawn. */
    setStatus: <T = ApplicationRow>(
      id: string,
      body: Body<"/api/v1/adm/applications/{id}/status", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/adm/applications/{id}/status", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Flag as spam, or release (a released submission is submitted now). */
    spam: <T = ApplicationRow>(id: string, isSpam: boolean) =>
      unwrap<T>(
        client.POST("/api/v1/adm/applications/{id}/spam", {
          params: { path: { id } },
          body: { isSpam },
        }),
      ),
  },
  campaigns: {
    /** Campaigns with their tracked link. */
    list: <T = CampaignRow[]>(query?: Query<"/api/v1/adm/campaigns", "get">) =>
      unwrap<T>(client.GET("/api/v1/adm/campaigns", { params: { query } })),
    /** Code (used in `?campaign=`), channel, optional UTM mapping, dates, budget. */
    create: <T = CampaignRow>(body: Body<"/api/v1/adm/campaigns", "post">) =>
      unwrap<T>(client.POST("/api/v1/adm/campaigns", { body })),
    /** Update or end (`isActive: false`) a campaign; the code cannot change. */
    update: <T = CampaignRow>(
      id: string,
      body: Body<"/api/v1/adm/campaigns/{id}", "patch">,
    ) =>
      unwrap<T>(
        client.PATCH("/api/v1/adm/campaigns/{id}", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  funnel: {
    /** Enquiries → applied → admitted per source and campaign, with conversion % and cost per enquiry. */
    get: <T = FunnelReport>(query: Query<"/api/v1/adm/funnel", "get">) =>
      unwrap<T>(client.GET("/api/v1/adm/funnel", { params: { query } })),
  },
};
