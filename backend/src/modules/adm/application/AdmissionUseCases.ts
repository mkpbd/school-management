import type { EventPublisher, NumberAllocator, TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { ConflictError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { AcaModuleApi } from '../../aca/public-api/AcaModuleApi.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import {
  campaignLink,
  classifySource,
  isRepeatEnquiry,
  isSpam,
  scoreSubmission,
  utmOf,
  type Tracking,
} from '../domain/webForms.js';
import type {
  ActivityRow,
  AdmRepository,
  ApplicationRow,
  ApplicationStatus,
  CampaignRow,
  CaptchaVerifier,
  EnquiryFilter,
  EnquiryRow,
  EnquiryStage,
  FormTokens,
  FunnelRow,
} from './ports.js';

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  admRepo: AdmRepository;
  scopePolicy: ScopePolicy;
  numbers: NumberAllocator;
  outbox: EventPublisher;
  coreApi: CoreModuleApi;
  acaApi: AcaModuleApi;
  formTokens: FormTokens;
  captcha: CaptchaVerifier;
  config: { WEB_BASE_URL: string };
}

/** Who posted a public form (from the HTTP request). */
export interface SubmitterMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface PublicFormGuard {
  token?: string;
  /** honeypot: must stay empty */
  website?: string;
  captchaToken?: string;
}

const RESUME_DAYS = 30;
const trim = (s: string | undefined | null, max: number) => (s ? s.trim().slice(0, max) || null : null);

async function settings(d: Deps) {
  return {
    threshold: (await d.coreApi.getSetting<number>('adm.spam_threshold')) ?? 50,
    windowDays: (await d.coreApi.getSetting<number>('adm.duplicate_window_days')) ?? 30,
    minSeconds: (await d.coreApi.getSetting<number>('adm.form_min_seconds')) ?? 4,
  };
}

/** Campaign by its code (QR / link), else by utm_campaign; only active and within its dates. */
async function resolveCampaign(d: Deps, t: Tracking): Promise<CampaignRow | null> {
  const c =
    (t.campaign ? await d.admRepo.campaignByCode(t.campaign.trim().toUpperCase()) : null) ??
    (t.utmCampaign ? await d.admRepo.campaignByUtm(t.utmCampaign.trim()) : null);
  if (!c || !c.isActive) return null;
  const today = LocalDate.today(d.clock).iso;
  if ((c.startsOn && today < c.startsOn) || (c.endsOn && today > c.endsOn)) return null;
  return c;
}

/** The campus / year / class chosen on a public form must exist and be open for admission. */
async function assertChoice(d: Deps, campusId: string, academicYearId: string, yearGroupId: string | undefined) {
  if (!(await d.coreApi.getCampus(campusId))) throw new InvariantError('CAMPUS_INVALID', 'Choose a campus');
  const year = await d.coreApi.getYear(academicYearId);
  if (!year || !['planned', 'open'].includes(year.status) || year.endsOn < LocalDate.today(d.clock).iso)
    throw new InvariantError('YEAR_NOT_OPEN', 'Admission is not open for that academic year');
  if (yearGroupId && !(await d.acaApi.yearGroup(yearGroupId)))
    throw new InvariantError('CLASS_INVALID', 'Choose a class');
}

async function guardCheck(
  d: Deps,
  form: 'enquiry' | 'application',
  g: PublicFormGuard,
  meta: SubmitterMeta,
  fields: { names: string[]; message?: string; email?: string },
) {
  const s = await settings(d);
  const spam = scoreSubmission({
    honeypot: g.website,
    token: d.formTokens.verify(g.token, form),
    minSeconds: s.minSeconds,
    captcha: await d.captcha.verify(g.captchaToken, meta.ip),
    names: fields.names,
    message: fields.message,
    email: fields.email,
  });
  return { ...spam, spam: isSpam(spam.score, s.threshold), windowDays: s.windowDays };
}

// ------------------------------------------------------------------------------------------------------------------
// Public (website): form setup, enquiry, application with draft-save
// ------------------------------------------------------------------------------------------------------------------

export interface AdmissionForm {
  token: string;
  captchaSiteKey: string | null;
  campuses: Array<{ id: string; code: string; nameEn: string; nameBn: string | null }>;
  academicYears: Array<{ id: string; code: string; startsOn: string; endsOn: string }>;
  yearGroups: Array<{ id: string; code: string; nameEn: string }>;
  campaign: { code: string; name: string; campusId: string | null } | null;
}

