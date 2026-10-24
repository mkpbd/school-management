import { and, between, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { outboundMessage, pushDevice } from '../../../shared/infrastructure/db/schema/com.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { JobContext, JobHandler, JobPayload } from '../../../shared/infrastructure/queue/jobs.js';
import { PermanentDeliveryError, type ProviderRegistry } from '../application/ports.js';

interface SendPayload extends JobPayload {
  messageId: string;
  createdAt: string;
}

/**
 * Sends one com.outbound_message through the channel's providers (primary, then fallback after 2 failed attempts).
 * Idempotent: a message that is no longer `queued` is skipped (duplicate job or replay).
 */
export class SendMessageJob implements JobHandler<SendPayload> {
  constructor(private readonly d: { uow: UnitOfWork; providers: ProviderRegistry; logger: Logger }) {}

  async handle(data: SendPayload, job: JobContext): Promise<void> {
    // created_at narrows the search to one monthly partition; JS Dates are ms-precision while PostgreSQL stores µs,
    // so match a ±1 s window instead of equality
    const created = new Date(data.createdAt).getTime();
    const key = and(
      eq(outboundMessage.id, data.messageId),
      between(outboundMessage.createdAt, new Date(created - 1_000), new Date(created + 1_000)),
    );
    const message = await this.d.uow.run(async () => {
      const [m] = await this.d.uow.tx().select().from(outboundMessage).where(key).for('update');
      if (!m || (m.status !== 'queued' && m.status !== 'throttled')) return undefined;
      await this.d.uow
        .tx()
        .update(outboundMessage)
        .set({ status: 'sending', attempts: sql`${outboundMessage.attempts} + 1` })
        .where(key);
      return m;
    });
    if (!message) return;

    const providers = this.d.providers.for(message.channel);
    const provider = providers[job.attempt > 2 && providers.length > 1 ? 1 : 0];
    if (!provider) {
      await this.d.uow.run(() =>
        this.d.uow
          .tx()
          .update(outboundMessage)
          .set({ status: 'undeliverable', lastError: `no provider for ${message.channel}` })
          .where(key),
      );
      return;
    }
    try {
      // external I/O happens outside any transaction
      const { providerMessageId } = await provider.send({
        to: message.recipientAddress,
        subject: message.subject,
        body: message.body,
        unicode: message.smsEncoding === 'ucs2',
      });
      await this.d.uow.run(() =>
        this.d.uow
          .tx()
          .update(outboundMessage)
          .set({ status: 'sent', provider: provider.name, providerMessageId, sentAt: new Date(), lastError: null })
          .where(key),
      );
    } catch (err) {
      if (err instanceof PermanentDeliveryError) {
        // never retried; an uninstalled app's push token is revoked so it is not tried again
        await this.d.uow.run(async () => {
          await this.d.uow
            .tx()
            .update(outboundMessage)
            .set({ status: 'undeliverable', provider: provider.name, lastError: err.message.slice(0, 500) })
            .where(key);
          if (err.options.revokeAddress && message.channel === 'push')
            await this.d.uow
              .tx()
              .update(pushDevice)
              .set({ revokedAt: new Date() })
              .where(eq(pushDevice.token, message.recipientAddress));
        });
        return;
      }
      await this.d.uow.run(() =>
        this.d.uow
          .tx()
          .update(outboundMessage)
          .set({ status: 'queued', provider: provider.name, lastError: String((err as Error).message).slice(0, 500) })
          .where(key),
      );
      throw err; // queue retries with back-off
    }
  }
}
