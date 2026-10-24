import Handlebars from 'handlebars';
import type { TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import { InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { emailLayout, humanizeEvent, textToHtml } from '../domain/email.js';

/** Security and safety messages users cannot switch off (kept in sync with the notification hub). */
export const MANDATORY_EVENT_CODES: ReadonlySet<string> = new Set([
  'iam.otp',
  'com.emergency',
  'hst.overdue',
  'hst.absent',
]);

export interface TemplateRow {
  id: string;
  eventCode: string;
  channel: string;
  locale: string;
  version: number;
  subject: string | null;
  body: string;
  isActive: boolean;
}

export interface MessagingRepository {
  rules(): Promise<Array<{ eventCode: string; channels: string[] }>>;
  preferences(
    userId: string,
  ): Promise<
    Array<{ eventCode: string; channel: string; enabled: boolean; quietFrom: string | null; quietTo: string | null }>
  >;
  setPreference(userId: string, eventCode: string, channel: string, enabled: boolean): Promise<void>;
  setQuietHours(userId: string, q: { from: string; to: string } | null): Promise<void>;
  schoolQuietHours(): Promise<{ from: string; to: string } | null>;
  upsertDevice(
    userId: string,
    d: { token: string; app: string; platform: string; locale: 'en' | 'bn' | null },
  ): Promise<void>;
  devices(
    userId: string,
  ): Promise<Array<{ id: string; app: string; platform: string; lastSeenAt: Date; tokenTail: string }>>;
  revokeDevice(userId: string, token: string): Promise<boolean>;
  revokeDeviceById(userId: string, id: string): Promise<boolean>;
  inbox(
    userId: string,
    limit: number,
  ): Promise<Array<{ id: string; eventCode: string; subject: string | null; body: string; createdAt: Date }>>;
  templates(f: { eventCode?: string; channel?: string }): Promise<TemplateRow[]>;
  template(id: string): Promise<TemplateRow | null>;
  insertTemplate(values: Record<string, unknown>): Promise<string>;
  nextVersion(eventCode: string, channel: string, locale: string): Promise<number>;
  activateTemplate(t: TemplateRow, approvedBy: string): Promise<void>;
}

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  messagingRepo: MessagingRepository;
}

type Channel = 'sms' | 'email' | 'push' | 'whatsapp';

function me(ctx: RequestContext): string {
  if (!ctx.userId) throw new NotFoundError();
  return ctx.userId;
}

export interface Preferences {
  quietHours: { from: string; to: string } | null;
  schoolQuietHours: { from: string; to: string } | null;
  events: Array<{
    eventCode: string;
    label: string;
    mandatory: boolean;
    channels: Array<{ channel: string; enabled: boolean }>;
  }>;
}

/** Every event the school sends, its channels, and whether the user muted any of them; plus quiet hours. */
export class GetMyPreferences extends Query<Record<string, never>, Preferences> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle() {
    const userId = me(this.d.ctx);
    const prefs = await this.d.messagingRepo.preferences(userId);
    const off = new Set(prefs.filter((p) => !p.enabled).map((p) => `${p.eventCode}|${p.channel}`));
    const quiet = prefs.find((p) => p.eventCode === '*' && p.channel === '*' && p.quietFrom && p.quietTo);
    const byEvent = new Map<string, Set<string>>();
    for (const r of await this.d.messagingRepo.rules()) {
      const set = byEvent.get(r.eventCode) ?? new Set<string>();
      r.channels.filter((c) => c !== 'in_app').forEach((c) => set.add(c));
      byEvent.set(r.eventCode, set);
    }
    return {
      quietHours: quiet ? { from: quiet.quietFrom!.slice(0, 5), to: quiet.quietTo!.slice(0, 5) } : null,
      schoolQuietHours: await this.d.messagingRepo.schoolQuietHours(),
      events: [...byEvent.entries()].map(([eventCode, channels]) => ({
        eventCode,
        label: humanizeEvent(eventCode),
        mandatory: MANDATORY_EVENT_CODES.has(eventCode),
        // a user can also take e-mail / push for any event (the hub falls back to its SMS text)
        channels: [...new Set([...channels, 'email', 'push'])].map((channel) => ({
          channel,
          enabled: !off.has(`${eventCode}|${channel}`) && !off.has(`*|${channel}`),
        })),
      })),
    };
  }
}

export class UpdateMyPreferences extends UseCase<
  {
    quietHours?: { from: string; to: string } | null;
    settings?: Array<{ eventCode: string; channel: Channel; enabled: boolean }>;
  },
  { updated: number }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    quietHours?: { from: string; to: string } | null;
    settings?: Array<{ eventCode: string; channel: Channel; enabled: boolean }>;
  }) {
    const userId = me(this.d.ctx);
    if (i.quietHours !== undefined) {
      if (i.quietHours && i.quietHours.from === i.quietHours.to)
        throw new InvariantError('QUIET_HOURS_INVALID', 'Quiet hours need different start and end times');
      await this.d.messagingRepo.setQuietHours(userId, i.quietHours);
    }
    const known = new Set((await this.d.messagingRepo.rules()).map((r) => r.eventCode));
    for (const s of i.settings ?? []) {
      if (s.eventCode !== '*' && !known.has(s.eventCode))
        throw new InvariantError('EVENT_UNKNOWN', `Unknown notification ${s.eventCode}`);
      if (!s.enabled && MANDATORY_EVENT_CODES.has(s.eventCode))
        throw new InvariantError('MANDATORY_EVENT', `${s.eventCode} cannot be switched off (security / safety)`);
      await this.d.messagingRepo.setPreference(userId, s.eventCode, s.channel, s.enabled);
    }
    return { updated: (i.settings?.length ?? 0) + (i.quietHours !== undefined ? 1 : 0) };
  }
}

