export type EnquiryStage =
  'enquiry' | 'visit_scheduled' | 'visited' | 'applied' | 'test_scheduled' | 'tested' | 'offered' | 'admitted' | 'lost';

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'fee_pending'
  | 'under_review'
  | 'test_scheduled'
  | 'tested'
  | 'shortlisted'
  | 'waitlisted'
  | 'offered'
  | 'accepted'
  | 'declined'
  | 'enrolled'
  | 'rejected'
  | 'withdrawn'
  | 'expired';

export interface EnquiryRow {
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
  preferredContact: 'phone' | 'sms' | 'email' | 'whatsapp' | null;
  stage: EnquiryStage;
  lostReasonCode: string | null;
  assignedTo: string | null;
  nextFollowUpAt: Date | null;
  isSpam: boolean;
  spamScore: number;
  spamReasons: string[];
  repeatCount: number;
  createdAt: Date;
}

export interface ActivityRow {
  id: number;
  kind: 'call' | 'sms' | 'email' | 'visit' | 'note' | 'stage_change' | 'task';
  notes: string | null;
  dueAt: Date | null;
  doneAt: Date | null;
  actorId: string | null;
  createdAt: Date;
}

export interface ApplicationRow {
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
  childGender: 'male' | 'female';
  childDob: string;
  previousSchool: string | null;
  formData: Record<string, unknown>;
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
  submittedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
  resumeExpiresAt: Date | null;
}

export interface CampaignRow {
  id: string;
  campusId: string | null;
  code: string;
  name: string;
  channel: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  landingPath: string;
  startsOn: string | null;
  endsOn: string | null;
  budgetPaisa: number | null;
  isActive: boolean;
}

export interface FunnelRow {
  sourceCode: string;
  campaignId: string | null;
  enquiries: number;
  spam: number;
  applied: number;
  admitted: number;
  lost: number;
}

export interface EnquiryFilter {
  campusId?: string | null;
  academicYearId?: string;
  stage?: string;
  sourceCode?: string;
  campaignId?: string;
  assignedTo?: string;
  spam?: boolean;
  q?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface AdmRepository {
  campaignByCode(code: string): Promise<CampaignRow | null>;
  campaignByUtm(utmCampaign: string): Promise<CampaignRow | null>;
  campaign(id: string): Promise<CampaignRow | null>;
  campaigns(f: { active?: boolean; campusId?: string | null }): Promise<CampaignRow[]>;
  insertCampaign(values: Record<string, unknown>): Promise<string>;
  updateCampaign(id: string, patch: Record<string, unknown>): Promise<void>;

  insertEnquiry(values: Record<string, unknown>): Promise<string>;
  enquiry(id: string, lock?: boolean): Promise<EnquiryRow | null>;
  enquiries(f: EnquiryFilter): Promise<EnquiryRow[]>;
  updateEnquiry(id: string, patch: Record<string, unknown>): Promise<void>;
  /** open-ish enquiries of a phone number since a date (newest first), any spam flag excluded */
  recentByPhone(phone: string, since: Date): Promise<EnquiryRow[]>;
  insertActivity(values: Record<string, unknown>): Promise<void>;
  activities(enquiryId: string): Promise<ActivityRow[]>;

  insertApplication(values: Record<string, unknown>): Promise<string>;
  application(id: string, lock?: boolean): Promise<ApplicationRow | null>;
  applicationByResumeHash(hash: Buffer, lock?: boolean): Promise<ApplicationRow | null>;
  applications(f: {
    campusId?: string | null;
    academicYearId?: string;
    yearGroupId?: string;
    status?: string;
    spam?: boolean;
    enquiryId?: string;
    q?: string;
    limit: number;
    offset: number;
  }): Promise<ApplicationRow[]>;
  updateApplication(id: string, patch: Record<string, unknown>): Promise<void>;

  logSubmission(values: Record<string, unknown>): Promise<void>;
  funnel(f: { from: Date; to: Date; campusId?: string | null }): Promise<FunnelRow[]>;
}

/** Signed, time-stamped token handed out with the form (proves the form was loaded, and how long ago). */
export interface FormTokens {
  issue(form: 'enquiry' | 'application'): string;
  verify(token: string | undefined, form: 'enquiry' | 'application'): { valid: boolean; ageSec: number | null };
  /** random secret for resuming a draft, and its stored hash */
  resumeSecret(): { token: string; hash: Buffer };
  hashResume(token: string): Buffer;
}

/** Human check (Cloudflare Turnstile when configured). `siteKey` null = not configured, verify returns null. */
export interface CaptchaVerifier {
  readonly siteKey: string | null;
  verify(token: string | undefined, ip: string | undefined): Promise<boolean | null>;
}
