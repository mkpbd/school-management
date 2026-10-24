import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  messageTemplate,
  notificationPreference,
  notificationRule,
  outboundMessage,
  pushDevice,
} from '../../../shared/infrastructure/db/schema/com.js';
import { setting } from '../../../shared/infrastructure/db/schema/core.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { MessagingRepository, TemplateRow } from '../application/MessagingUseCases.js';

const templateCols = {
  id: messageTemplate.id,
  eventCode: messageTemplate.eventCode,
  channel: messageTemplate.channel,
  locale: messageTemplate.locale,
  version: messageTemplate.version,
  subject: messageTemplate.subject,
  body: messageTemplate.body,
  isActive: messageTemplate.isActive,
};

/**
 * Per-user messaging data. push_device / notification_preference carry no tenant column: every query is bound to
 * the signed-in user's id.
 */
export class DrizzleMessagingRepository implements MessagingRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async rules() {
    return this.tx
      .select({ eventCode: notificationRule.eventCode, channels: notificationRule.channels })
      .from(notificationRule)
      .where(eq(notificationRule.isEnabled, true))
      .orderBy(notificationRule.eventCode);
  }

  async preferences(userId: string) {
    return this.tx
      .select({
        eventCode: notificationPreference.eventCode,
        channel: notificationPreference.channel,
        enabled: notificationPreference.enabled,
        quietFrom: notificationPreference.quietFrom,
        quietTo: notificationPreference.quietTo,
      })
      .from(notificationPreference)
      .where(eq(notificationPreference.userId, userId));
  }

  async setPreference(userId: string, eventCode: string, channel: string, enabled: boolean): Promise<void> {
    await this.tx
      .insert(notificationPreference)
      .values({ userId, eventCode, channel, enabled })
      .onConflictDoUpdate({
        target: [notificationPreference.userId, notificationPreference.eventCode, notificationPreference.channel],
        set: { enabled },
      });
  }

  async setQuietHours(userId: string, q: { from: string; to: string } | null): Promise<void> {
    if (!q) {
      await this.tx
        .delete(notificationPreference)
        .where(
          and(
            eq(notificationPreference.userId, userId),
            eq(notificationPreference.eventCode, '*'),
            eq(notificationPreference.channel, '*'),
          ),
        );
      return;
    }
    await this.tx
      .insert(notificationPreference)
      .values({ userId, eventCode: '*', channel: '*', enabled: true, quietFrom: q.from, quietTo: q.to })
      .onConflictDoUpdate({
        target: [notificationPreference.userId, notificationPreference.eventCode, notificationPreference.channel],
        set: { quietFrom: q.from, quietTo: q.to },
      });
  }

  async schoolQuietHours(): Promise<{ from: string; to: string } | null> {
    const [row] = await this.tx
      .select({ value: setting.value })
      .from(setting)
      .where(and(isNull(setting.campusId), eq(setting.key, 'notify.quiet_hours')));
    const v = row?.value as { from?: string; to?: string } | undefined;
    return v?.from && v.to ? { from: v.from, to: v.to } : null;
  }

  async upsertDevice(userId: string, d: { token: string; app: string; platform: string; locale: 'en' | 'bn' | null }) {
    // a token belongs to one install: re-registering moves it to the signed-in user
    await this.tx
      .insert(pushDevice)
      .values({ userId, token: d.token, app: d.app as never, platform: d.platform as never, locale: d.locale })
      .onConflictDoUpdate({
        target: pushDevice.token,
        set: {
          userId,
          app: d.app as never,
          platform: d.platform as never,
          locale: d.locale,
          lastSeenAt: sql`now()`,
          revokedAt: null,
        },
      });
  }

  async devices(userId: string) {
    return this.tx
      .select({
        id: pushDevice.id,
        app: pushDevice.app,
        platform: pushDevice.platform,
        lastSeenAt: pushDevice.lastSeenAt,
        tokenTail: sql<string>`right(${pushDevice.token}, 8)`,
      })
      .from(pushDevice)
      .where(and(eq(pushDevice.userId, userId), isNull(pushDevice.revokedAt)))
      .orderBy(desc(pushDevice.lastSeenAt));
  }

  async revokeDevice(userId: string, token: string): Promise<boolean> {
    const rows = await this.tx
      .update(pushDevice)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(pushDevice.userId, userId), eq(pushDevice.token, token), isNull(pushDevice.revokedAt)))
      .returning({ id: pushDevice.id });
    return rows.length > 0;
  }

  async revokeDeviceById(userId: string, id: string): Promise<boolean> {
    const rows = await this.tx
      .update(pushDevice)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(pushDevice.userId, userId), eq(pushDevice.id, id), isNull(pushDevice.revokedAt)))
      .returning({ id: pushDevice.id });
    return rows.length > 0;
  }

  async inbox(userId: string, limit: number) {
    return this.tx
      .select({
        id: outboundMessage.id,
        eventCode: outboundMessage.eventCode,
        subject: outboundMessage.subject,
        body: outboundMessage.body,
        createdAt: outboundMessage.createdAt,
      })
      .from(outboundMessage)
      .where(and(eq(outboundMessage.recipientUserId, userId), eq(outboundMessage.channel, 'in_app')))
      .orderBy(desc(outboundMessage.createdAt))
      .limit(limit);
  }

  async templates(f: { eventCode?: string; channel?: string }): Promise<TemplateRow[]> {
    return this.tx
      .select(templateCols)
      .from(messageTemplate)
      .where(
        and(
          f.eventCode ? eq(messageTemplate.eventCode, f.eventCode) : undefined,
          f.channel ? eq(messageTemplate.channel, f.channel as never) : undefined,
        ),
      )
      .orderBy(
        messageTemplate.eventCode,
        messageTemplate.channel,
        messageTemplate.locale,
        desc(messageTemplate.version),
      );
  }

  async template(id: string): Promise<TemplateRow | null> {
    const [r] = await this.tx.select(templateCols).from(messageTemplate).where(eq(messageTemplate.id, id));
    return r ?? null;
  }

  async insertTemplate(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(messageTemplate)
      .values(values as typeof messageTemplate.$inferInsert)
      .returning({ id: messageTemplate.id });
    return r!.id;
  }

  async nextVersion(eventCode: string, channel: string, locale: string): Promise<number> {
    const [r] = await this.tx
      .select({ v: sql<number>`coalesce(max(${messageTemplate.version}), 0)::int` })
      .from(messageTemplate)
      .where(
        and(
          eq(messageTemplate.eventCode, eventCode),
          eq(messageTemplate.channel, channel as never),
          eq(messageTemplate.locale, locale as never),
        ),
      );
    return (r?.v ?? 0) + 1;
  }

  async activateTemplate(t: TemplateRow, approvedBy: string): Promise<void> {
    await this.tx
      .update(messageTemplate)
      .set({ isActive: false })
      .where(
        and(
          eq(messageTemplate.eventCode, t.eventCode),
          eq(messageTemplate.channel, t.channel as never),
          eq(messageTemplate.locale, t.locale as never),
          eq(messageTemplate.isActive, true),
        ),
      );
    await this.tx.update(messageTemplate).set({ isActive: true, approvedBy }).where(eq(messageTemplate.id, t.id));
  }
}
