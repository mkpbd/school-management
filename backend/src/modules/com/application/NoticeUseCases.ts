import type {
  EventPublisher,
  Notifier,
  NumberAllocator,
  TransactionRunner,
} from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { ConflictError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import type { HrmModuleApi } from '../../hrm/public-api/HrmModuleApi.js';
import type { IamModuleApi } from '../../iam/public-api/IamModuleApi.js';
import type { FilesModuleApi } from '../../platform/public-api/FilesModuleApi.js';
import type { SisModuleApi } from '../../sis/public-api/SisModuleApi.js';
import { normaliseAudiences, summary, type Audience, type AudienceType } from '../domain/notice.js';
import type { NoticeRepository, NoticeRow } from './noticePorts.js';

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  noticeRepo: NoticeRepository;
  scopePolicy: ScopePolicy;
  outbox: EventPublisher;
  numbers: NumberAllocator;
  notifier: Notifier;
  sisApi: SisModuleApi;
  hrmApi: HrmModuleApi;
  iamApi: IamModuleApi;
  filesApi: FilesModuleApi;
  coreApi: CoreModuleApi;
}

export interface NoticeInput {
  campusId?: string | null;
  titleEn: string;
  titleBn?: string;
  bodyEn: string;
  bodyBn?: string;
  category?: 'general' | 'academic' | 'exam' | 'event' | 'holiday' | 'fee' | 'transport' | 'circular';
  isCircular?: boolean;
  priority?: 'normal' | 'urgent' | 'emergency';
  publishAt?: string;
  expiresAt?: string;
  publishToWebsite?: boolean;
  sendSms?: boolean;
  attachmentFileIds?: string[];
  audiences: Audience[];
}

async function editableNotice(d: Deps, id: string): Promise<NoticeRow> {
  const n = await d.noticeRepo.notice(id, true);
  if (!n) throw new NotFoundError();
  if (n.campusId) d.scopePolicy.requireCampus(n.campusId);
  else if (d.ctx.campusIds !== '*') throw new NotFoundError(); // all-campus notices: organisation-wide staff only
  return n;
}

async function validated(d: Deps, i: NoticeInput) {
  // a campus-scoped author writes for their campus; only organisation-wide authors may address every campus
  const campusId = i.campusId === null ? null : d.scopePolicy.requireCampus(i.campusId);
  if (campusId === null && d.ctx.campusIds !== '*')
    throw new InvariantError('CAMPUS_REQUIRED', 'Choose the campus of the notice');
  for (const f of i.attachmentFileIds ?? []) await d.filesApi.requireUsable(f, 'notice_attachment');
  if (i.expiresAt && i.publishAt && i.expiresAt <= i.publishAt)
    throw new InvariantError('DATE_RANGE_INVALID', 'The notice would expire before it is published');
  return { campusId, audiences: normaliseAudiences(i.audiences) };
}

/** Resolves the audience of a notice into login accounts (guardians, students, staff, roles, individuals). */
async function resolveRecipients(
  d: Deps,
  campusId: string | null,
  audiences: Array<{ type: AudienceType; id: string | null }>,
): Promise<string[]> {
  const today = LocalDate.today(d.clock).iso;
  const users = new Set<string>();
  const add = (ids: string[]) => ids.forEach((u) => users.add(u));
  const viaStudents = async (
    f: Partial<Parameters<SisModuleApi['audienceUsers']>[0]>,
    students = true,
    guardians = true,
  ) => {
    const r = await d.sisApi.audienceUsers({ onDate: today, campusId, ...f, students, guardians });
    add(r.studentUserIds);
    add(r.guardianUserIds);
  };
  for (const a of audiences) {
    switch (a.type) {
      case 'everyone':
        await viaStudents({});
        add(await d.hrmApi.staffUserIds(campusId));
        break;
      case 'campus':
        if (campusId && a.id !== campusId)
          throw new InvariantError('AUDIENCE_INVALID', 'Another campus than the notice');
        await viaStudents({ campusId: a.id });
        add(await d.hrmApi.staffUserIds(a.id));
        break;
      case 'year_group':
        await viaStudents({ yearGroupIds: [a.id!] });
        break;
      case 'class_section':
        await viaStudents({ sectionIds: [a.id!] });
        break;
      case 'house':
        await viaStudents({ houseIds: [a.id!] });
        break;
      case 'guardians':
        await viaStudents({}, false, true);
        break;
      case 'students':
        await viaStudents({}, true, false);
        break;
      case 'staff':
        add(await d.hrmApi.staffUserIds(campusId));
        break;
      case 'role':
        add(await d.iamApi.usersWithRole(a.id!, campusId));
        break;
      case 'user':
        add([a.id!]);
        break;
    }
  }
  return [...users];
}

