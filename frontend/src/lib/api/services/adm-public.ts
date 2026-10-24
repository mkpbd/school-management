import { client, unwrap } from "../client";
import type { Body } from "../types";

// ---- contract types (AdmissionUseCases.ts: GetAdmissionForm, StartApplication, GetDraftApplication) ----

export type PublicFormKind = "enquiry" | "application";

/** GET /adm/public/form: choices, a signed form token (send it back), captcha site key (null = no captcha). */
export interface AdmissionFormSetup {
  token: string;
  captchaSiteKey: string | null;
  campuses: Array<{
    id: string;
    code: string;
    nameEn: string;
    nameBn: string | null;
  }>;
  academicYears: Array<{
    id: string;
    code: string;
    startsOn: string;
    endsOn: string;
  }>;
  yearGroups: Array<{ id: string; code: string; nameEn: string }>;
  campaign: { code: string; name: string; campusId: string | null } | null;
}

export type PublicEnquiryBody = Body<"/api/v1/adm/public/enquiries", "post">;
export type PublicApplicationBody = Body<
  "/api/v1/adm/public/applications",
  "post"
>;
export type DraftApplicationBody = Body<
  "/api/v1/adm/public/applications/{token}",
  "put"
>;
/** First-touch campaign / UTM data sent with the website forms. */
export type AdmissionTracking = NonNullable<PublicEnquiryBody["tracking"]>;
export type ApplicationGuardian = PublicApplicationBody["guardians"][number];

export interface StartedApplication {
  status: "draft" | "submitted";
  /** null for a draft (and for a submission the server silently held back) */
  applicationNo: string | null;
  /** secret of the resume link /admissions/apply/<resumeToken> (drafts only) */
  resumeToken: string | null;
  resumeExpiresAt: string | null;
}

export interface SavedDraft {
  status: "draft" | "submitted";
  applicationNo: string | null;
}

/** Draft loaded from its resume link (tracking and spam data are not returned). */
export interface DraftApplication {
  id: string;
  status: string;
  campusId: string;
  academicYearId: string;
  yearGroupId: string;
  childFirstName: string;
  childLastName: string | null;
  childNameBn: string | null;
  childGender: "male" | "female";
  childDob: string;
  previousSchool: string | null;
  formData: {
    guardians?: ApplicationGuardian[];
    address?: string | null;
    medicalNotes?: string | null;
    answers?: Record<string, string>;
    locale?: "en" | "bn";
  };
  resumeExpiresAt: string | null;
  createdAt: string;
}

/**
 * Public website admission forms (AdmissionController /adm/public/*): no login, rate-limited per IP.
 * Load `setup` when a form opens and send its `token` back with the honeypot `website` (empty) and, when
 * `captchaSiteKey` is set, the Turnstile `captchaToken`.
 */
export const admissionForms = {
  publicForm: {
    /** Choices + signed form token; `campaign` is the ?campaign= code of the link (its name is shown). */
    setup: (form: PublicFormKind, campaign?: string) =>
      unwrap<AdmissionFormSetup>(
        client.GET("/api/v1/adm/public/form", {
          params: { query: { form, ...(campaign ? { campaign } : {}) } },
        }),
      ),

    /** Website enquiry (202). The answer is the same whatever the spam verdict. */
    enquire: (body: PublicEnquiryBody) =>
      unwrap<{ reference: string }>(
        client.POST("/api/v1/adm/public/enquiries", { body }),
      ),

    /** Online application: `draft: true` saves it and returns the secret resume token; otherwise submits. */
    apply: (body: PublicApplicationBody) =>
      unwrap<StartedApplication>(
        client.POST("/api/v1/adm/public/applications", { body }),
      ),

    /** Draft behind a resume link (404 DRAFT_NOT_FOUND when invalid, expired or already submitted). */
    draft: (token: string) =>
      unwrap<DraftApplication>(
        client.GET("/api/v1/adm/public/applications/{token}", {
          params: { path: { token } },
        }),
      ),

    /** Save the draft again (same link); `submit: true` submits it. */
    saveDraft: (token: string, body: DraftApplicationBody) =>
      unwrap<SavedDraft>(
        client.PUT("/api/v1/adm/public/applications/{token}", {
          params: { path: { token } },
          body,
        }),
      ),
  },
};
