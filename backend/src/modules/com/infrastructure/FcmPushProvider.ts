import { importPKCS8, SignJWT } from 'jose';
import { PermanentDeliveryError, type ChannelMessage, type ChannelProvider } from '../application/ports.js';

export interface FcmCredentials {
  projectId: string;
  clientEmail: string;
  /** service-account private key (PEM, PKCS#8) */
  privateKey: string;
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * Firebase Cloud Messaging HTTP v1 (Android, iOS via APNs, web push). Authenticates with a service account
 * (OAuth2 JWT bearer, token cached until shortly before expiry). Tokens FCM reports as unregistered / invalid
 * raise PermanentDeliveryError so the device is revoked instead of retried.
 */
export class FcmPushProvider implements ChannelProvider {
  readonly name = 'fcm';
  readonly channel = 'push' as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly creds: FcmCredentials,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => number = Date.now,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const key = await importPKCS8(this.creds.privateKey.replace(/\\n/g, '\n'), 'RS256');
    const iat = Math.floor(this.now() / 1000);
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.creds.clientEmail)
      .setSubject(this.creds.clientEmail)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(key);
    const res = await this.fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !body.access_token) throw new Error(`FCM auth failed: ${body.error ?? res.status}`);
    this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  async send(m: ChannelMessage): Promise<{ providerMessageId: string }> {
    const res = await this.fetchFn(`https://fcm.googleapis.com/v1/projects/${this.creds.projectId}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: m.to,
          notification: { title: m.subject ?? '', body: m.body },
          android: { priority: 'high' },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    });
    const body = (await res.json()) as {
      name?: string;
      error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> };
    };
    if (res.ok) return { providerMessageId: body.name ?? '' };
    const code = body.error?.details?.find((x) => x.errorCode)?.errorCode ?? body.error?.status ?? String(res.status);
    if (res.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT')
      throw new PermanentDeliveryError(`FCM ${code}: ${body.error?.message ?? ''}`, { revokeAddress: true });
    if (res.status === 401) this.token = null; // refresh on the retry
    throw new Error(`FCM ${code}: ${body.error?.message ?? ''}`);
  }
}