export class CreateNotice extends UseCase<NoticeInput & { publishNow?: boolean }, NoticeRow> {
  constructor(private readonly d: Deps & { publishNotice: PublishNotice }) {
    super(d.uow);
  }
  protected async handle(i: NoticeInput & { publishNow?: boolean }) {
    const { d } = this;
    const { campusId, audiences } = await validated(d, i);
    const id = await d.noticeRepo.insert({
      orgId: d.ctx.orgId,
      campusId,
      titleEn: i.titleEn,
      titleBn: i.titleBn ?? null,
      bodyEn: i.bodyEn,
      bodyBn: i.bodyBn ?? null,
      category: i.isCircular ? 'circular' : (i.category ?? 'general'),
      isCircular: !!i.isCircular,
      priority: i.priority ?? 'normal',
      publishAt: i.publishAt ? new Date(i.publishAt) : d.clock.now(),
      expiresAt: i.expiresAt ? new Date(i.expiresAt) : null,
      publishToWebsite: !!i.publishToWebsite,
      sendSms: !!i.sendSms,
      attachmentFileIds: i.attachmentFileIds ?? [],
    });
    await d.noticeRepo.setAudiences(id, audiences);
    if (i.publishNow) return d.publishNotice.execute({ id });
    return { ...(await d.noticeRepo.notice(id, false))!, audiences };
  }
}

export class UpdateNotice extends UseCase<{ id: string } & NoticeInput, NoticeRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id, ...i }: { id: string } & NoticeInput) {
    const { d } = this;
    const n = await editableNotice(d, id);
    if (n.status !== 'draft' && n.status !== 'scheduled')
      throw new ConflictError(
        'NOTICE_PUBLISHED',
        'A published notice cannot be edited; withdraw it and post a new one',
      );
    const { campusId, audiences } = await validated(d, i);
    await d.noticeRepo.update(id, {
      campusId,
      titleEn: i.titleEn,
      titleBn: i.titleBn ?? null,
      bodyEn: i.bodyEn,
      bodyBn: i.bodyBn ?? null,
      category: i.isCircular ? 'circular' : (i.category ?? 'general'),
      isCircular: !!i.isCircular,
      priority: i.priority ?? 'normal',
      publishAt: i.publishAt ? new Date(i.publishAt) : d.clock.now(),
      expiresAt: i.expiresAt ? new Date(i.expiresAt) : null,
      publishToWebsite: !!i.publishToWebsite,
      sendSms: !!i.sendSms,
      attachmentFileIds: i.attachmentFileIds ?? [],
      status: 'draft',
    });
    await d.noticeRepo.setAudiences(id, audiences);
    return { ...(await d.noticeRepo.notice(id, false))!, audiences };
  }
}

/**
 * Publishes now, or schedules when publishAt is in the future. Publishing resolves the audience once (recipients
 * kept for the feed and read receipts), numbers circulars, and hands delivery to the notification hub.
 */
export class PublishNotice extends UseCase<{ id: string }, NoticeRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const { d } = this;
    const n = d.ctx.userType === 'system' ? await d.noticeRepo.notice(id, true) : await editableNotice(d, id);
    if (!n) throw new NotFoundError();
    if (n.status !== 'draft' && n.status !== 'scheduled')
      throw new ConflictError('NOTICE_PUBLISHED', `Notice is ${n.status}`);
    const now = d.clock.now();
    if (n.publishAt > now) {
      await d.noticeRepo.update(id, { status: 'scheduled' });
      return { ...(await d.noticeRepo.notice(id, false))!, audiences: await d.noticeRepo.audiences(id) };
    }
    const audiences = await d.noticeRepo.audiences(id);
    const userIds = await resolveRecipients(d, n.campusId, audiences);
    const count = await d.noticeRepo.addRecipients(id, d.ctx.orgId, userIds);
    const circularNo =
      n.isCircular && !n.circularNo ? await d.numbers.next({ campusId: null, key: 'circular' }) : n.circularNo;
    await d.noticeRepo.update(id, {
      status: 'published',
      publishedAt: now,
      publishedBy: d.ctx.userType === 'system' ? null : d.ctx.userId,
      recipientCount: count,
      circularNo,
    });
    await d.outbox.write([
      {
        type: 'com.notice_published.v1',
        aggregateType: 'notice',
        aggregateId: id,
        orgId: d.ctx.orgId,
        campusId: n.campusId ?? undefined,
        occurredAt: now,
        payload: { noticeId: id, priority: n.priority, recipients: count },
      },
    ]);
    return { ...(await d.noticeRepo.notice(id, false))!, audiences };
  }
}

