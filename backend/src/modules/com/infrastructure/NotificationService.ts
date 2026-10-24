import Handlebars from 'handlebars';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { JobQueue, Notification, Notifier } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { SCHOOL_TIME_ZONE } from '../../../shared/domain/LocalDate.js';
import {
  messageDedupe,
  messageTemplate,
  notificationPreference,
  notificationRule,
  outboundMessage,
  pushDevice,
} from '../../../shared/infrastructure/db/schema/com.js';
import { setting } from '../../../shared/infrastructure/db/schema/core.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { Metrics } from '../../../shared/infrastructure/observability/metrics.js';
import { MANDATORY_EVENT_CODES } from '../application/MessagingUseCases.js';
import { emailLayout, humanizeEvent, textToHtml } from '../domain/email.js';
import { smsSegments } from '../domain/smsSegments.js';

type Channel = 'sms' | 'email' | 'push' | 'whatsapp' | 'in_app';
export const NOTIFY_QUEUE = 'notify';

/** Security and safety messages: users cannot switch these off. */
export const MANDATORY_EVENTS = MANDATORY_EVENT_CODES;

interface Template {
  id: string;
  version: number;
  subject: string | null;
  body: string;
}

/**
 * Notification hub (docs/backend/cross-cutting.md §12):
 * rule → channels → preferences / quiet hours → template (locale fallback) → dedupe → com.outbound_message → queue.
 * Every event can reach every channel: without an e-mail / push template the event's SMS text (or data.message) is
 * used; e-mails are rendered into the school HTML layout (template values HTML-escaped). Quiet hours: the user's own
 * window wins over the school's; high / emergency messages ignore both.
 * Runs inside the caller's transaction; channel jobs are enqueued after commit.
 */
export class NotificationService implements Notifier {
  private readonly compiled = new Map<string, Handlebars.TemplateDelegate>();

  constructor(
    private readonly d: {
      uow: UnitOfWork;
      ctx: RequestContext;
      jobQueue: JobQueue;
      clock: Clock;
      logger: Logger;
      metrics: Metrics;
      config: { WEB_BASE_URL: string };
    },
  ) {}

  dispatch(n: Notification): Promise<{ queued: number; suppressed: number }> {
    return this.d.uow.run(() => this.dispatchInTx(n));
  }

  private async dispatchInTx(n: Notification): Promise<{ queued: number; suppressed: number }> {
    const tx = this.d.uow.tx();
    const orgId = this.d.ctx.orgId;
    const priority = n.priority ?? 'normal';

    const rules = await tx
      .select({ channels: notificationRule.channels, respectQuietHours: notificationRule.respectQuietHours })
      .from(notificationRule)
      .where(
        and(
          eq(notificationRule.orgId, orgId),
          eq(notificationRule.eventCode, n.eventCode),
          eq(notificationRule.isEnabled, true),
        ),
      );
    const channels: Channel[] = n.channels ?? ([...new Set(rules.flatMap((r) => r.channels))] as Channel[]);
    if (!channels.length) channels.push('in_app');
    const respectQuiet = priority !== 'high' && priority !== 'emergency' && (rules[0]?.respectQuietHours ?? true);
    const schoolQuietEnd = respectQuiet ? await this.quietHoursEnd() : null;
    const school = typeof n.data.school === 'string' ? n.data.school : await this.schoolName();

    let queued = 0;
    let suppressed = 0;
    for (const recipient of n.recipients) {
      const locale = recipient.locale ?? 'bn';
      const userQuiet = respectQuiet && recipient.userId ? await this.userQuietHours(recipient.userId) : null;
      const scheduledFor = userQuiet ? quietHoursEnd(this.d.clock.now(), userQuiet.from, userQuiet.to) : schoolQuietEnd;
      for (const channel of channels) {
        if (
          recipient.userId &&
          !MANDATORY_EVENTS.has(n.eventCode) &&
          (await this.optedOut(recipient.userId, n.eventCode, channel))
        ) {
          suppressed++;
          continue;
        }
        const addresses = await this.addressesFor(channel, recipient);
        if (!addresses.length) continue;
        const content = await this.content(n, channel, locale, school);
        if (!content) {
          this.d.logger.warn({ event: n.eventCode, channel, locale }, 'no active template; message skipped');
          suppressed++;
          continue;
        }
        const { body, subject, template } = content;

        for (const address of addresses) {
          if (n.dedupeKey) {
            const key = `${n.dedupeKey}|${channel}|${address}`;
            const ins = await tx
              .insert(messageDedupe)
              .values({ dedupeKey: key, messageId: sql`uuidv7()` })
              .onConflictDoNothing()
              .returning({ k: messageDedupe.dedupeKey });
            if (!ins.length) {
              suppressed++;
              continue;
            }
          }
          const sms = channel === 'sms' || channel === 'whatsapp' ? smsSegments(body) : undefined;
          const [row] = await tx
            .insert(outboundMessage)
            .values({
              orgId,
              campusId: n.campusId ?? null,
              eventCode: n.eventCode,
              channel,
              priority,
              templateId: template?.id ?? null,
              templateVersion: template?.version ?? null,
              locale,
              recipientUserId: recipient.userId ?? null,
              recipientAddress: address,
              subject,
              body,
              dedupeKey: n.dedupeKey ?? null,
              status: channel === 'in_app' ? 'delivered' : 'queued',
              smsSegments: sms?.segments ?? null,
              smsEncoding: channel === 'sms' ? (sms?.encoding ?? null) : null,
              scheduledFor: channel === 'in_app' ? null : scheduledFor,
              deliveredAt: channel === 'in_app' ? this.d.clock.now() : null,
            })
            .returning({ id: outboundMessage.id, createdAt: outboundMessage.createdAt });
          this.d.metrics.notificationsQueued.inc({ channel, event: n.eventCode });
          queued++;
          if (channel !== 'in_app' && row) {
            const delayMs = scheduledFor ? Math.max(0, scheduledFor.getTime() - this.d.clock.now().getTime()) : 0;
            const payload = { orgId, messageId: row.id, createdAt: row.createdAt.toISOString() };
            const enqueue = () =>
              this.d.jobQueue.enqueue(NOTIFY_QUEUE, channel, payload, {
                jobId: `msg-${row.id}`,
                delayMs,
                priority: priority === 'emergency' ? 1 : priority === 'high' ? 2 : 5,
              });
            this.d.uow.afterCommit(enqueue);
          }
        }
      }
    }
    return { queued, suppressed };
  }

