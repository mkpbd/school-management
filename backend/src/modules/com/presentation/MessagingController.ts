import { asValue } from 'awilix';
import { z } from 'zod';
import { systemContext } from '../../../shared/application/RequestContext.js';
import { AuthError } from '../../../shared/domain/errors.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  ActivateTemplate,
  CreateTemplateVersion,
  GetMyPreferences,
  ListMyDevices,
  ListTemplates,
  MyInbox,
  PreviewTemplate,
  RegisterPushDevice,
  RevokePushDevice,
  RevokePushDeviceById,
  UpdateMyPreferences,
} from '../application/MessagingUseCases.js';

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const Channel = z.enum(['sms', 'email', 'push', 'whatsapp']);
const AnyChannel = z.enum(['sms', 'email', 'push', 'whatsapp', 'in_app']);

/** Notification self-service (preferences, quiet hours, devices, inbox) and template administration. */
export class MessagingController extends BaseController {
  readonly basePath = '/com';
  readonly tag = 'Notifications';

  routes(): RouteDefinition[] {
    return [
      defineRoute({
        method: 'get',
        path: '/me/notification-preferences',
        summary: 'Every notification with its channels (muted or not), my quiet hours and the school default',
        handler: async (_i, req) => this.ok(await this.resolve<GetMyPreferences>(req, 'getMyPreferences').execute({})),
      }),
      defineRoute({
        method: 'put',
        path: '/me/notification-preferences',
        summary: 'Mute / unmute per event and channel ("*" = all events); my quiet hours (null = school default)',
        schema: {
          body: z
            .object({
              quietHours: z.object({ from: Time, to: Time }).strict().nullable().optional(),
              settings: z
                .array(
                  z
                    .object({
                      eventCode: z.string().regex(/^(\*|[a-z_]+\.[a-z_]+)$/),
                      channel: Channel,
                      enabled: z.boolean(),
                    })
                    .strict(),
                )
                .max(200)
                .optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.ok(await this.resolve<UpdateMyPreferences>(req, 'updateMyPreferences').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/me/push-devices',
        summary: 'Register this app install for push (FCM token)',
        successStatus: 200,
        schema: {
          body: z
            .object({
              token: z.string().min(20).max(4096),
              app: z.enum(['parent', 'staff', 'web_push']),
              platform: z.enum(['android', 'ios', 'web']),
              locale: z.enum(['en', 'bn']).optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.ok(await this.resolve<RegisterPushDevice>(req, 'registerPushDevice').execute(body)),
      }),
      defineRoute({
        method: 'get',
        path: '/me/push-devices',
        summary: 'My registered devices',
        handler: async (_i, req) => this.ok(await this.resolve<ListMyDevices>(req, 'listMyDevices').execute({})),
      }),
      defineRoute({
        method: 'post',
        path: '/me/push-devices/revoke',
        summary: 'Stop push to a device (sign-out on that device)',
        successStatus: 200,
        schema: { body: z.object({ token: z.string().min(20).max(4096) }).strict() },
        handler: async ({ body }, req) =>
          this.ok(await this.resolve<RevokePushDevice>(req, 'revokePushDevice').execute(body)),
      }),
      defineRoute({
        method: 'delete',
        path: '/me/push-devices/:id',
        summary: 'Stop push to one of my devices (from the device list)',
        schema: { params: z.object({ id: zx.uuid() }) },
        handler: async ({ params }, req) => {
          await this.resolve<RevokePushDeviceById>(req, 'revokePushDeviceById').execute(params);
          return this.noContent();
        },
      }),
      defineRoute({
        method: 'get',
        path: '/me/inbox',
        summary: 'My in-app notifications',
        schema: { query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }) },
        handler: async ({ query }, req) => {
          const userId = req.ctx.userId;
          if (!userId) throw new AuthError();
          // messages carry the campus of their event; reading one's own inbox must not depend on campus scope
          const scope = req.scope.createScope();
          scope.register({ ctx: asValue(systemContext(req.ctx.orgId, req.requestId)) });
          try {
            return this.ok(await scope.resolve<MyInbox>('myInbox').execute({ userId, limit: query.limit }));
          } finally {
            await scope.dispose();
          }
        },
      }),

      // ---------------- templates ----------------
      defineRoute({
        method: 'get',
        path: '/templates',
        summary: 'Message templates (all versions)',
        permission: 'com.template.view',
        schema: { query: z.object({ eventCode: z.string().max(60).optional(), channel: AnyChannel.optional() }) },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListTemplates>(req, 'listTemplates').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/templates',
        summary: 'New template version (inactive until activated). E-mail bodies are HTML; values are escaped',
        permission: 'com.template.edit',
        schema: {
          body: z
            .object({
              eventCode: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
              channel: AnyChannel,
              locale: z.enum(['en', 'bn']),
              subject: z.string().max(200).optional(),
              body: z.string().min(1).max(50_000),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<CreateTemplateVersion>(req, 'createTemplateVersion').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/templates/:id/activate',
        summary: 'Make this version the live one (the previous version is deactivated)',
        permission: 'com.template.approve',
        successStatus: 200,
        schema: { params: z.object({ id: zx.uuid() }) },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<ActivateTemplate>(req, 'activateTemplate').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/templates/preview',
        summary: 'Render a draft with sample data (e-mail inside the school layout)',
        permission: 'com.template.view',
        successStatus: 200,
        schema: {
          body: z
            .object({
              channel: AnyChannel,
              subject: z.string().max(200).optional(),
              body: z.string().min(1).max(50_000),
              data: z.record(z.string(), z.unknown()).default({}),
              school: z.string().max(100).optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.ok(await this.resolve<PreviewTemplate>(req, 'previewTemplate').execute(body)),
      }),
    ];
  }
}
