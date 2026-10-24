import { and, asc, between, desc, eq, gte, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  application,
  campaign,
  enquiry,
  enquiryActivity,
  webSubmission,
} from '../../../shared/infrastructure/db/schema/adm.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type {
  ActivityRow,
  AdmRepository,
  ApplicationRow,
  CampaignRow,
  EnquiryFilter,
  EnquiryRow,
  FunnelRow,
} from '../application/ports.js';

const campaignCols = {
  id: campaign.id,
  campusId: campaign.campusId,
  code: campaign.code,
  name: campaign.name,
  channel: campaign.channel,
  utmSource: campaign.utmSource,
  utmMedium: campaign.utmMedium,
  utmCampaign: campaign.utmCampaign,
  landingPath: campaign.landingPath,
  startsOn: campaign.startsOn,
  endsOn: campaign.endsOn,
  budgetPaisa: campaign.budgetPaisa,
  isActive: campaign.isActive,
};

const enquiryCols = {
  id: enquiry.id,
  enquiryNo: enquiry.enquiryNo,
  campusId: enquiry.campusId,
  academicYearId: enquiry.academicYearId,
  yearGroupId: enquiry.yearGroupId,
  sourceCode: enquiry.sourceCode,
  campaignId: enquiry.campaignId,
  campaignCode: enquiry.campaignCode,
  utm: enquiry.utm,
  referrer: enquiry.referrer,
  landingUrl: enquiry.landingUrl,
  childName: enquiry.childName,
  childDob: enquiry.childDob,
  guardianName: enquiry.guardianName,
  phone: enquiry.phone,
  email: enquiry.email,
  message: enquiry.message,
  preferredContact: enquiry.preferredContact,
  stage: enquiry.stage,
  lostReasonCode: enquiry.lostReasonCode,
  assignedTo: enquiry.assignedTo,
  nextFollowUpAt: enquiry.nextFollowUpAt,
  isSpam: enquiry.isSpam,
  spamScore: enquiry.spamScore,
  spamReasons: enquiry.spamReasons,
  repeatCount: enquiry.repeatCount,
  createdAt: enquiry.createdAt,
};

const applicationCols = {
  id: application.id,
  applicationNo: application.applicationNo,
  campusId: application.campusId,
  academicYearId: application.academicYearId,
  yearGroupId: application.yearGroupId,
  enquiryId: application.enquiryId,
  status: application.status,
  childFirstName: application.childFirstName,
  childLastName: application.childLastName,
  childNameBn: application.childNameBn,
  childGender: application.childGender,
  childDob: application.childDob,
  previousSchool: application.previousSchool,
  formData: application.formData,
  guardianName: application.guardianName,
  guardianPhone: application.guardianPhone,
  guardianEmail: application.guardianEmail,
  sourceCode: application.sourceCode,
  campaignId: application.campaignId,
  utm: application.utm,
  referrer: application.referrer,
  landingUrl: application.landingUrl,
  isSpam: application.isSpam,
  spamScore: application.spamScore,
  spamReasons: application.spamReasons,
  submittedAt: application.submittedAt,
  reviewNote: application.reviewNote,
  createdAt: application.createdAt,
  resumeExpiresAt: application.resumeExpiresAt,
};

