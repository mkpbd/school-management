import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../../shared/domain/Clock.js';
import type { CaptchaVerifier, FormTokens } from '../application/ports.js';

/**
 * Form token = base64url(form.issuedAtMs.nonce) + "." + HMAC. Proves the form was loaded from our site and tells
 * how long the visitor took to fill it in (bots post instantly or replay old tokens).
 */
export class HmacFormTokens implements FormTokens {
  constructor(
    private readonly key: Buffer,
    private readonly clock: Clock,
  ) {}

  issue(form: 'enquiry' | 'application'): string {
    const body = Buffer.from(`${form}.${this.clock.now().getTime()}.${randomBytes(9).toString('base64url')}`).toString(
      'base64url',
    );
    return `${body}.${this.mac(body).toString('base64url')}`;
  }

  verify(token: string | undefined, form: 'enquiry' | 'application') {
    const invalid = { valid: false, ageSec: null };
    if (!token) return invalid;
    const [body, mac] = token.split('.');
    if (!body || !mac) return invalid;
    const given = Buffer.from(mac, 'base64url');
    const expected = this.mac(body);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return invalid;
    const [f, at] = Buffer.from(body, 'base64url').toString('utf8').split('.');
    const issued = Number(at);
    if (f !== form || !Number.isFinite(issued)) return invalid;
    const ageSec = Math.floor((this.clock.now().getTime() - issued) / 1000);
    return ageSec < -60 ? invalid : { valid: true, ageSec: Math.max(0, ageSec) };
  }

  resumeSecret() {
    const token = randomBytes(24).toString('base64url');
    return { token, hash: this.hashResume(token) };
  }

  hashResume(token: string): Buffer {
    return createHash('sha256').update(token).digest();
  }

  private mac(body: string): Buffer {
    return createHmac('sha256', this.key).update(body).digest();
  }
}

/** Cloudflare Turnstile server-side check (https://developers.cloudflare.com/turnstile/). */
export class TurnstileCaptcha implements CaptchaVerifier {
  constructor(
    readonly siteKey: string,
    private readonly secret: string,
  ) {}

  async verify(token: string | undefined, ip: string | undefined): Promise<boolean> {
    if (!token) return false;
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: this.secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
        signal: AbortSignal.timeout(5000),
      });
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch {
      // the captcha service is down: do not lose real enquiries; other signals still apply
      return true;
    }
  }
}

/** No captcha configured: the other signals decide. */
export class NoCaptcha implements CaptchaVerifier {
  readonly siteKey = null;
  verify(): Promise<null> {
    return Promise.resolve(null);
  }
}
