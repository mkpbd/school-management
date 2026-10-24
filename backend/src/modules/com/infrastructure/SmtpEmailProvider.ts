import nodemailer, { type Transporter } from 'nodemailer';
import { htmlToText } from '../domain/email.js';
import { PermanentDeliveryError, type ChannelMessage, type ChannelProvider } from '../application/ports.js';

/**
 * E-mail over SMTP (any provider: SES SMTP, Mailgun, Postmark, Gmail Workspace relay, Mailpit in development).
 * SMTP_URL e.g. smtps://user:pass@email-smtp.ap-south-1.amazonaws.com:465. Sends HTML with a text alternative.
 */
export class SmtpEmailProvider implements ChannelProvider {
  readonly name = 'smtp';
  readonly channel = 'email' as const;
  private readonly transport: Transporter;

  constructor(
    url: string,
    private readonly from: string,
    transport?: Transporter,
  ) {
    this.transport = transport ?? nodemailer.createTransport(url);
  }

  async send(m: ChannelMessage): Promise<{ providerMessageId: string }> {
    const html = /<html|<p|<table|<br/i.test(m.body) ? m.body : undefined;
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: m.to,
        subject: m.subject ?? '',
        html,
        text: html ? htmlToText(html) : m.body,
      });
      return { providerMessageId: String(info.messageId ?? '') };
    } catch (err) {
      const code = (err as { responseCode?: number }).responseCode;
      // 5xx = the mailbox / address will never accept it: do not retry
      if (code && code >= 500 && code < 600)
        throw new PermanentDeliveryError(`SMTP ${code}: ${(err as Error).message}`);
      throw err;
    }
  }
}
