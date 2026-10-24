import { asValue } from 'awilix';
import type { Request } from 'express';
import { z } from 'zod';
import { systemContext } from '../../../shared/application/RequestContext.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  AddEnquiryActivity,
  CreateCampaign,
  CreateEnquiry,
  GetAdmissionForm,
  GetAdmissionFunnel,
  GetApplication,
  GetDraftApplication,
  GetEnquiry,
  ListApplications,
  ListCampaigns,
  ListEnquiries,
  MarkApplicationSpam,
  MarkEnquirySpam,
  SetApplicationStatus,
  StartApplication,
  SubmitEnquiry,
  UpdateCampaign,
  UpdateDraftApplication,
  UpdateEnquiry,
} from '../application/AdmissionUseCases.js';

const Id = z.object({ id: zx.uuid() });
const ResumeToken = z.object({ token: z.string().regex(/^[\w-]{20,64}$/) });
const Name = z.string().trim().min(2).max(120);
const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();
const Paging = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};
const Stage = z.enum([
  'enquiry',
  'visit_scheduled',
  'visited',
  'applied',
  'test_scheduled',
  'tested',
  'offered',
  'admitted',
  'lost',
]);
const Channel = z.enum([
  'website',
  'facebook',
  'google',
  'instagram',
  'youtube',
  'qr',
  'sms',
  'email',
  'event',
  'referral',
  'print',
  'other',
]);
const Tracking = z
  .object({
    campaign: z.string().max(40).optional(),
    utmSource: z.string().max(200).optional(),
    utmMedium: z.string().max(200).optional(),
    utmCampaign: z.string().max(200).optional(),
    utmTerm: z.string().max(200).optional(),
    utmContent: z.string().max(200).optional(),
    referrer: z.string().max(1000).optional(),
    landingUrl: z.string().max(1000).optional(),
  })
  .strict();
const Guard = {
  token: z.string().max(400).optional(),
  website: z.string().max(500).optional(),
  captchaToken: z.string().max(4000).optional(),
};
const EnquiryBody = z
  .object({
    ...Guard,
    campusId: zx.uuid(),
    academicYearId: zx.uuid(),
    yearGroupId: zx.uuid().optional(),
    childName: Name,
    childDob: zx.date().optional(),
    guardianName: Name,
    phone: zx.phone(),
    email: z.string().email().max(200).optional(),
    message: z.string().max(2000).optional(),
    preferredContact: z.enum(['phone', 'sms', 'email', 'whatsapp']).optional(),
    locale: z.enum(['en', 'bn']).optional(),
    tracking: Tracking.optional(),
  })
  .strict();
const ApplicationFields = {
  campusId: zx.uuid(),
  academicYearId: zx.uuid(),
  yearGroupId: zx.uuid(),
  childFirstName: Name,
  childLastName: z.string().trim().max(100).optional(),
  childNameBn: z.string().trim().max(200).optional(),
  childGender: z.enum(['male', 'female']),
  childDob: zx.date(),
  previousSchool: z.string().trim().max(200).optional(),
  guardians: z
    .array(
      z
        .object({
          name: Name,
          relationship: z.enum(['father', 'mother', 'guardian', 'other']),
          phone: zx.phone(),
          email: z.string().email().max(200).optional(),
          occupation: z.string().max(100).optional(),
        })
        .strict(),
    )
    .min(1)
    .max(3),
  address: z.string().max(1000).optional(),
  medicalNotes: z.string().max(2000).optional(),
  answers: z.record(z.string().max(60), z.string().max(1000)).optional(),
  locale: z.enum(['en', 'bn']).optional(),
};
const CampaignBody = z
  .object({
    campusId: zx.uuid().nullable().optional(),
    code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/),
    name: zx.name(),
    channel: Channel,
    utmSource: z.string().max(100).nullable().optional(),
    utmMedium: z.string().max(100).nullable().optional(),
    utmCampaign: z.string().max(100).nullable().optional(),
    landingPath: z
      .string()
      .regex(/^\/[\w\-/]*$/)
      .max(200)
      .optional(),
    startsOn: zx.date().nullable().optional(),
    endsOn: zx.date().nullable().optional(),
    budgetPaisa: zx.paisa().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.header('user-agent') ?? undefined });

/** WEB-06 / ADM-01..03: website enquiry and application forms (public), enquiry pipeline, applications, campaigns. */
export class AdmissionController extends BaseController {
  readonly basePath = '/adm';
  readonly tag = 'Admissions';

  /** public routes run as the system (no user), for the organisation of this deployment */
  private async asSystem<T>(req: Request, name: string, run: (useCase: T) => Promise<unknown>) {
    const scope = req.scope.createScope();
    scope.register({ ctx: asValue(systemContext(req.ctx.orgId, req.requestId)) });
    try {
      return await run(scope.resolve<T>(name));
    } finally {
      await scope.dispose();
    }
  }