  /**
   * Text of one channel: its own template, else (for e-mail / push / in-app) the event's SMS template, else
   * data.message. E-mail bodies become full HTML documents in the school layout.
   */
  private async content(
    n: Notification,
    channel: Channel,
    locale: 'en' | 'bn',
    school: string,
  ): Promise<{ body: string; subject: string | null; template: Template | undefined } | undefined> {
    const own = await this.template(n.eventCode, channel, locale);
    const fallback =
      !own && channel !== 'sms' && channel !== 'whatsapp' ? await this.template(n.eventCode, 'sms', locale) : undefined;
    const message = typeof n.data.message === 'string' ? n.data.message : undefined;
    if (!own && !fallback && !message) return undefined;
    const title =
      (typeof n.data.title === 'string' && n.data.title) ||
      (typeof n.data.subject === 'string' && n.data.subject) ||
      humanizeEvent(n.eventCode);
    const subject = own?.subject
      ? this.renderText(`${own.id}:subject`, own.subject, n.data)
      : channel === 'push'
        ? school
        : null;
    if (channel !== 'email') {
      const body = own ? this.render(own, n.data) : fallback ? this.render(fallback, n.data) : message!;
      return { body, subject, template: own ?? fallback };
    }
    // e-mail: an e-mail template is HTML (values escaped); anything else is text turned into HTML
    const contentHtml = own
      ? this.renderHtml(own, n.data)
      : textToHtml(fallback ? this.render(fallback, n.data) : message!);
    const emailSubject = subject ?? `${title} - ${school}`;
    return {
      body: emailLayout({
        school,
        title: subject ?? title,
        contentHtml,
        preferencesUrl: `${this.d.config.WEB_BASE_URL}/settings/notifications`,
        locale,
      }),
      subject: emailSubject,
      template: own ?? fallback,
    };
  }

  private renderHtml(t: Template, data: Record<string, unknown>): string {
    let fn = this.compiled.get(`${t.id}:${t.version}:html`);
    if (!fn) {
      fn = Handlebars.compile(t.body, { noEscape: false, strict: false });
      this.compiled.set(`${t.id}:${t.version}:html`, fn);
    }
    return fn(data).trim();
  }

  private async schoolName(): Promise<string> {
    const [row] = await this.d.uow
      .tx()
      .select({ value: setting.value })
      .from(setting)
      .where(
        and(eq(setting.orgId, this.d.ctx.orgId), sql`${setting.campusId} IS NULL`, eq(setting.key, 'org.display_name')),
      );
    return typeof row?.value === 'string' ? row.value : 'School';
  }