/** What the website form needs: choices, a signed form token, captcha site key, the campaign behind the link. */
export class GetAdmissionForm extends Query<{ form: 'enquiry' | 'application'; campaign?: string }, AdmissionForm> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { form: 'enquiry' | 'application'; campaign?: string }) {
    const today = LocalDate.today(this.d.clock).iso;
    const campaign = i.campaign ? await resolveCampaign(this.d, { campaign: i.campaign }) : null;
    return {
      token: this.d.formTokens.issue(i.form),
      captchaSiteKey: this.d.captcha.siteKey,
      campuses: await this.d.coreApi.campuses(),
      academicYears: (await this.d.coreApi.years())
        .filter((y) => ['planned', 'open'].includes(y.status) && y.endsOn >= today)
        .map(({ id, code, startsOn, endsOn }) => ({ id, code, startsOn, endsOn })),
      yearGroups: (await this.d.acaApi.yearGroups()).map(({ id, code, nameEn }) => ({ id, code, nameEn })),
      campaign: campaign ? { code: campaign.code, name: campaign.name, campusId: campaign.campusId } : null,
    };
  }
}

export interface EnquiryInput extends PublicFormGuard {
  campusId: string;
  academicYearId: string;
  yearGroupId?: string;
  childName: string;
  childDob?: string;
  guardianName: string;
  phone: string;
  email?: string;
  message?: string;
  preferredContact?: 'phone' | 'sms' | 'email' | 'whatsapp';
  locale?: 'en' | 'bn';
  tracking?: Tracking;
}

/**
 * Website enquiry (ADM-01 / WEB-06). Spam is stored flagged and hidden; a repeat enquiry of the same family and
 * child within the window is merged into the open one. The response is the same in every case, so a bot cannot tell.
 */
export class SubmitEnquiry extends UseCase<{ input: EnquiryInput; meta: SubmitterMeta }, { reference: string }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ input: i, meta }: { input: EnquiryInput; meta: SubmitterMeta }) {
    const { d } = this;
    await assertChoice(d, i.campusId, i.academicYearId, i.yearGroupId);
    const t = i.tracking ?? {};
    const campaign = await resolveCampaign(d, t);
    const g = await guardCheck(d, 'enquiry', i, meta, {
      names: [i.childName, i.guardianName],
      message: i.message,
      email: i.email,
    });
    const now = d.clock.now();
    const log = (outcome: string, recordId: string | null) =>
      d.admRepo.logSubmission({
        orgId: d.ctx.orgId,
        form: 'enquiry',
        outcome,
        reasons: g.reasons,
        recordId,
        campaignId: campaign?.id ?? null,
        clientIp: meta.ip ?? null,
        userAgent: trim(meta.userAgent, 300),
      });

    if (!g.spam) {
      const since = new Date(now.getTime() - g.windowDays * 86_400_000);
      const repeat = (await d.admRepo.recentByPhone(i.phone, since)).find((e) =>
        isRepeatEnquiry(e, i.childName, now, g.windowDays),
      );
      if (repeat) {
        await d.admRepo.updateEnquiry(repeat.id, {
          repeatCount: repeat.repeatCount + 1,
          ...(i.email && !repeat.email ? { email: i.email } : {}),
        });
        await d.admRepo.insertActivity({
          enquiryId: repeat.id,
          kind: 'note',
          notes: `Enquired again via the website${campaign ? ` (campaign ${campaign.code})` : ''}${i.message ? `: ${trim(i.message, 1000)}` : ''}`,
        });
        await log('merged', repeat.id);
        return { reference: repeat.enquiryNo ?? repeat.id };
      }
    }

