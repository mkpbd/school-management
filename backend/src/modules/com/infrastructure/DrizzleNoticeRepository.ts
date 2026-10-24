import { and, asc, desc, eq, gt, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { notice, noticeAudience, noticeRead, noticeRecipient } from '../../../shared/infrastructure/db/schema/com.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { AudienceType } from '../domain/notice.js';
import type { NoticeRepository, NoticeRow } from '../application/noticePorts.js';

const cols = {
  id: notice.id,
  campusId: notice.campusId,
  titleEn: notice.titleEn,
  titleBn: notice.titleBn,
  bodyEn: notice.bodyEn,
  bodyBn: notice.bodyBn,
  category: notice.category,
  isCircular: notice.isCircular,
  circularNo: notice.circularNo,
  attachmentFileIds: notice.attachmentFileIds,
  priority: notice.priority,
  publishAt: notice.publishAt,
  expiresAt: notice.expiresAt,
  publishToWebsite: notice.publishToWebsite,
  sendSms: notice.sendSms,
  status: notice.status,
  publishedAt: notice.publishedAt,
  recipientCount: notice.recipientCount,
  createdBy: notice.createdBy,
};

const live = (now: Date): SQL =>
  and(eq(notice.status, 'published'), or(isNull(notice.expiresAt), gt(notice.expiresAt, now)))!;

/**
 * Notices. notice_audience / notice_read carry no tenant columns: they are only read or written for a notice that was
 * first loaded through the RLS-protected com.notice (or, for the feed, through the user's own recipient rows).
 */
export class DrizzleNoticeRepository implements NoticeRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async insert(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(notice)
      .values(values as typeof notice.$inferInsert)
      .returning({ id: notice.id });
    return r!.id;
  }

  async update(id: string, patch: Record<string, unknown>): Promise<void> {
    await this.tx.update(notice).set(patch).where(eq(notice.id, id));
  }

  async notice(id: string, forUpdate: boolean): Promise<NoticeRow | null> {
    const q = this.tx.select(cols).from(notice).where(eq(notice.id, id));
    const [r] = forUpdate ? await q.for('update') : await q;
    return r ?? null;
  }

  async setAudiences(noticeId: string, list: Array<{ type: AudienceType; id: string | null }>): Promise<void> {
    await this.tx.delete(noticeAudience).where(eq(noticeAudience.noticeId, noticeId));
    if (list.length)
      await this.tx
        .insert(noticeAudience)
        .values(list.map((a) => ({ noticeId, audienceType: a.type, audienceId: a.id })));
  }

  async audiences(noticeId: string) {
    const rows = await this.tx
      .select({ type: noticeAudience.audienceType, id: noticeAudience.audienceId })
      .from(noticeAudience)
      .where(eq(noticeAudience.noticeId, noticeId));
    return rows.map((r) => ({ type: r.type as AudienceType, id: r.id }));
  }

  async list(f: { status?: string; category?: string; campusId?: string; limit: number; offset: number }) {
    const where: SQL[] = [];
    if (f.status) where.push(eq(notice.status, f.status as NoticeRow['status']));
    if (f.category) where.push(eq(notice.category, f.category as never));
    if (f.campusId) where.push(or(isNull(notice.campusId), eq(notice.campusId, f.campusId))!);
    return this.tx
      .select(cols)
      .from(notice)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(notice.publishAt))
      .limit(f.limit)
      .offset(f.offset);
  }

  async addRecipients(noticeId: string, orgId: string, userIds: string[]): Promise<number> {
    let added = 0;
    for (let i = 0; i < userIds.length; i += 1000) {
      const rows = await this.tx
        .insert(noticeRecipient)
        .values(userIds.slice(i, i + 1000).map((userId) => ({ noticeId, userId, orgId })))
        .onConflictDoNothing()
        .returning({ u: noticeRecipient.userId });
      added += rows.length;
    }
    return added;
  }

  async recipients(noticeId: string): Promise<string[]> {
    const rows = await this.tx
      .select({ userId: noticeRecipient.userId })
      .from(noticeRecipient)
      .where(eq(noticeRecipient.noticeId, noticeId));
    return rows.map((r) => r.userId);
  }

  async isRecipient(noticeId: string, userId: string): Promise<boolean> {
    const [r] = await this.tx
      .select({ u: noticeRecipient.userId })
      .from(noticeRecipient)
      .where(and(eq(noticeRecipient.noticeId, noticeId), eq(noticeRecipient.userId, userId)));
    return !!r;
  }

  async markRead(noticeId: string, userId: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .insert(noticeRead)
      .values({ noticeId, userId, readAt: at })
      .onConflictDoNothing()
      .returning({ u: noticeRead.userId });
    return rows.length > 0;
  }

  async readers(noticeId: string): Promise<Map<string, Date>> {
    const rows = await this.tx
      .select({ userId: noticeRead.userId, readAt: noticeRead.readAt })
      .from(noticeRead)
      .where(eq(noticeRead.noticeId, noticeId));
    return new Map(rows.map((r) => [r.userId, r.readAt]));
  }

  async feed(userId: string, now: Date, f: { unreadOnly: boolean; limit: number; offset: number }) {
    const rows = await this.tx
      .select({ ...cols, readAt: noticeRead.readAt })
      .from(noticeRecipient)
      .innerJoin(notice, eq(notice.id, noticeRecipient.noticeId))
      .leftJoin(noticeRead, and(eq(noticeRead.noticeId, notice.id), eq(noticeRead.userId, userId)))
      .where(and(eq(noticeRecipient.userId, userId), live(now), f.unreadOnly ? isNull(noticeRead.readAt) : undefined))
      // emergencies and urgent notices first, then newest
      .orderBy(
        sql`CASE ${notice.priority} WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END`,
        desc(notice.publishedAt),
      )
      .limit(f.limit)
      .offset(f.offset);
    return rows;
  }

  async due(now: Date, limit: number): Promise<string[]> {
    const rows = await this.tx
      .select({ id: notice.id })
      .from(notice)
      .where(and(eq(notice.status, 'scheduled'), lte(notice.publishAt, now)))
      .orderBy(asc(notice.publishAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    return rows.map((r) => r.id);
  }

  async website(now: Date, campusId: string | null, limit: number): Promise<NoticeRow[]> {
    return this.tx
      .select(cols)
      .from(notice)
      .where(
        and(
          live(now),
          eq(notice.publishToWebsite, true),
          campusId ? or(isNull(notice.campusId), eq(notice.campusId, campusId)) : undefined,
        ),
      )
      .orderBy(desc(notice.publishedAt))
      .limit(limit);
  }
}