  /** The user's own quiet window (preference row event '*', channel '*'). */
  private async userQuietHours(userId: string): Promise<{ from: string; to: string } | null> {
    const [row] = await this.d.uow
      .tx()
      .select({ from: notificationPreference.quietFrom, to: notificationPreference.quietTo })
      .from(notificationPreference)
      .where(
        and(
          eq(notificationPreference.userId, userId),
          eq(notificationPreference.eventCode, '*'),
          eq(notificationPreference.channel, '*'),
        ),
      );
    return row?.from && row.to ? { from: row.from.slice(0, 5), to: row.to.slice(0, 5) } : null;
  }

  private async addressesFor(channel: Channel, r: Notification['recipients'][number]): Promise<string[]> {
    switch (channel) {
      case 'sms':
      case 'whatsapp':
        return r.phone ? [r.phone] : [];
      case 'email':
        return r.email ? [r.email] : [];
      case 'in_app':
        return r.userId ? [r.userId] : [];
      case 'push': {
        if (!r.userId) return [];
        const rows = await this.d.uow
          .tx()
          .select({ token: pushDevice.token })
          .from(pushDevice)
          .where(and(eq(pushDevice.userId, r.userId), sql`${pushDevice.revokedAt} IS NULL`));
        return rows.map((x) => x.token);
      }
    }
  }

  private async optedOut(userId: string, eventCode: string, channel: Channel): Promise<boolean> {
    const rows = await this.d.uow
      .tx()
      .select({ enabled: notificationPreference.enabled })
      .from(notificationPreference)
      .where(
        and(
          eq(notificationPreference.userId, userId),
          eq(notificationPreference.channel, channel),
          inArray(notificationPreference.eventCode, [eventCode, '*']),
        ),
      );
    return rows.some((r) => r.enabled === false);
  }

  private async template(eventCode: string, channel: Channel, locale: 'en' | 'bn'): Promise<Template | undefined> {
    const rows = await this.d.uow
      .tx()
      .select({
        id: messageTemplate.id,
        version: messageTemplate.version,
        subject: messageTemplate.subject,
        body: messageTemplate.body,
        locale: messageTemplate.locale,
      })
      .from(messageTemplate)
      .where(
        and(
          eq(messageTemplate.orgId, this.d.ctx.orgId),
          eq(messageTemplate.eventCode, eventCode),
          eq(messageTemplate.channel, channel),
          eq(messageTemplate.isActive, true),
        ),
      );
    return rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === 'en');
  }

  private render(t: Template, data: Record<string, unknown>): string {
    return this.renderText(`${t.id}:${t.version}`, t.body, data);
  }

  private renderText(cacheKey: string, source: string, data: Record<string, unknown>): string {
    let fn = this.compiled.get(cacheKey);
    if (!fn) {
      fn = Handlebars.compile(source, { noEscape: true, strict: false });
      this.compiled.set(cacheKey, fn);
    }
    return fn(data).trim();
  }

  /** If now is inside the configured quiet hours (Asia/Dhaka), returns when they end; else null. */
  private async quietHoursEnd(): Promise<Date | null> {
    const [row] = await this.d.uow
      .tx()
      .select({ value: setting.value })
      .from(setting)
      .where(
        and(
          eq(setting.orgId, this.d.ctx.orgId),
          sql`${setting.campusId} IS NULL`,
          eq(setting.key, 'notify.quiet_hours'),
        ),
      );
    const cfg = row?.value as { from?: string; to?: string } | undefined;
    if (!cfg?.from || !cfg.to) return null;
    return quietHoursEnd(this.d.clock.now(), cfg.from, cfg.to);
  }
}

/** Pure helper (exported for tests): end of the quiet window containing `now`, or null if outside it. */
export function quietHoursEnd(now: Date, from: string, to: string): Date | null {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHOOL_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const [h, m] = fmt.format(now).split(':').map(Number) as [number, number];
  const minutes = h * 60 + m;
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const start = toMin(from);
  const end = toMin(to);
  const inside = start > end ? minutes >= start || minutes < end : minutes >= start && minutes < end;
  if (!inside) return null;
  const waitMin = (end - minutes + 1440) % 1440;
  return new Date(now.getTime() + waitMin * 60_000 - now.getSeconds() * 1000);
}