    const enquiryNo = await d.numbers.next({ campusId: i.campusId, key: 'enquiry', date: now });
    const id = await d.admRepo.insertEnquiry({
      createdAt: d.clock.now(),
      orgId: d.ctx.orgId,
      campusId: i.campusId,
      academicYearId: i.academicYearId,
      yearGroupId: i.yearGroupId ?? null,
      enquiryNo,
      sourceCode: classifySource(t, campaign?.channel),
      campaignCode: campaign?.code ?? null,
      campaignId: campaign?.id ?? null,
      utm: utmOf(t),
      referrer: trim(t.referrer, 500),
      landingUrl: trim(t.landingUrl, 500),
      childName: i.childName.trim(),
      childDob: i.childDob ?? null,
      guardianName: i.guardianName.trim(),
      phone: i.phone,
      email: i.email ?? null,
      message: trim(i.message, 2000),
      preferredContact: i.preferredContact ?? null,
      isSpam: g.spam,
      spamScore: Math.min(g.score, 999),
      spamReasons: g.reasons,
      clientIp: meta.ip ?? null,
    });
    await log(g.spam ? 'spam' : 'accepted', id);
    if (!g.spam)
      await d.outbox.write([
        {
          type: 'adm.enquiry_received.v1',
          aggregateType: 'enquiry',
          aggregateId: id,
          orgId: d.ctx.orgId,
          campusId: i.campusId,
          occurredAt: now,
          payload: {
            enquiryId: id,
            enquiryNo,
            childName: i.childName.trim(),
            guardianName: i.guardianName.trim(),
            phone: i.phone,
            email: i.email ?? null,
            locale: i.locale ?? 'en',
          },
        },
      ]);
    return { reference: enquiryNo };
  }
}

export interface GuardianInput {
  name: string;
  relationship: 'father' | 'mother' | 'guardian' | 'other';
  phone: string;
  email?: string;
  occupation?: string;
}

export interface ApplicationInput extends PublicFormGuard {
  campusId: string;
  academicYearId: string;
  yearGroupId: string;
  childFirstName: string;
  childLastName?: string;
  childNameBn?: string;
  childGender: 'male' | 'female';
  childDob: string;
  previousSchool?: string;
  guardians: GuardianInput[];
  address?: string;
  medicalNotes?: string;
  answers?: Record<string, string>;
  locale?: 'en' | 'bn';
  tracking?: Tracking;
}

function applicationValues(i: ApplicationInput) {
  const primary = i.guardians[0]!;
  return {
    campusId: i.campusId,
    academicYearId: i.academicYearId,
    yearGroupId: i.yearGroupId,
    childFirstName: i.childFirstName.trim(),
    childLastName: trim(i.childLastName, 100),
    childNameBn: trim(i.childNameBn, 200),
    childGender: i.childGender,
    childDob: i.childDob,
    previousSchool: trim(i.previousSchool, 200),
    guardianName: primary.name.trim(),
    guardianPhone: primary.phone,
    guardianEmail: primary.email ?? null,
    formData: {
      guardians: i.guardians,
      address: trim(i.address, 1000),
      medicalNotes: trim(i.medicalNotes, 2000),
      answers: i.answers ?? {},
      locale: i.locale ?? 'en',
    },
  };
}

const childName = (a: { childFirstName: string; childLastName?: string | null }) =>
  [a.childFirstName, a.childLastName].filter(Boolean).join(' ').trim();

/** Submits an application: number, linked (or new) enquiry at stage "applied", acknowledgement to the guardian. */
async function submitApplication(d: Deps, app: ApplicationRow, campaign: CampaignRow | null): Promise<string> {
  if (app.isSpam) return app.applicationNo ?? 'received';
  const now = d.clock.now();
  const applicationNo = await d.numbers.next({ campusId: app.campusId, key: 'application', date: now });
  const name = childName(app);
  let enquiryId = app.enquiryId;
  if (!enquiryId) {
    const s = await settings(d);
    const since = new Date(now.getTime() - s.windowDays * 86_400_000);
    const open = (await d.admRepo.recentByPhone(app.guardianPhone!, since)).find((e) =>
      isRepeatEnquiry(e, name, now, s.windowDays),
    );
    enquiryId =
      open?.id ??
      (await d.admRepo.insertEnquiry({
        createdAt: d.clock.now(),
        orgId: d.ctx.orgId,
        campusId: app.campusId,
        academicYearId: app.academicYearId,
        yearGroupId: app.yearGroupId,
        enquiryNo: await d.numbers.next({ campusId: app.campusId, key: 'enquiry', date: now }),
        sourceCode: app.sourceCode ?? 'website',
        campaignCode: campaign?.code ?? null,
        campaignId: app.campaignId,
        utm: app.utm,
        referrer: app.referrer,
        landingUrl: app.landingUrl,
        childName: name,
        childDob: app.childDob,
        guardianName: app.guardianName,
        phone: app.guardianPhone,
        email: app.guardianEmail,
        clientIp: null,
      }));
  }
  const enquiry = (await d.admRepo.enquiry(enquiryId, true))!;
  if (['enquiry', 'visit_scheduled', 'visited'].includes(enquiry.stage)) {
    await d.admRepo.updateEnquiry(enquiryId, { stage: 'applied' });
    await d.admRepo.insertActivity({ enquiryId, kind: 'stage_change', notes: `Applied online: ${applicationNo}` });
  }
  await d.admRepo.updateApplication(app.id, {
    status: 'submitted',
    applicationNo,
    enquiryId,
    submittedAt: now,
    resumeTokenHash: null,
    resumeExpiresAt: null,
  });
  await d.outbox.write([
    {
      type: 'adm.application_submitted.v1',
      aggregateType: 'application',
      aggregateId: app.id,
      orgId: d.ctx.orgId,
      campusId: app.campusId,
      occurredAt: now,
      payload: {
        applicationId: app.id,
        applicationNo,
        childName: name,
        guardianName: app.guardianName,
        phone: app.guardianPhone,
        email: app.guardianEmail,
        locale: (app.formData.locale as string | undefined) ?? 'en',
      },
    },
  ]);
  return applicationNo;
}

