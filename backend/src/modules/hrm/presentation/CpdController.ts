import { z } from 'zod';
import { cpdCourse } from '../../../shared/infrastructure/db/schema/hrm.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { crudRoutes, zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  CancelCpdSession,
  ListCpdRegistrations,
  CompleteCpdSession,
  CpdSummary,
  GetStaffCpd,
  ListCpdSessions,
  ListPendingCpd,
  LogExternalCpd,
  MarkCpdAttendance,
  RegisterForCpdSession,
  RenderCpdCertificate,
  ScheduleCpdSession,
  VerifyCpdRecord,
} from '../application/CpdUseCases.js';

const Id = z.object({ id: zx.uuid() });
const Instant = z.iso.datetime({ offset: true });
const Year = z.coerce.number().int().min(2000).max(2100);
const Hours = z.number().positive().max(500).multipleOf(0.5);
const courseFields = {
  title: z.string().min(3).max(200),
  provider: z.string().max(200).optional(),
  hours: Hours.transform(String),
  category: z.enum([
    'pedagogy',
    'subject',
    'safeguarding',
    'leadership',
    'technology',
    'curriculum',
    'wellbeing',
    'other',
  ]),
  delivery: z.enum(['in_person', 'online', 'blended']).default('in_person'),
  description: z.string().max(2000).optional(),
};

/** HRM-06 CPD: catalogue, sessions with registration / attendance, external training, hours, certificates. */
export class CpdController extends BaseController {
  readonly basePath = '/hrm';
  readonly tag = 'HRM · CPD';

  routes(): RouteDefinition[] {
    return [
      ...crudRoutes({
        path: '/cpd-courses',
        entity: 'CPD course',
        table: cpdCourse,
        orgScoped: true,
        permissions: { view: 'hrm.cpd.view', create: 'hrm.cpd.create', edit: 'hrm.cpd.create' },
        filters: { category: cpdCourse.category, isActive: cpdCourse.isActive },
        search: [cpdCourse.title],
        orderBy: [cpdCourse.title],
        createSchema: z.object(courseFields),
        updateSchema: z.object({ ...courseFields, isActive: z.boolean() }),
      }),
      defineRoute({
        method: 'post',
        path: '/cpd-sessions',
        summary: 'Schedule a session of a course (capacity, venue, trainer)',
        permission: 'hrm.cpd.create',
        schema: {
          body: z
            .object({
              courseId: zx.uuid(),
              campusId: zx.uuid().optional(),
              startsAt: Instant,
              endsAt: Instant,
              venue: z.string().max(200).optional(),
              trainer: z.string().max(200).optional(),
              capacity: z.number().int().min(1).max(500).optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<ScheduleCpdSession>(req, 'scheduleCpdSession').execute(body)),
      }),
      defineRoute({
        method: 'get',
        path: '/cpd-sessions',
        summary: 'Sessions (any staff member can browse to register)',
        schema: {
          query: z.object({
            campusId: zx.uuid().optional(),
            from: Instant.optional(),
            to: Instant.optional(),
            status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListCpdSessions>(req, 'listCpdSessions').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/cpd-sessions/:id/register',
        summary: 'Register (yourself, or staffId with hrm.cpd.create)',
        successStatus: 200,
        schema: { params: Id, body: z.object({ staffId: zx.uuid().optional() }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<RegisterForCpdSession>(req, 'registerForCpdSession').execute({
              sessionId: params.id,
              ...body,
            }),
          ),
      }),
      defineRoute({
        method: 'put',
        path: '/cpd-sessions/:id/attendance',
        summary: 'Mark attended / absent',
        permission: 'hrm.cpd.create',
        schema: {
          params: Id,
          body: z
            .object({
              entries: z
                .array(z.object({ staffId: zx.uuid(), status: z.enum(['attended', 'absent']) }).strict())
                .min(1)
                .max(500),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<MarkCpdAttendance>(req, 'markCpdAttendance').execute({
              sessionId: params.id,
              entries: body.entries,
            }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/cpd-sessions/:id/complete',
        summary: 'Complete: attendees get verified CPD hours and a certificate number',
        permission: 'hrm.cpd.create',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<CompleteCpdSession>(req, 'completeCpdSession').execute({ sessionId: params.id })),
      }),
      defineRoute({
        method: 'get',
        path: '/cpd-sessions/:id/registrations',
        summary: 'Registered staff of a session with their attendance mark',
        permission: 'hrm.cpd.create',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(
            await this.resolve<ListCpdRegistrations>(req, 'listCpdRegistrations').execute({ sessionId: params.id }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/cpd-sessions/:id/cancel',
        summary: 'Cancel a scheduled session; registered staff are notified with the reason',
        permission: 'hrm.cpd.create',
        successStatus: 200,
        schema: { params: Id, body: z.object({ reason: z.string().trim().min(3).max(500) }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<CancelCpdSession>(req, 'cancelCpdSession').execute({
              sessionId: params.id,
              reason: body.reason,
            }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/cpd-records',
        summary: 'Log external training (yourself, or staffId with hrm.cpd.create); HR verifies it',
        schema: {
          body: z
            .object({
              staffId: zx.uuid().optional(),
              title: z.string().min(3).max(200),
              provider: z.string().max(200).optional(),
              completedOn: zx.date(),
              hours: Hours,
              certificateFileId: zx.uuid().optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<LogExternalCpd>(req, 'logExternalCpd').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/cpd-records/:id/verify',
        summary: 'Verify an external training record (counts towards the target)',
        permission: 'hrm.cpd.approve',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<VerifyCpdRecord>(req, 'verifyCpdRecord').execute(params)),
      }),
      defineRoute({
        method: 'get',
        path: '/cpd-records/pending',
        summary: 'External records waiting for verification',
        permission: 'hrm.cpd.approve',
        schema: { query: z.object({ year: Year }) },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListPendingCpd>(req, 'listPendingCpd').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/cpd-records/:id/certificate',
        summary: 'Certificate PDF of a completed in-house session',
        schema: { params: Id },
        handler: async ({ params }, req, res) => {
          const { filename, pdf } = await this.resolve<RenderCpdCertificate>(req, 'renderCpdCertificate').execute(
            params,
          );
          res
            .status(200)
            .set({
              'Content-Type': 'application/pdf',
              'Content-Disposition': `inline; filename="${filename}"`,
              'Cache-Control': 'private, no-store',
            })
            .send(pdf);
          return undefined;
        },
      }),
      defineRoute({
        method: 'get',
        path: '/cpd',
        summary: 'CPD record and hours of a year (own, or staffId with hrm.cpd.view)',
        schema: { query: z.object({ staffId: zx.uuid().optional(), year: Year }) },
        handler: async ({ query }, req) => this.ok(await this.resolve<GetStaffCpd>(req, 'getStaffCpd').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/cpd/summary',
        summary: 'Hours per teacher against the yearly target',
        permission: 'hrm.cpd.view',
        schema: { query: z.object({ campusId: zx.uuid().optional(), year: Year }) },
        handler: async ({ query }, req) => this.ok(await this.resolve<CpdSummary>(req, 'cpdSummary').execute(query)),
      }),
    ];
  }
}
