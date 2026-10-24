import type { AudienceType } from '../domain/notice.js';

export type NoticeStatus = 'draft' | 'scheduled' | 'published' | 'withdrawn';
export type NoticePriority = 'normal' | 'urgent' | 'emergency';

export interface NoticeRow {
  id: string;
  campusId: string | null;
  titleEn: string;
  titleBn: string | null;
  bodyEn: string;
  bodyBn: string | null;
  category: string;
  isCircular: boolean;
  circularNo: string | null;
  attachmentFileIds: string[];
  priority: NoticePriority;
  publishAt: Date;
  expiresAt: Date | null;
  publishToWebsite: boolean;
  sendSms: boolean;
  status: NoticeStatus;
  publishedAt: Date | null;
  recipientCount: number | null;
  createdBy: string | null;
  audiences?: Array<{ type: AudienceType; id: string | null }>;
}

export interface NoticeRepository {
  insert(values: Record<string, unknown>): Promise<string>;
  update(id: string, patch: Record<string, unknown>): Promise<void>;
  notice(id: string, forUpdate: boolean): Promise<NoticeRow | null>;
  setAudiences(noticeId: string, list: Array<{ type: AudienceType; id: string | null }>): Promise<void>;
  audiences(noticeId: string): Promise<Array<{ type: AudienceType; id: string | null }>>;
  list(f: {
    status?: string;
    category?: string;
    campusId?: string;
    limit: number;
    offset: number;
  }): Promise<NoticeRow[]>;
  addRecipients(noticeId: string, orgId: string, userIds: string[]): Promise<number>;
  recipients(noticeId: string): Promise<string[]>;
  isRecipient(noticeId: string, userId: string): Promise<boolean>;
  markRead(noticeId: string, userId: string, at: Date): Promise<boolean>;
  readers(noticeId: string): Promise<Map<string, Date>>;
  feed(
    userId: string,
    now: Date,
    f: { unreadOnly: boolean; limit: number; offset: number },
  ): Promise<Array<NoticeRow & { readAt: Date | null }>>;
  due(now: Date, limit: number): Promise<string[]>;
  website(now: Date, campusId: string | null, limit: number): Promise<NoticeRow[]>;
}