/**
 * Online application (WEB-06 / ADM-06). `draft: true` saves and returns a secret resume token (the link to continue
 * later); otherwise it is submitted at once. Spam is stored flagged and never submitted.
 */
export class StartApplication extends UseCase<
  { input: ApplicationInput; meta: SubmitterMeta; draft: boolean },
  {
    status: 'draft' | 'submitted';
    applicationNo: string | null;
    resumeToken: string | null;
    resumeExpiresAt: Date | null;
  }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ input: i, meta, draft }: { input: ApplicationInput; meta: SubmitterMeta; draft: boolean }) {
    const { d } = this;
    await assertChoice(d, i.campusId, i.academicYearId, i.yearGroupId);
    if (!i.guardians.length) throw new InvariantError('GUARDIAN_REQUIRED', 'Add at least one parent or guardian');
    const t = i.tracking ?? {};
    const campaign = await resolveCampaign(d, t);
    const g = await guardCheck(d, 'application', i, meta, {
      names: [i.childFirstName, i.childLastName ?? '', ...i.guardians.map((x) => x.name)].filter(Boolean),
      message: i.medicalNotes,
      email: i.guardians[0]?.email,
    });
    const resume = draft && !g.spam ? d.formTokens.resumeSecret() : null;
    const expires = resume ? new Date(d.clock.now().getTime() + RESUME_DAYS * 86_400_000) : null;
    const id = await d.admRepo.insertApplication({
      createdAt: d.clock.now(),
      orgId: d.ctx.orgId,
      ...applicationValues(i),
      status: 'draft',
      sourceCode: classifySource(t, campaign?.channel),
      campaignId: campaign?.id ?? null,
      utm: utmOf(t),
      referrer: trim(t.referrer, 500),
      landingUrl: trim(t.landingUrl, 500),
      resumeTokenHash: resume?.hash ?? null,
      resumeExpiresAt: expires,
      isSpam: g.spam,
      spamScore: Math.min(g.score, 999),
      spamReasons: g.reasons,
      clientIp: meta.ip ?? null,
    });
    await d.admRepo.logSubmission({
      orgId: d.ctx.orgId,
      form: 'application',
      outcome: g.spam ? 'spam' : 'accepted',
      reasons: g.reasons,
      recordId: id,
      campaignId: campaign?.id ?? null,
      clientIp: meta.ip ?? null,
      userAgent: trim(meta.userAgent, 300),
    });
    if (draft)
      return {
        status: 'draft' as const,
        applicationNo: null,
        resumeToken: resume?.token ?? null,
        resumeExpiresAt: expires,
      };
    // spam is kept as an unsubmitted draft, but answered like a submission (bots learn nothing)
    if (g.spam) return { status: 'submitted' as const, applicationNo: null, resumeToken: null, resumeExpiresAt: null };
    const applicationNo = await submitApplication(d, (await d.admRepo.application(id, true))!, campaign);
    return { status: 'submitted' as const, applicationNo, resumeToken: null, resumeExpiresAt: null };
  }
}

async function draftByToken(d: Deps, token: string, lock: boolean): Promise<ApplicationRow> {
  const app = await d.admRepo.applicationByResumeHash(d.formTokens.hashResume(token), lock);
  if (!app || app.status !== 'draft' || !app.resumeExpiresAt || app.resumeExpiresAt < d.clock.now())
    throw new NotFoundError('This application link is invalid or has expired', 'DRAFT_NOT_FOUND');
  return app;
}

