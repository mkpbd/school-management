import type { DomainEvent } from '../domain/DomainEvent.js';

/** One database transaction with the RLS context applied (implemented by infrastructure UnitOfWork). */
export interface TransactionRunner {
  run<T>(fn: () => Promise<T>, options?: { readOnly?: boolean }): Promise<T>;
}

/** Writes domain events to the transactional outbox (same transaction as the business change). */
export interface EventPublisher {
  write(events: DomainEvent[]): Promise<void>;
}

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSec: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  /** Read-through helper. */
  wrap<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T>;
}

export interface EnqueueOptions {
  /** Deduplication id: enqueuing the same jobId twice is a no-op. */
  jobId?: string;
  delayMs?: number;
  priority?: number;
  attempts?: number;
}

/** Background job queue (BullMQ in production, inline runner when Redis is not configured). */
export interface JobQueue {
  enqueue<T>(queue: string, name: string, data: T, options?: EnqueueOptions): Promise<void>;
}

/** Gap-free document numbers from core.number_sequence (row-locked inside the current transaction). */
export interface NumberAllocator {
  next(input: { campusId: string | null; key: string; periodKey?: string; date?: Date }): Promise<string>;
}

export interface PresignedUpload {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface FileStorage {
  presignUpload(input: {
    bucket: string;
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<PresignedUpload>;
  presignDownload(input: { bucket: string; key: string; fileName?: string; expiresInSec?: number }): Promise<string>;
  head(input: { bucket: string; key: string }): Promise<{ size: number; contentType?: string | undefined } | null>;
  put(input: { bucket: string; key: string; body: Buffer; contentType: string }): Promise<void>;
  getStream(input: { bucket: string; key: string }): Promise<NodeJS.ReadableStream>;
  delete(input: { bucket: string; key: string }): Promise<void>;
}

export interface Notification {
  eventCode: string;
  recipients: Array<{ userId?: string | null; phone?: string | null; email?: string | null; locale?: 'en' | 'bn' }>;
  data: Record<string, unknown>;
  /** Prevents duplicates, e.g. `att.absent:{studentId}:{date}`. */
  dedupeKey?: string;
  priority?: 'low' | 'normal' | 'high' | 'emergency';
  campusId?: string | null;
  /** Restrict to channels; default comes from com.notification_rule. */
  channels?: Array<'sms' | 'email' | 'push' | 'whatsapp' | 'in_app'>;
}

export interface Notifier {
  dispatch(notification: Notification): Promise<{ queued: number; suppressed: number }>;
}

/** Column-level encryption for NID, birth certificate, health, bank (docs/backend/cross-cutting.md §19). */
export interface FieldCipher {
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}

export interface BlindIndexer {
  /** Deterministic HMAC of the normalised value for exact-match lookup (`*_bidx` columns). */
  of(value: string): Buffer;
}
