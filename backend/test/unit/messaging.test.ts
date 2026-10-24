import { generateKeyPairSync } from 'node:crypto';
import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { PermanentDeliveryError } from '../../src/modules/com/application/ports.js';
import { emailLayout, escapeHtml, htmlToText, humanizeEvent, textToHtml } from '../../src/modules/com/domain/email.js';
import { FcmPushProvider } from '../../src/modules/com/infrastructure/FcmPushProvider.js';
import { SmtpEmailProvider } from '../../src/modules/com/infrastructure/SmtpEmailProvider.js';

describe('e-mail rendering', () => {
  it('escapes, paragraphs, layout, text alternative', () => {
    expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe('&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
    expect(textToHtml('Line 1\nLine 2\n\nPara <2>')).toBe(
      '<p style="margin:0 0 14px">Line 1<br>Line 2</p><p style="margin:0 0 14px">Para &lt;2&gt;</p>',
    );
    const html = emailLayout({ school: 'A & B School', title: 'Fees <due>', contentHtml: '<p>Hi</p>' });
    expect(html).toContain('A &amp; B School');
    expect(html).toContain('Fees &lt;due&gt;');
    expect(htmlToText(html)).toContain('Fees <due>');
    expect(humanizeEvent('fee.invoice_issued')).toBe('Invoice issued');
  });
});

describe('push and e-mail providers', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const creds = { projectId: 'school-app', clientEmail: 'push@school-app.iam.gserviceaccount.com', privateKey };

  it('FCM: service-account token once, then sends; unregistered token is permanent', async () => {
    const calls: Array<{ url: string; body: string; auth?: string }> = [];
    let sendStatus = 200;
    const fetchFn = async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, body: init.body, auth: init.headers.Authorization });
      if (url.includes('oauth2'))
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok-1', expires_in: 3600 }) };
      if (sendStatus === 200)
        return { ok: true, status: 200, json: async () => ({ name: 'projects/school-app/messages/1' }) };
      return {
        ok: false,
        status: 404,
        json: async () => ({
          error: {
            status: 'NOT_FOUND',
            message: 'Requested entity was not found.',
            details: [{ errorCode: 'UNREGISTERED' }],
          },
        }),
      };
    };
    const fcm = new FcmPushProvider(creds, fetchFn as never);
    const r = await fcm.send({ to: 'device-token-1', subject: 'School', body: 'Bus is near' });
    expect(r.providerMessageId).toBe('projects/school-app/messages/1');
    await fcm.send({ to: 'device-token-2', subject: 'School', body: 'Again' });
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1); // token cached
    const assertion = new URLSearchParams(calls[0]!.body).get('assertion')!;
    expect(assertion.split('.')).toHaveLength(3);
    expect(JSON.parse(calls[1]!.body).message).toMatchObject({
      token: 'device-token-1',
      notification: { title: 'School', body: 'Bus is near' },
    });
    expect(calls[1]!.auth).toBe('Bearer tok-1');

    sendStatus = 404;
    const err = await fcm.send({ to: 'gone', subject: 's', body: 'b' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentDeliveryError);
    expect((err as PermanentDeliveryError).options.revokeAddress).toBe(true);
  });

  it('SMTP: HTML with a text alternative', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const smtp = new SmtpEmailProvider('smtp://unused', 'School <no-reply@school.test>', transport);
    const html = emailLayout({
      school: 'School',
      title: 'Payslip',
      contentHtml: '<p>Your salary for <strong>May</strong></p>',
    });
    const r = await smtp.send({ to: 'teacher@school.test', subject: 'Your payslip', body: html });
    expect(r.providerMessageId).toBeTruthy();
    const sent = await transport.sendMail({
      from: 'a@b.c',
      to: 'teacher@school.test',
      subject: 'x',
      html,
      text: htmlToText(html),
    });
    const msg = JSON.parse(String((sent as { message: string }).message)) as { html: string; text: string };
    expect(msg.html).toContain('<strong>May</strong>');
    expect(msg.text).toContain('Your salary for May');
  });
});