/** Continue a draft from its secret link. */
export class GetDraftApplication extends Query<{ token: string }, ApplicationRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ token }: { token: string }) {
    const app = await draftByToken(this.d, token, false);
    // tracking, spam and network data stay internal
    return { ...app, clientIp: undefined, spamScore: 0, spamReasons: [], isSpam: false } as ApplicationRow;
  }
}

/** Save the draft again (same link), optionally submitting it. */
export class UpdateDraftApplication extends UseCase<
  { token: string; input: Omit<ApplicationInput, 'tracking'>; meta: SubmitterMeta; submit: boolean },
  { status: 'draft' | 'submitted'; applicationNo: string | null }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    token: string;
    input: Omit<ApplicationInput, 'tracking'>;
    meta: SubmitterMeta;
    submit: boolean;
  }) {
    const { d } = this;
    const app = await draftByToken(d, i.token, true);
    await assertChoice(d, i.input.campusId, i.input.academicYearId, i.input.yearGroupId);
    if (!i.input.guardians.length) throw new InvariantError('GUARDIAN_REQUIRED', 'Add at least one parent or guardian');
    await d.admRepo.updateApplication(app.id, applicationValues(i.input));
    if (!i.submit) return { status: 'draft' as const, applicationNo: null };
    const campaign = app.campaignId ? await d.admRepo.campaign(app.campaignId) : null;
    const applicationNo = await submitApplication(d, (await d.admRepo.application(app.id, true))!, campaign);
    return { status: 'submitted' as const, applicationNo };
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Staff: enquiry inbox and pipeline (ADM-02 / 03)
// ------------------------------------------------------------------------------------------------------------------

export class ListEnquiries extends Query<Omit<EnquiryFilter, 'campusId'> & { campusId?: string }, EnquiryRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: Omit<EnquiryFilter, 'campusId'> & { campusId?: string }) {
    return this.d.admRepo.enquiries({ ...i, campusId: i.campusId ?? this.d.ctx.activeCampusId, spam: i.spam ?? false });
  }
}

async function visibleEnquiry(d: Deps, id: string, lock = false): Promise<EnquiryRow> {
  const e = await d.admRepo.enquiry(id, lock);
  if (!e) throw new NotFoundError('Enquiry not found', 'ENQUIRY_NOT_FOUND');
  d.scopePolicy.requireCampus(e.campusId);
  return e;
}

export class GetEnquiry extends Query<
  { id: string },
  EnquiryRow & { activities: ActivityRow[]; applications: ApplicationRow[]; campaign: CampaignRow | null }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const e = await visibleEnquiry(this.d, id);
    return {
      ...e,
      activities: await this.d.admRepo.activities(id),
      applications: await this.d.admRepo.applications({ enquiryId: id, limit: 50, offset: 0 }),
      campaign: e.campaignId ? await this.d.admRepo.campaign(e.campaignId) : null,
    };
  }
}

/** Phone call, walk-in, social message: recorded by the admission office. */
export class CreateEnquiry extends UseCase<
  Omit<EnquiryInput, 'tracking' | keyof PublicFormGuard> & {
    sourceCode: string;
    campaignId?: string;
    assignedTo?: string;
  },
  EnquiryRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(
    i: Omit<EnquiryInput, 'tracking' | keyof PublicFormGuard> & {
      sourceCode: string;
      campaignId?: string;
      assignedTo?: string;
    },
  ) {
    const campusId = this.d.scopePolicy.requireCampus(i.campusId);
    const campaign = i.campaignId ? await this.d.admRepo.campaign(i.campaignId) : null;
    if (i.campaignId && !campaign) throw new InvariantError('CAMPAIGN_INVALID', 'Unknown campaign');
    const id = await this.d.admRepo.insertEnquiry({
      createdAt: this.d.clock.now(),
      orgId: this.d.ctx.orgId,
      campusId,
      academicYearId: i.academicYearId,
      yearGroupId: i.yearGroupId ?? null,
      enquiryNo: await this.d.numbers.next({ campusId, key: 'enquiry', date: this.d.clock.now() }),
      sourceCode: i.sourceCode,
      campaignId: campaign?.id ?? null,
      campaignCode: campaign?.code ?? null,
      childName: i.childName.trim(),
      childDob: i.childDob ?? null,
      guardianName: i.guardianName.trim(),
      phone: i.phone,
      email: i.email ?? null,
      message: trim(i.message, 2000),
      preferredContact: i.preferredContact ?? null,
      assignedTo: i.assignedTo ?? this.d.ctx.userId,
    });
    return (await this.d.admRepo.enquiry(id))!;
  }
}

