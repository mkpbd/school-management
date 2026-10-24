import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { maskPhone } from '../../../shared/infrastructure/observability/logger.js';
import type { ChannelMessage, ChannelProvider } from '../application/ports.js';

/**
 * Development providers: log instead of sending. Production adds BTRC-licensed SMS, SES/SMTP, FCM and WhatsApp
 * adapters implementing the same ChannelProvider interface.
 */
abstract class ConsoleProvider implements ChannelProvider {
  abstract readonly channel: ChannelProvider['channel'];
  readonly sent: ChannelMessage[] = [];

  constructor(protected readonly logger: Logger) {}

  get name(): string {
    return `console-${this.channel}`;
  }

  async send(message: ChannelMessage): Promise<{ providerMessageId: string }> {
    this.sent.push(message);
    this.logger.info(
      {
        channel: this.channel,
        to: this.channel === 'sms' ? maskPhone(message.to) : '[redacted]',
        length: message.body.length,
      },
      'message sent (console provider)',
    );
    return { providerMessageId: `console-${randomUUID()}` };
  }
}

export class ConsoleSmsProvider extends ConsoleProvider {
  readonly channel = 'sms' as const;
}
export class ConsoleEmailProvider extends ConsoleProvider {
  readonly channel = 'email' as const;
}
export class ConsolePushProvider extends ConsoleProvider {
  readonly channel = 'push' as const;
}
export class ConsoleWhatsAppProvider extends ConsoleProvider {
  readonly channel = 'whatsapp' as const;
}
