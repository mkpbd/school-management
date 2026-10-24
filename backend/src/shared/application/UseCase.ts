import type { TransactionRunner } from './ports.js';

/**
 * Command use case: one business action, one database transaction (primary).
 * Subclasses implement `handle`; callers use `execute`.
 */
export abstract class UseCase<I, O> {
  protected constructor(protected readonly tx: TransactionRunner) {}

  execute(input: I): Promise<O> {
    return this.tx.run(() => this.handle(input));
  }

  protected abstract handle(input: I): Promise<O>;
}

/** Read use case: read-only transaction (replica when configured). */
export abstract class Query<I, O> {
  protected constructor(protected readonly tx: TransactionRunner) {}

  execute(input: I): Promise<O> {
    return this.tx.run(() => this.handle(input), { readOnly: true });
  }

  protected abstract handle(input: I): Promise<O>;
}