const STAGES: EnquiryStage[] = [
  'enquiry',
  'visit_scheduled',
  'visited',
  'applied',
  'test_scheduled',
  'tested',
  'offered',
  'admitted',
  'lost',
];

/** Assign a counsellor, set the next follow-up, move the stage (lost needs a reason). Stage changes are logged. */
export class UpdateEnquiry extends UseCase<
  {
    id: string;
    assignedTo?: string | null;
    nextFollowUpAt?: string | null;
    stage?: EnquiryStage;
    lostReasonCode?: string;
    yearGroupId?: string | null;
    email?: string | null;
  },
  EnquiryRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    id: string;
    assignedTo?: string | null;
    nextFollowUpAt?: string | null;
    stage?: EnquiryStage;
    lostReasonCode?: string;
    yearGroupId?: string | null;
    email?: string | null;
  }) {
    const e = await visibleEnquiry(this.d, i.id, true);
    const patch: Record<string, unknown> = {};
    if (i.assignedTo !== undefined) patch.assignedTo = i.assignedTo;
    if (i.nextFollowUpAt !== undefined) patch.nextFollowUpAt = i.nextFollowUpAt ? new Date(i.nextFollowUpAt) : null;
    if (i.yearGroupId !== undefined) patch.yearGroupId = i.yearGroupId;
    if (i.email !== undefined) patch.email = i.email;
    if (i.stage && i.stage !== e.stage) {
      if (!STAGES.includes(i.stage)) throw new InvariantError('STAGE_INVALID', 'Unknown stage');
      if (i.stage === 'lost' && !i.lostReasonCode)
        throw new InvariantError('LOST_REASON_REQUIRED', 'Give the reason the family was lost');
      patch.stage = i.stage;
      patch.lostReasonCode = i.stage === 'lost' ? i.lostReasonCode : null;
      if (i.stage === 'lost' || i.stage === 'admitted') patch.nextFollowUpAt = null;
      await this.d.admRepo.insertActivity({
        enquiryId: e.id,
        kind: 'stage_change',
        notes: `${e.stage} → ${i.stage}${i.stage === 'lost' ? ` (${i.lostReasonCode})` : ''}`,
        actorId: this.d.ctx.userId,
      });
    }
    if (Object.keys(patch).length) await this.d.admRepo.updateEnquiry(e.id, patch);
    return (await this.d.admRepo.enquiry(e.id))!;
  }
}

/** Call note, SMS / e-mail sent, visit, task with a due time (a task sets the next follow-up). */
export class AddEnquiryActivity extends UseCase<
  { id: string; kind: ActivityRow['kind']; notes?: string; dueAt?: string; done?: boolean },
  ActivityRow[]
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; kind: ActivityRow['kind']; notes?: string; dueAt?: string; done?: boolean }) {
    const e = await visibleEnquiry(this.d, i.id, true);
    if (i.kind === 'stage_change') throw new InvariantError('KIND_INVALID', 'Change the stage on the enquiry itself');
    if (i.kind === 'task' && !i.dueAt) throw new InvariantError('DUE_REQUIRED', 'A task needs a due time');
    await this.d.admRepo.insertActivity({
      enquiryId: e.id,
      kind: i.kind,
      notes: trim(i.notes, 2000),
      dueAt: i.dueAt ? new Date(i.dueAt) : null,
      doneAt: i.kind !== 'task' || i.done ? this.d.clock.now() : null,
      actorId: this.d.ctx.userId,
    });
    if (i.kind === 'task' && i.dueAt) await this.d.admRepo.updateEnquiry(e.id, { nextFollowUpAt: new Date(i.dueAt) });
    return this.d.admRepo.activities(e.id);
  }
}