  routes(): RouteDefinition[] {
    return [
      // ---------------- public (website) ----------------
      defineRoute({
        method: 'get',
        path: '/public/form',
        summary: 'Website form setup: campuses, open years, classes, signed form token, captcha key, campaign',
        auth: 'none',
        rateLimit: { name: 'adm-form', points: 60, durationSec: 60, by: 'ip' },
        schema: {
          query: z.object({
            form: z.enum(['enquiry', 'application']).default('enquiry'),
            campaign: z.string().max(40).optional(),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.asSystem<GetAdmissionForm>(req, 'getAdmissionForm', (u) => u.execute(query))),
      }),
      defineRoute({
        method: 'post',
        path: '/public/enquiries',
        summary: 'Website enquiry (spam-checked, campaign-tracked); the answer is the same whatever the spam verdict',
        auth: 'none',
        successStatus: 202,
        rateLimit: { name: 'adm-enquiry', points: 5, durationSec: 600, by: 'ip' },
        schema: { body: EnquiryBody },
        handler: async ({ body }, req) => ({
          status: 202,
          data: await this.asSystem<SubmitEnquiry>(req, 'submitEnquiry', (u) =>
            u.execute({ input: body, meta: meta(req) }),
          ),
        }),
      }),
      defineRoute({
        method: 'post',
        path: '/public/applications',
        summary: 'Online application: submit, or save a draft (draft: true returns a secret link token)',
        auth: 'none',
        successStatus: 201,
        rateLimit: { name: 'adm-application', points: 10, durationSec: 3600, by: 'ip' },
        schema: {
          body: z
            .object({
              ...Guard,
              ...ApplicationFields,
              draft: z.boolean().default(false),
              tracking: Tracking.optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) => {
          const { draft, ...input } = body;
          return this.created(
            await this.asSystem<StartApplication>(req, 'startApplication', (u) =>
              u.execute({ input, meta: meta(req), draft }),
            ),
          );
        },
      }),
      defineRoute({
        method: 'get',
        path: '/public/applications/:token',
        summary: 'Continue a draft application from its secret link',
        auth: 'none',
        rateLimit: { name: 'adm-draft', points: 30, durationSec: 600, by: 'ip' },
        schema: { params: ResumeToken },
        handler: async ({ params }, req) =>
          this.ok(await this.asSystem<GetDraftApplication>(req, 'getDraftApplication', (u) => u.execute(params))),
      }),
      defineRoute({
        method: 'put',
        path: '/public/applications/:token',
        summary: 'Save the draft again; submit: true submits it',
        auth: 'none',
        successStatus: 200,
        rateLimit: { name: 'adm-draft-save', points: 30, durationSec: 600, by: 'ip' },
        schema: {
          params: ResumeToken,
          body: z.object({ ...ApplicationFields, submit: z.boolean().default(false) }).strict(),
        },
        handler: async ({ params, body }, req) => {
          const { submit, ...input } = body;
          return this.ok(
            await this.asSystem<UpdateDraftApplication>(req, 'updateDraftApplication', (u) =>
              u.execute({ token: params.token, input, meta: meta(req), submit }),
            ),
          );
        },
      }),

      // ---------------- enquiries ----------------
      defineRoute({
        method: 'get',
        path: '/enquiries',
        summary: 'Enquiry inbox (spam hidden unless spam=true)',
        permission: 'adm.enquiry.view',
        schema: {
          query: z.object({
            campusId: zx.uuid().optional(),
            academicYearId: zx.uuid().optional(),
            stage: Stage.optional(),
            sourceCode: z.string().max(30).optional(),
            campaignId: zx.uuid().optional(),
            assignedTo: zx.uuid().optional(),
            spam: bool,
            q: z.string().max(100).optional(),
            from: zx.date().optional(),
            to: zx.date().optional(),
            ...Paging,
          }),
        },
        handler: async ({ query }, req) => {
          const { from, to, ...rest } = query;
          return this.ok(
            await this.resolve<ListEnquiries>(req, 'listEnquiries').execute({
              ...rest,
              ...(from ? { from: new Date(`${from}T00:00:00+06:00`) } : {}),
              ...(to ? { to: new Date(`${to}T23:59:59.999+06:00`) } : {}),
            }),
          );
        },
      }),
      defineRoute({
        method: 'post',
        path: '/enquiries',
        summary: 'Record a phone / walk-in / social enquiry',
        permission: 'adm.enquiry.create',
        schema: {
          body: z
            .object({
              campusId: zx.uuid(),
              academicYearId: zx.uuid(),
              yearGroupId: zx.uuid().optional(),
              childName: Name,
              childDob: zx.date().optional(),
              guardianName: Name,
              phone: zx.phone(),
              email: z.string().email().max(200).optional(),
              message: z.string().max(2000).optional(),
              preferredContact: z.enum(['phone', 'sms', 'email', 'whatsapp']).optional(),
              sourceCode: z.enum(['phone', 'walk_in', 'facebook', 'referral', 'event', 'email', 'other']),
              campaignId: zx.uuid().optional(),
              assignedTo: zx.uuid().optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreateEnquiry>(req, 'createEnquiry').execute(body)),
      }),
      defineRoute({
        method: 'get',
        path: '/enquiries/:id',
        summary: 'Enquiry with activity timeline, applications and campaign',
        permission: 'adm.enquiry.view',
        schema: { params: Id },
        handler: async ({ params }, req) => this.ok(await this.resolve<GetEnquiry>(req, 'getEnquiry').execute(params)),
      }),
      defineRoute({
        method: 'patch',
        path: '/enquiries/:id',
        summary: 'Assign a counsellor, next follow-up, stage (lost needs a reason)',
        permission: 'adm.enquiry.edit',
        schema: {
          params: Id,
          body: z
            .object({
              assignedTo: zx.uuid().nullable().optional(),
              nextFollowUpAt: z.iso.datetime({ offset: true }).nullable().optional(),
              stage: Stage.optional(),
              lostReasonCode: z.string().max(50).optional(),
              yearGroupId: zx.uuid().nullable().optional(),
              email: z.string().email().max(200).nullable().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<UpdateEnquiry>(req, 'updateEnquiry').execute({ id: params.id, ...body })),
      }),
      defineRoute({
        method: 'post',
        path: '/enquiries/:id/activities',
        summary: 'Call note, SMS / e-mail, visit, or a task with a due time',
        permission: 'adm.enquiry.edit',
        schema: {
          params: Id,
          body: z
            .object({
              kind: z.enum(['call', 'sms', 'email', 'visit', 'note', 'task']),
              notes: z.string().max(2000).optional(),
              dueAt: z.iso.datetime({ offset: true }).optional(),
              done: z.boolean().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<AddEnquiryActivity>(req, 'addEnquiryActivity').execute({ id: params.id, ...body }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/enquiries/:id/spam',
        summary: 'Flag as spam, or release a false positive into the inbox',
        permission: 'adm.enquiry.edit',
        successStatus: 200,
        schema: { params: Id, body: z.object({ isSpam: z.boolean() }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<MarkEnquirySpam>(req, 'markEnquirySpam').execute({ id: params.id, ...body })),
      }),

      // ---------------- applications ----------------
      defineRoute({
        method: 'get',
        path: '/applications',
        summary: 'Applications (spam hidden unless spam=true)',
        permission: 'adm.application.view',
        schema: {
          query: z.object({
            campusId: zx.uuid().optional(),
            academicYearId: zx.uuid().optional(),
            yearGroupId: zx.uuid().optional(),
            status: z.string().max(30).optional(),
            spam: bool,
            q: z.string().max(100).optional(),
            ...Paging,
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListApplications>(req, 'listApplications').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/applications/:id',
        summary: 'Application with form answers and campaign',
        permission: 'adm.application.view',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetApplication>(req, 'getApplication').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/applications/:id/status',
        summary: 'Review: under review, shortlisted, waitlisted, rejected (with reason), withdrawn',
        permission: 'adm.application.edit',
        successStatus: 200,
        schema: {
          params: Id,
          body: z
            .object({
              status: z.enum(['under_review', 'shortlisted', 'waitlisted', 'rejected', 'withdrawn']),
              note: z.string().max(2000).optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SetApplicationStatus>(req, 'setApplicationStatus').execute({ id: params.id, ...body }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/applications/:id/spam',
        summary: 'Flag as spam, or release (a released submission is submitted now)',
        permission: 'adm.application.edit',
        successStatus: 200,
        schema: { params: Id, body: z.object({ isSpam: z.boolean() }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<MarkApplicationSpam>(req, 'markApplicationSpam').execute({ id: params.id, ...body }),
          ),
      }),

      // ---------------- campaigns and funnel ----------------
      defineRoute({
        method: 'get',
        path: '/campaigns',
        summary: 'Campaigns with their tracked link (for QR codes and ads)',
        permission: 'adm.campaign.view',
        schema: { query: z.object({ active: bool }) },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListCampaigns>(req, 'listCampaigns').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/campaigns',
        summary: 'Create a campaign (code used in ?campaign=, optional UTM mapping, dates, budget)',
        permission: 'adm.campaign.create',
        schema: { body: CampaignBody },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreateCampaign>(req, 'createCampaign').execute(body)),
      }),
      defineRoute({
        method: 'patch',
        path: '/campaigns/:id',
        summary: 'Update or end a campaign',
        permission: 'adm.campaign.edit',
        schema: { params: Id, body: CampaignBody.omit({ code: true }).partial() },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<UpdateCampaign>(req, 'updateCampaign').execute({ id: params.id, ...body })),
      }),
      defineRoute({
        method: 'get',
        path: '/funnel',
        summary: 'Conversion per source and campaign: enquiries, applied, admitted, lost, spam, cost per enquiry',
        permission: 'adm.enquiry.view',
        schema: { query: z.object({ from: zx.date(), to: zx.date(), campusId: zx.uuid().optional() }) },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<GetAdmissionFunnel>(req, 'getAdmissionFunnel').execute(query)),
      }),
    ];
  }
}