/** Delivery of a published notice (subscriber): push to everyone; SMS / e-mail for urgent ones or when asked. */
export class DeliverNotice extends UseCase<{ noticeId: string }, { recipients: number; queued: number }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ noticeId }: { noticeId: string }) {
    const { d } = this;
    const n = await d.noticeRepo.notice(noticeId, false);
    if (!n || n.status !== 'published') return { recipients: 0, queued: 0 };
    const urgent = n.priority !== 'normal';
    const channels: Array<'sms' | 'push' | 'email' | 'in_app'> = urgent ? ['push', 'sms', 'email'] : ['push'];
    if (n.sendSms && !channels.includes('sms')) channels.push('sms');
    const userIds = await d.noticeRepo.recipients(noticeId);
    const school = n.campusId ? ((await d.coreApi.getCampus(n.campusId))?.nameEn ?? 'School') : 'School';
    let queued = 0;
    for (let i = 0; i < userIds.length; i += 500) {
      const contacts = await d.iamApi.contacts(userIds.slice(i, i + 500));
      if (!contacts.size) continue;
      const r = await d.notifier.dispatch({
        eventCode: urgent ? 'com.notice_urgent' : 'com.notice_published',
        channels,
        recipients: [...contacts.values()].map((c) => ({
          userId: c.userId,
          phone: c.phone ?? undefined,
          email: c.email,
          locale: c.locale,
        })),
        data: {
          title: n.titleEn,
          title_bn: n.titleBn ?? n.titleEn,
          summary: summary(n.bodyEn),
          body: n.bodyEn,
          body_bn: n.bodyBn ?? n.bodyEn,
          circular_no: n.circularNo ?? '',
          school,
          message: `${n.titleEn}: ${summary(n.bodyEn)}`,
        },
        dedupeKey: `com.notice:${noticeId}`,
        campusId: n.campusId,
        priority: n.priority === 'emergency' ? 'emergency' : urgent ? 'high' : 'normal',
      });
      queued += r.queued;
    }
    return { recipients: userIds.length, queued };
  }
}

export class WithdrawNotice extends UseCase<{ id: string; reason?: string }, NoticeRow> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string; reason?: string }) {
    const n = await editableNotice(this.d, id);
    if (n.status === 'withdrawn') throw new ConflictError('NOTICE_WITHDRAWN', 'Already withdrawn');
    await this.d.noticeRepo.update(id, { status: 'withdrawn', withdrawnAt: this.d.clock.now() });
    return (await this.d.noticeRepo.notice(id, false))!;
  }
}

/** Scheduled notices whose time has come (job every minute; system context). */
export class PublishDueNotices extends UseCase<Record<string, never>, { published: number }> {
  constructor(private readonly d: Deps & { publishNotice: PublishNotice }) {
    super(d.uow);
  }
  protected async handle() {
    const ids = await this.d.noticeRepo.due(this.d.clock.now(), 50);
    for (const id of ids) await this.d.publishNotice.execute({ id });
    return { published: ids.length };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------

export class ListNotices extends Query<
  { status?: string; category?: string; campusId?: string; limit: number; offset: number },
  NoticeRow[]
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { status?: string; category?: string; campusId?: string; limit: number; offset: number }) {
    return this.d.noticeRepo.list(i);
  }
}

/** The signed-in user's notice board: notices addressed to them, unread flag; urgent first. */
export class MyNotices extends Query<
  { unreadOnly?: boolean; limit: number; offset: number },
  Array<NoticeRow & { readAt: Date | null }>
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected handle(i: { unreadOnly?: boolean; limit: number; offset: number }) {
    return this.d.noticeRepo.feed(this.d.ctx.userId!, this.d.clock.now(), { ...i, unreadOnly: !!i.unreadOnly });
  }
}