/** Spam review: release a false positive into the inbox, or flag a lead as spam. */
export class MarkEnquirySpam extends UseCase<{ id: string; isSpam: boolean }, EnquiryRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; isSpam: boolean }) {
    const e = await visibleEnquiry(this.d, i.id, true);
    await this.d.admRepo.updateEnquiry(e.id, { isSpam: i.isSpam });
    await this.d.admRepo.insertActivity({
      enquiryId: e.id,
      kind: 'note',
      notes: i.isSpam ? 'Marked as spam' : 'Released from spam',
      actorId: this.d.ctx.userId,
    });
    return (await this.d.admRepo.enquiry(e.id))!;
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Staff: applications
// ------------------------------------------------------------------------------------------------------------------

export class ListApplications extends Query<
  {
    campusId?: string;
    academicYearId?: string;
    yearGroupId?: string;
    status?: string;
    spam?: boolean;
    q?: string;
    limit: number;
    offset: number;
  },
  ApplicationRow[]
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: {
    campusId?: string;
    academicYearId?: string;
    yearGroupId?: string;
    status?: string;
    spam?: boolean;
    q?: string;
    limit: number;
    offset: number;
  }) {
    return this.d.admRepo.applications({
      ...i,
      campusId: i.campusId ?? this.d.ctx.activeCampusId,
      spam: i.spam ?? false,
    });
  }
}

async function visibleApplication(d: Deps, id: string, lock = false): Promise<ApplicationRow> {
  const a = await d.admRepo.application(id, lock);
  if (!a) throw new NotFoundError('Application not found', 'APPLICATION_NOT_FOUND');
  d.scopePolicy.requireCampus(a.campusId);
  return a;
}

export class GetApplication extends Query<{ id: string }, ApplicationRow & { campaign: CampaignRow | null }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const a = await visibleApplication(this.d, id);
    return { ...a, campaign: a.campaignId ? await this.d.admRepo.campaign(a.campaignId) : null };
  }
}

const REVIEW_TARGETS: ApplicationStatus[] = ['under_review', 'shortlisted', 'waitlisted', 'rejected', 'withdrawn'];
const REVIEWABLE: ApplicationStatus[] = [
  'submitted',
  'fee_pending',
  'under_review',
  'shortlisted',
  'waitlisted',
  'tested',
];

/** Review decisions available before tests / offers (ADM-04+ continue from shortlisted / waitlisted). */
export class SetApplicationStatus extends UseCase<
  { id: string; status: ApplicationStatus; note?: string },
  ApplicationRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; status: ApplicationStatus; note?: string }) {
    const a = await visibleApplication(this.d, i.id, true);
    if (!REVIEW_TARGETS.includes(i.status)) throw new InvariantError('STATUS_INVALID', `Cannot set ${i.status} here`);
    if (!REVIEWABLE.includes(a.status))
      throw new ConflictError('APPLICATION_NOT_REVIEWABLE', `The application is ${a.status}`);
    if (i.status === 'rejected' && !i.note?.trim())
      throw new InvariantError('NOTE_REQUIRED', 'Give a reason for rejecting the application');
    await this.d.admRepo.updateApplication(a.id, { status: i.status, reviewNote: trim(i.note, 2000) });
    if (a.enquiryId && (i.status === 'rejected' || i.status === 'withdrawn')) {
      await this.d.admRepo.updateEnquiry(a.enquiryId, {
        stage: 'lost',
        lostReasonCode: i.status === 'rejected' ? 'not_selected' : 'withdrew',
        nextFollowUpAt: null,
      });
      await this.d.admRepo.insertActivity({
        enquiryId: a.enquiryId,
        kind: 'stage_change',
        notes: `Application ${a.applicationNo ?? ''} ${i.status}`,
        actorId: this.d.ctx.userId,
      });
    }
    return (await this.d.admRepo.application(a.id))!;
  }
}

export class MarkApplicationSpam extends UseCase<{ id: string; isSpam: boolean }, ApplicationRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; isSpam: boolean }) {
    const a = await visibleApplication(this.d, i.id, true);
    await this.d.admRepo.updateApplication(a.id, { isSpam: i.isSpam });
    // a released application that was posted for submission goes through now
    if (!i.isSpam && a.isSpam && a.status === 'draft' && !a.resumeExpiresAt) {
      const campaign = a.campaignId ? await this.d.admRepo.campaign(a.campaignId) : null;
      await submitApplication(this.d, { ...a, isSpam: false }, campaign);
    }
    return (await this.d.admRepo.application(a.id))!;
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Campaigns and the funnel (campaign tracking)
// ------------------------------------------------------------------------------------------------------------------

export interface CampaignInput {
  campusId?: string | null;
  code: string;
  name: string;
  channel: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  landingPath?: string;
  startsOn?: string | null;
  endsOn?: string | null;
  budgetPaisa?: number | null;
  isActive?: boolean;
}

const withLink = (d: Deps, c: CampaignRow) => ({ ...c, link: campaignLink(d.config.WEB_BASE_URL, c) });

export class ListCampaigns extends Query<{ active?: boolean }, Array<CampaignRow & { link: string }>> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { active?: boolean }) {
    return (await this.d.admRepo.campaigns({ active: i.active })).map((c) => withLink(this.d, c));
  }
}

