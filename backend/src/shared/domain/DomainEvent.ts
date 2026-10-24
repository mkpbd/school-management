/**
 * Versioned domain event contract (docs/backend/cross-cutting.md §9).
 * `type` follows `<module>.<past_tense_name>.v<version>`, e.g. `fee.payment_received.v1`.
 */
export type EventType = `${string}.${string}.v${number}`;

export interface DomainEvent<TPayload = Record<string, unknown>> {
  readonly type: EventType;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly orgId: string;
  readonly campusId?: string | undefined;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}

/** Event as delivered to subscribers (after the outbox assigned its id). */
export interface PublishedEvent<TPayload = Record<string, unknown>> extends Omit<DomainEvent<TPayload>, 'occurredAt'> {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly module: string;
}

export function moduleOf(type: EventType): string {
  return type.slice(0, type.indexOf('.'));
}
