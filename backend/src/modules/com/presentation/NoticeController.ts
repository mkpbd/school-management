import { asValue } from 'awilix';
import { z } from 'zod';
import { systemContext } from '../../../shared/application/RequestContext.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  CreateNotice,
  GetNotice,
  GetReadReceipts,
  ListNotices,
  GetNoticeAttachmentUrl,
  MarkNoticeRead,
  MyNotices,
  PublishDueNotices,
  PublishNotice,
  UpdateNotice,
  WebsiteNotices,
  WithdrawNotice,
} from '../application/NoticeUseCases.js';

const Id = z.object({ id: zx.uuid() });
const Instant = z.iso.datetime({ offset: true });
const NoticeBody = z
  .object({
    campusId: zx.uuid().nullable().optional(),
    titleEn: z.string().min(3).max(200),
    titleBn: z.string().max(200).optional(),
    bodyEn: z.string().min(3).max(20_000),
    bodyBn: z.string().max(20_000).optional(),
    category: z.enum(['general', 'academic', 'exam', 'event', 'holiday', 'fee', 'transport', 'circular']).optional(),
    isCircular: z.boolean().optional(),
    priority: z.enum(['normal', 'urgent', 'emergency']).optional(),
    publishAt: Instant.optional(),
    expiresAt: Instant.optional(),
    publishToWebsite: z.boolean().optional(),
    sendSms: z.boolean().optional(),
    attachmentFileIds: z.array(zx.uuid()).max(10).optional(),
    audiences: z
      .array(
        z
          .object({
            type: z.enum([
              'everyone',
              'campus',
              'year_group',
              'class_section',
              'house',
              'role',
              'staff',
              'guardians',
              'students',
              'user',
            ]),
            id: zx.uuid().nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

/** COM-01 notice board and circulars: targeted, scheduled, with attachments, website listing and read receipts. */
export class NoticeController extends BaseController {
  readonly basePath = '/com';
  readonly tag = 'Notices';

  routes(): RouteDefinition[] {
    return [
      defineRoute({
        method: 'post',
        path: '/notices',
        summary: 'Draft a notice / circular for an audience (publishNow: publish or schedule at publishAt)',
        permission: 'com.notice.create',
        idempotent: true,
        schema: { body: NoticeBody.extend({ publishNow: z.boolean().optional() }) },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreateNotice>(req, 'createNotice').execute(body)),
      }),
      defineRoute({
        method: 'put',
        path: '/notices/:id',
        summary: 'Edit a draft / scheduled notice',
        permission: 'com.notice.create',
        schema: { params: Id, body: NoticeBody },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<UpdateNotice>(req, 'updateNotice').execute({ id: params.id, ...body })),
      }),
      defineRoute({
        method: 'post',
        path: '/notices/:id/publish',
        summary: 'Publish now (or schedule when publishAt is later): audience resolved, push / SMS sent',
        permission: 'com.notice.create',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<PublishNotice>(req, 'publishNotice').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/notices/:id/withdraw',
        summary: 'Withdraw (disappears from boards and the website)',
        permission: 'com.notice.create',
        successStatus: 200,
        schema: { params: Id, body: z.object({ reason: z.string().max(300).optional() }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<WithdrawNotice>(req, 'withdrawNotice').execute({ id: params.id, ...body })),
      }),
      defineRoute({
        method: 'get',
        path: '/notices',
        summary: 'All notices (drafts, scheduled, published, withdrawn)',
        permission: 'com.notice.view',
        schema: {
          query: z.object({
            status: z.enum(['draft', 'scheduled', 'published', 'withdrawn']).optional(),
            category: z.string().max(20).optional(),
            campusId: zx.uuid().optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            offset: z.coerce.number().int().min(0).default(0),
          }),
        },
        handler: async ({ query }, req) => this.ok(await this.resolve<ListNotices>(req, 'listNotices').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/notices/:id',
        summary: 'A notice (staff with com.notice.view, or a recipient)',
        schema: { params: Id },
        handler: async ({ params }, req) => this.ok(await this.resolve<GetNotice>(req, 'getNotice').execute(params)),
      }),
      defineRoute({
        method: 'get',
        path: '/notices/:id/attachments/:fileId/url',
        summary: 'Short-lived download link of a notice attachment (recipients, or notice managers)',
        schema: { params: z.object({ id: zx.uuid(), fileId: zx.uuid() }) },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetNoticeAttachmentUrl>(req, 'getNoticeAttachmentUrl').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/notices/:id/read',
        summary: 'Mark as read (read receipt)',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<MarkNoticeRead>(req, 'markNoticeRead').execute(params)),
      }),
      defineRoute({
        method: 'get',
        path: '/notices/:id/receipts',
        summary: 'Read receipts: totals, by guardians / students / staff, unread list',
        permission: 'com.notice.view',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetReadReceipts>(req, 'getReadReceipts').execute(params)),
      }),
      defineRoute({
        method: 'get',
        path: '/me/notices',
        summary: 'My notice board (portal / app): urgent first, unread flag',
        schema: {
          query: z.object({
            unreadOnly: z
              .enum(['true', 'false'])
              .transform((v) => v === 'true')
              .optional(),
            limit: z.coerce.number().int().min(1).max(100).default(30),
            offset: z.coerce.number().int().min(0).default(0),
          }),
        },
        handler: async ({ query }, req) => this.ok(await this.resolve<MyNotices>(req, 'myNotices').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/public/notices',
        summary: 'Website: published notices marked for the public site (no login)',
        auth: 'none',
        rateLimit: { name: 'public-notices', points: 120, durationSec: 60, by: 'ip' },
        schema: {
          query: z.object({
            campusId: zx.uuid().optional(),
            limit: z.coerce.number().int().min(1).max(50).default(20),
          }),
        },
        handler: async ({ query }, req) => {
          const scope = req.scope.createScope();
          scope.register({ ctx: asValue(systemContext(req.ctx.orgId, req.requestId)) });
          try {
            return this.ok(await scope.resolve<WebsiteNotices>('websiteNotices').execute(query));
          } finally {
            await scope.dispose();
          }
        },
      }),
      defineRoute({
        method: 'post',
        path: '/tasks/publish-due-notices',
        summary: 'Publish scheduled notices that are due (also every minute)',
        permission: 'com.notice.create',
        successStatus: 200,
        handler: async (_i, req) =>
          this.ok(await this.resolve<PublishDueNotices>(req, 'publishDueNotices').execute({})),
      }),
    ];
  }
}