/** Enquiries, activities, applications, campaigns and the web-submission log of ADM. */
export class DrizzleAdmRepository implements AdmRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  // ---------------- campaigns ----------------

  async campaignByCode(code: string): Promise<CampaignRow | null> {
    const [r] = await this.tx.select(campaignCols).from(campaign).where(eq(campaign.code, code));
    return (r as CampaignRow | undefined) ?? null;
  }

  async campaignByUtm(utmCampaign: string): Promise<CampaignRow | null> {
    const [r] = await this.tx
      .select(campaignCols)
      .from(campaign)
      .where(sql`lower(${campaign.utmCampaign}) = lower(${utmCampaign})`);
    return (r as CampaignRow | undefined) ?? null;
  }

  async campaign(id: string): Promise<CampaignRow | null> {
    const [r] = await this.tx.select(campaignCols).from(campaign).where(eq(campaign.id, id));
    return (r as CampaignRow | undefined) ?? null;
  }

  campaigns(f: { active?: boolean; campusId?: string | null }): Promise<CampaignRow[]> {
    const where: SQL[] = [];
    if (f.active !== undefined) where.push(eq(campaign.isActive, f.active));
    if (f.campusId) where.push(or(eq(campaign.campusId, f.campusId), sql`${campaign.campusId} IS NULL`)!);
    return this.tx
      .select(campaignCols)
      .from(campaign)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(campaign.isActive), asc(campaign.code)) as Promise<CampaignRow[]>;
  }

  async insertCampaign(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(campaign)
      .values(values as typeof campaign.$inferInsert)
      .returning({ id: campaign.id });
    return r!.id;
  }

  async updateCampaign(id: string, patch: Record<string, unknown>): Promise<void> {
    if (Object.keys(patch).length) await this.tx.update(campaign).set(patch).where(eq(campaign.id, id));
  }

  // ---------------- enquiries ----------------

  async insertEnquiry(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(enquiry)
      .values(values as typeof enquiry.$inferInsert)
      .returning({ id: enquiry.id });
    return r!.id;
  }

  async enquiry(id: string, lock = false): Promise<EnquiryRow | null> {
    const q = this.tx.select(enquiryCols).from(enquiry).where(eq(enquiry.id, id));
    const [r] = lock ? await q.for('update') : await q;
    return (r as EnquiryRow | undefined) ?? null;
  }

  enquiries(f: EnquiryFilter): Promise<EnquiryRow[]> {
    const where: SQL[] = [];
    if (f.campusId) where.push(eq(enquiry.campusId, f.campusId));
    if (f.academicYearId) where.push(eq(enquiry.academicYearId, f.academicYearId));
    if (f.stage) where.push(eq(enquiry.stage, f.stage as EnquiryRow['stage']));
    if (f.sourceCode) where.push(eq(enquiry.sourceCode, f.sourceCode));
    if (f.campaignId) where.push(eq(enquiry.campaignId, f.campaignId));
    if (f.assignedTo) where.push(eq(enquiry.assignedTo, f.assignedTo));
    if (f.spam !== undefined) where.push(eq(enquiry.isSpam, f.spam));
    if (f.from && f.to) where.push(between(enquiry.createdAt, f.from, f.to));
    else if (f.from) where.push(gte(enquiry.createdAt, f.from));
    if (f.q) {
      const like = `%${f.q}%`;
      where.push(
        or(
          ilike(enquiry.childName, like),
          ilike(enquiry.guardianName, like),
          ilike(enquiry.phone, like),
          ilike(enquiry.enquiryNo, like),
        )!,
      );
    }
    return this.tx
      .select(enquiryCols)
      .from(enquiry)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(enquiry.createdAt))
      .limit(f.limit)
      .offset(f.offset) as Promise<EnquiryRow[]>;
  }

  async updateEnquiry(id: string, patch: Record<string, unknown>): Promise<void> {
    if (Object.keys(patch).length) await this.tx.update(enquiry).set(patch).where(eq(enquiry.id, id));
  }

  recentByPhone(phone: string, since: Date): Promise<EnquiryRow[]> {
    return this.tx
      .select(enquiryCols)
      .from(enquiry)
      .where(and(eq(enquiry.phone, phone), gte(enquiry.createdAt, since), eq(enquiry.isSpam, false)))
      .orderBy(desc(enquiry.createdAt))
      .limit(20) as Promise<EnquiryRow[]>;
  }

  async insertActivity(values: Record<string, unknown>): Promise<void> {
    await this.tx.insert(enquiryActivity).values(values as typeof enquiryActivity.$inferInsert);
  }

  async activities(enquiryId: string): Promise<ActivityRow[]> {
    const rows = await this.tx
      .select({
        id: enquiryActivity.id,
        kind: enquiryActivity.kind,
        notes: enquiryActivity.notes,
        dueAt: enquiryActivity.dueAt,
        doneAt: enquiryActivity.doneAt,
        actorId: enquiryActivity.actorId,
        createdAt: enquiryActivity.createdAt,
      })
      .from(enquiryActivity)
      .innerJoin(enquiry, eq(enquiry.id, enquiryActivity.enquiryId))
      .where(eq(enquiryActivity.enquiryId, enquiryId))
      .orderBy(desc(enquiryActivity.createdAt), desc(enquiryActivity.id));
    return rows as ActivityRow[];
  }

  // ---------------- applications ----------------

  async insertApplication(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(application)
      .values(values as typeof application.$inferInsert)
      .returning({ id: application.id });
    return r!.id;
  }

  async application(id: string, lock = false): Promise<ApplicationRow | null> {
    const q = this.tx.select(applicationCols).from(application).where(eq(application.id, id));
    const [r] = lock ? await q.for('update') : await q;
    return (r as ApplicationRow | undefined) ?? null;
  }

  async applicationByResumeHash(hash: Buffer, lock = false): Promise<ApplicationRow | null> {
    const q = this.tx.select(applicationCols).from(application).where(eq(application.resumeTokenHash, hash));
    const [r] = lock ? await q.for('update') : await q;
    return (r as ApplicationRow | undefined) ?? null;
  }

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
  }): Promise<ApplicationRow[]> {
    const where: SQL[] = [];
    if (f.campusId) where.push(eq(application.campusId, f.campusId));
    if (f.academicYearId) where.push(eq(application.academicYearId, f.academicYearId));
    if (f.yearGroupId) where.push(eq(application.yearGroupId, f.yearGroupId));
    if (f.status) where.push(eq(application.status, f.status as ApplicationRow['status']));
    if (f.spam !== undefined) where.push(eq(application.isSpam, f.spam));
    if (f.enquiryId) where.push(eq(application.enquiryId, f.enquiryId));
    if (f.q) {
      const like = `%${f.q}%`;
      where.push(
        or(
          ilike(application.childFirstName, like),
          ilike(application.childLastName, like),
          ilike(application.guardianName, like),
          ilike(application.guardianPhone, like),
          ilike(application.applicationNo, like),
        )!,
      );
    }
    return this.tx
      .select(applicationCols)
      .from(application)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(application.createdAt))
      .limit(f.limit)
      .offset(f.offset) as Promise<ApplicationRow[]>;
  }

  async updateApplication(id: string, patch: Record<string, unknown>): Promise<void> {
    if (Object.keys(patch).length) await this.tx.update(application).set(patch).where(eq(application.id, id));
  }

  // ---------------- log and funnel ----------------

  async logSubmission(values: Record<string, unknown>): Promise<void> {
    await this.tx.insert(webSubmission).values(values as typeof webSubmission.$inferInsert);
  }

  async funnel(f: { from: Date; to: Date; campusId?: string | null }): Promise<FunnelRow[]> {
    const applied = ['applied', 'test_scheduled', 'tested', 'offered', 'admitted'];
    const rows = await this.tx
      .select({
        sourceCode: enquiry.sourceCode,
        campaignId: enquiry.campaignId,
        enquiries: sql<number>`count(*) FILTER (WHERE NOT ${enquiry.isSpam})::int`,
        spam: sql<number>`count(*) FILTER (WHERE ${enquiry.isSpam})::int`,
        applied: sql<number>`count(*) FILTER (WHERE NOT ${enquiry.isSpam} AND ${inArray(enquiry.stage, applied as never[])})::int`,
        admitted: sql<number>`count(*) FILTER (WHERE NOT ${enquiry.isSpam} AND ${enquiry.stage} = 'admitted')::int`,
        lost: sql<number>`count(*) FILTER (WHERE NOT ${enquiry.isSpam} AND ${enquiry.stage} = 'lost')::int`,
      })
      .from(enquiry)
      .where(and(between(enquiry.createdAt, f.from, f.to), f.campusId ? eq(enquiry.campusId, f.campusId) : undefined))
      .groupBy(enquiry.sourceCode, enquiry.campaignId);
    return rows;
  }
}