export class CreateCampaign extends UseCase<CampaignInput, CampaignRow & { link: string }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: CampaignInput) {
    if (i.campusId) this.d.scopePolicy.requireCampus(i.campusId);
    const id = await this.d.admRepo.insertCampaign({
      ...i,
      code: i.code.trim().toUpperCase(),
      orgId: this.d.ctx.orgId,
      campusId: i.campusId ?? null,
    });
    return withLink(this.d, (await this.d.admRepo.campaign(id))!);
  }
}

export class UpdateCampaign extends UseCase<
  { id: string } & Partial<Omit<CampaignInput, 'code'>>,
  CampaignRow & { link: string }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id, ...patch }: { id: string } & Partial<Omit<CampaignInput, 'code'>>) {
    const c = await this.d.admRepo.campaign(id);
    if (!c) throw new NotFoundError('Campaign not found', 'CAMPAIGN_NOT_FOUND');
    if (patch.campusId) this.d.scopePolicy.requireCampus(patch.campusId);
    await this.d.admRepo.updateCampaign(id, patch);
    return withLink(this.d, (await this.d.admRepo.campaign(id))!);
  }
}

export interface FunnelReport {
  from: string;
  to: string;
  bySource: Array<FunnelRow & { conversionPct: number | null }>;
  byCampaign: Array<
    FunnelRow & { code: string; name: string; conversionPct: number | null; costPerEnquiryPaisa: number | null }
  >;
  totals: { enquiries: number; spam: number; applied: number; admitted: number; lost: number };
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

/** Conversion per source and per campaign over a date range: enquiries → applied → admitted, spam kept apart. */
export class GetAdmissionFunnel extends Query<{ from: string; to: string; campusId?: string }, FunnelReport> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { from: string; to: string; campusId?: string }) {
    const rows = await this.d.admRepo.funnel({
      from: new Date(`${i.from}T00:00:00+06:00`),
      to: new Date(`${i.to}T23:59:59.999+06:00`),
      campusId: i.campusId ?? this.d.ctx.activeCampusId,
    });
    const sum = (list: FunnelRow[]) =>
      list.reduce(
        (t, r) => ({
          enquiries: t.enquiries + r.enquiries,
          spam: t.spam + r.spam,
          applied: t.applied + r.applied,
          admitted: t.admitted + r.admitted,
          lost: t.lost + r.lost,
        }),
        { enquiries: 0, spam: 0, applied: 0, admitted: 0, lost: 0 },
      );
    const bySource = new Map<string, FunnelRow[]>();
    for (const r of rows) bySource.set(r.sourceCode, [...(bySource.get(r.sourceCode) ?? []), r]);
    const byCampaign = new Map<string, FunnelRow[]>();
    for (const r of rows) if (r.campaignId) byCampaign.set(r.campaignId, [...(byCampaign.get(r.campaignId) ?? []), r]);
    const campaigns = new Map((await this.d.admRepo.campaigns({})).map((c) => [c.id, c]));
    return {
      from: i.from,
      to: i.to,
      bySource: [...bySource]
        .map(([sourceCode, list]) => {
          const t = sum(list);
          return { sourceCode, campaignId: null, ...t, conversionPct: pct(t.admitted, t.enquiries) };
        })
        .sort((a, b) => b.enquiries - a.enquiries),
      byCampaign: [...byCampaign]
        .map(([campaignId, list]) => {
          const t = sum(list);
          const c = campaigns.get(campaignId);
          return {
            sourceCode: c?.channel ?? '',
            campaignId,
            code: c?.code ?? '',
            name: c?.name ?? '',
            ...t,
            conversionPct: pct(t.admitted, t.enquiries),
            costPerEnquiryPaisa: c?.budgetPaisa && t.enquiries ? Math.round(c.budgetPaisa / t.enquiries) : null,
          };
        })
        .sort((a, b) => b.enquiries - a.enquiries),
      totals: sum(rows),
    };
  }
}
