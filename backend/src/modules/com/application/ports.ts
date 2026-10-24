/** Channel adapters (docs/backend/cross-cutting.md §12). Real providers implement these behind the same interfaces. */
export interface ChannelMessage {
  to: string;
  subject?: string | null;
  body: string;
  /** sms only */
  unicode?: boolean;
}

/** A delivery that will never succeed (bad address, uninstalled app): not retried; the address may be revoked. */
export class PermanentDeliveryError extends Error {
  constructor(
    message: string,
    readonly options: { revokeAddress?: boolean } = {},
  ) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}

export interface ChannelProvider {
  readonly name: string;
  readonly channel: 'sms' | 'email' | 'push' | 'whatsapp';
  send(message: ChannelMessage): Promise<{ providerMessageId: string }>;
}

export class ProviderRegistry {
  private readonly byChannel = new Map<string, ChannelProvider[]>();

  constructor(providers: ChannelProvider[]) {
    for (const p of providers) {
      const list = this.byChannel.get(p.channel) ?? [];
      list.push(p);
      this.byChannel.set(p.channel, list);
    }
  }

  /** Primary first, then fallbacks (SMS failover). */
  for(channel: string): ChannelProvider[] {
    return this.byChannel.get(channel) ?? [];
  }
}