export class RegisterPushDevice extends UseCase<
  { token: string; app: 'parent' | 'staff' | 'web_push'; platform: 'android' | 'ios' | 'web'; locale?: 'en' | 'bn' },
  { registered: true }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    token: string;
    app: 'parent' | 'staff' | 'web_push';
    platform: 'android' | 'ios' | 'web';
    locale?: 'en' | 'bn';
  }) {
    await this.d.messagingRepo.upsertDevice(me(this.d.ctx), { ...i, locale: i.locale ?? null });
    return { registered: true as const };
  }
}

export class ListMyDevices extends Query<Record<string, never>, Awaited<ReturnType<MessagingRepository['devices']>>> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle() {
    return this.d.messagingRepo.devices(me(this.d.ctx));
  }
}

export class RevokePushDevice extends UseCase<{ token: string }, { revoked: boolean }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ token }: { token: string }) {
    return { revoked: await this.d.messagingRepo.revokeDevice(me(this.d.ctx), token) };
  }
}

/** Stop push to one of my devices chosen from the device list (no token needed); other users' devices: 404. */
export class RevokePushDeviceById extends UseCase<{ id: string }, { revoked: true }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    if (!(await this.d.messagingRepo.revokeDeviceById(me(this.d.ctx), id)))
      throw new NotFoundError('Device not found', 'DEVICE_NOT_FOUND');
    return { revoked: true as const };
  }
}

/** In-app notifications of the signed-in user (bound to their user id; run in a system scope by the controller). */
export class MyInbox extends Query<
  { userId: string; limit: number },
  Awaited<ReturnType<MessagingRepository['inbox']>>
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { userId: string; limit: number }) {
    return this.d.messagingRepo.inbox(i.userId, i.limit);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Templates (versioned; a new version is inactive until activated)
// ---------------------------------------------------------------------------------------------------------------

export class ListTemplates extends Query<{ eventCode?: string; channel?: string }, TemplateRow[]> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { eventCode?: string; channel?: string }) {
    return this.d.messagingRepo.templates(i);
  }
}

function compileCheck(source: string): void {
  try {
    Handlebars.precompile(source);
  } catch (err) {
    throw new InvariantError('TEMPLATE_INVALID', `Template does not compile: ${(err as Error).message.split('\n')[0]}`);
  }
}

export class CreateTemplateVersion extends UseCase<
  {
    eventCode: string;
    channel: 'sms' | 'email' | 'push' | 'whatsapp' | 'in_app';
    locale: 'en' | 'bn';
    subject?: string;
    body: string;
  },
  TemplateRow
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    eventCode: string;
    channel: 'sms' | 'email' | 'push' | 'whatsapp' | 'in_app';
    locale: 'en' | 'bn';
    subject?: string;
    body: string;
  }) {
    compileCheck(i.body);
    if (i.subject) compileCheck(i.subject);
    const version = await this.d.messagingRepo.nextVersion(i.eventCode, i.channel, i.locale);
    const id = await this.d.messagingRepo.insertTemplate({
      orgId: this.d.ctx.orgId,
      eventCode: i.eventCode,
      channel: i.channel,
      locale: i.locale,
      version,
      subject: i.subject ?? null,
      body: i.body,
      isActive: false,
    });
    return (await this.d.messagingRepo.template(id))!;
  }
}

export class ActivateTemplate extends UseCase<{ id: string }, TemplateRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const t = await this.d.messagingRepo.template(id);
    if (!t) throw new NotFoundError();
    await this.d.messagingRepo.activateTemplate(t, this.d.ctx.userId!);
    return (await this.d.messagingRepo.template(id))!;
  }
}

/** Renders a draft exactly as recipients would get it (e-mail inside the school layout). */
export class PreviewTemplate extends Query<
  {
    channel: 'sms' | 'email' | 'push' | 'whatsapp' | 'in_app';
    subject?: string;
    body: string;
    data: Record<string, unknown>;
    school?: string;
  },
  { subject: string | null; body: string }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: {
    channel: 'sms' | 'email' | 'push' | 'whatsapp' | 'in_app';
    subject?: string;
    body: string;
    data: Record<string, unknown>;
    school?: string;
  }) {
    compileCheck(i.body);
    const subject = i.subject ? Handlebars.compile(i.subject, { noEscape: true })(i.data).trim() : null;
    if (i.channel !== 'email') return { subject, body: Handlebars.compile(i.body, { noEscape: true })(i.data).trim() };
    const html = /<[a-z][\s\S]*>/i.test(i.body)
      ? Handlebars.compile(i.body)(i.data).trim()
      : textToHtml(Handlebars.compile(i.body, { noEscape: true })(i.data));
    return {
      subject,
      body: emailLayout({ school: i.school ?? 'School', title: subject ?? 'Preview', contentHtml: html }),
    };
  }
}
