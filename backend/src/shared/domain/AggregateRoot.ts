import type { DomainEvent } from './DomainEvent.js';

export abstract class Entity<TProps> {
  protected constructor(
    readonly id: string,
    protected props: TProps,
  ) {}

  equals(other?: Entity<TProps>): boolean {
    return !!other && other.id === this.id;
  }
}

/**
 * Aggregate root: guards invariants and records domain events.
 * Repositories persist the aggregate and pass `pullEvents()` to the OutboxWriter in the same transaction.
 */
export abstract class AggregateRoot<TProps> extends Entity<TProps> {
  private readonly pendingEvents: DomainEvent[] = [];

  protected constructor(
    id: string,
    props: TProps,
    protected readonly loadedVersion = 0,
  ) {
    super(id, props);
  }

  protected record(event: DomainEvent): void {
    this.pendingEvents.push(event);
  }

  pullEvents(): DomainEvent[] {
    return this.pendingEvents.splice(0, this.pendingEvents.length);
  }

  get version(): number {
    return this.loadedVersion;
  }
}