/** A notice for its author / admins (any state) or for one of its recipients (published only). */
export class GetNotice extends Query<{ id: string }, NoticeRow & { readAt?: Date | null }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const n = await this.d.noticeRepo.notice(id, false);
    if (!n) throw new NotFoundError();
    if (this.d.scopePolicy.has('com.notice.view')) return { ...n, audiences: await this.d.noticeRepo.audiences(id) };
    if (n.status !== 'published' || !(await this.d.noticeRepo.isRecipient(id, this.d.ctx.userId!)))
      throw new NotFoundError();
    return { ...n, readAt: (await this.d.noticeRepo.readers(id)).get(this.d.ctx.userId!) ?? null };
  }
}

/** Attachment of a notice for its readers: recipients of a published notice, or staff who manage notices. */
export class GetNoticeAttachmentUrl extends Query<
  { id: string; fileId: string },
  { url: string; expiresInSec: number; fileName: string | null }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id, fileId }: { id: string; fileId: string }) {
    const n = await this.d.noticeRepo.notice(id, false);
    if (!n || !n.attachmentFileIds.includes(fileId)) throw new NotFoundError();
    if (!this.d.scopePolicy.has('com.notice.view')) {
      if (n.status !== 'published' || !(await this.d.noticeRepo.isRecipient(id, this.d.ctx.userId!)))
        throw new NotFoundError();
    }
    return this.d.filesApi.downloadUrl(fileId, 'notice_attachment');
  }
}

export class MarkNoticeRead extends UseCase<{ id: string }, { id: string; firstRead: boolean }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const userId = this.d.ctx.userId!;
    const n = await this.d.noticeRepo.notice(id, false);
    if (!n || n.status !== 'published' || !(await this.d.noticeRepo.isRecipient(id, userId))) throw new NotFoundError();
    return { id, firstRead: await this.d.noticeRepo.markRead(id, userId, this.d.clock.now()) };
  }
}

export interface ReadReceipts {
  noticeId: string;
  recipients: number;
  read: number;
  readPercent: number;
  byType: Record<string, { recipients: number; read: number }>;
  unread: Array<{ userId: string; userType: string; contact: string | null }>;
}

/** Who has read the notice, by guardians / students / staff, with the unread list (contact masked). */
export class GetReadReceipts extends Query<{ id: string }, ReadReceipts> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const n = await this.d.noticeRepo.notice(id, false);
    if (!n) throw new NotFoundError();
    const recipients = await this.d.noticeRepo.recipients(id);
    const readers = await this.d.noticeRepo.readers(id);
    const contacts = await this.d.iamApi.contacts(recipients);
    const byType: ReadReceipts['byType'] = {};
    const unread: ReadReceipts['unread'] = [];
    for (const u of recipients) {
      const c = contacts.get(u);
      const type = c?.userType ?? 'unknown';
      byType[type] ??= { recipients: 0, read: 0 };
      byType[type]!.recipients++;
      if (readers.has(u)) byType[type]!.read++;
      else if (unread.length < 500) {
        const phone = c?.phone;
        unread.push({
          userId: u,
          userType: type,
          contact: phone ? `${phone.slice(0, 6)}****${phone.slice(-3)}` : null,
        });
      }
    }
    const read = recipients.filter((u) => readers.has(u)).length;
    return {
      noticeId: id,
      recipients: recipients.length,
      read,
      readPercent: recipients.length ? Math.round((read / recipients.length) * 1000) / 10 : 0,
      byType,
      unread,
    };
  }
}

/** Public website listing (no login; system context in the controller). */
export class WebsiteNotices extends Query<
  { campusId?: string; limit: number },
  Array<
    Pick<
      NoticeRow,
      'id' | 'titleEn' | 'titleBn' | 'bodyEn' | 'bodyBn' | 'category' | 'circularNo' | 'publishedAt' | 'expiresAt'
    >
  >
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { campusId?: string; limit: number }) {
    const rows = await this.d.noticeRepo.website(this.d.clock.now(), i.campusId ?? null, i.limit);
    return rows.map(({ id, titleEn, titleBn, bodyEn, bodyBn, category, circularNo, publishedAt, expiresAt }) => ({
      id,
      titleEn,
      titleBn,
      bodyEn,
      bodyBn,
      category,
      circularNo,
      publishedAt,
      expiresAt,
    }));
  }
}
