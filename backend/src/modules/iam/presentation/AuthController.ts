import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../../../bootstrap/config.js';
import { AuthError } from '../../../shared/domain/errors.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { clearSessionCookies, cookieNames, parseCookies, sessionCookieOptions } from '../../../shared/http/cookies.js';
import { defineRoute, type RouteDefinition, type RouteResult } from '../../../shared/http/RouteDefinition.js';
import type { LoginWithPassword } from '../application/LoginWithPassword.js';
import type { RequestOtp, VerifyOtp } from '../application/OtpLogin.js';
import type { Logout, RefreshSession } from '../application/RefreshSession.js';
import type { IssuedSession } from '../application/SessionIssuer.js';
import type { VerifyMfa } from '../application/VerifyMfa.js';

const Client = z.enum(['web', 'staff_app', 'parent_app', 'scanner']).default('web');
const Phone = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Phone must be E.164, e.g. +8801712345678');

const SessionResponse = z.object({
  user: z.object({ id: z.string().uuid(), type: z.string(), locale: z.enum(['en', 'bn']) }),
  expiresIn: z.number().int(),
  csrfToken: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  mfaEnrollmentRequired: z.boolean(),
});

/**
 * Authentication endpoints (docs/backend/cross-cutting.md §4, flows.md §1-2).
 * Web: tokens only in httpOnly cookies + a readable CSRF cookie. Apps: tokens in the body (secure storage).
 */
export class AuthController extends BaseController {
  readonly basePath = '/auth';
  readonly tag = 'Auth';

  constructor(private readonly config: Pick<AppConfig, 'COOKIE_SECURE'>) {
    super();
  }

  routes(): RouteDefinition[] {
    return [
      defineRoute({
        method: 'post',
        path: '/login',
        summary: 'Password login (staff, students)',
        auth: 'none',
        rateLimit: { name: 'login-ip', points: 100, durationSec: 900, by: 'ip' },
        successStatus: 200,
        schema: {
          body: z
            .object({ identifier: z.string().min(1).max(254), password: z.string().min(1).max(256), client: Client })
            .strict()
            .openapi({
              description: 'client "staff_app" returns tokens in the body; "web" sets httpOnly cookies + csrf cookie',
              example: { identifier: 'admin', password: 'your-password', client: 'staff_app' },
            }),
        },
        handler: async ({ body }, req, res) => {
          const result = await this.resolve<LoginWithPassword>(req, 'loginWithPassword').login(body);
          if (result.kind === 'mfa_required') return this.ok({ mfaRequired: true, mfaToken: result.mfaToken });
          return this.sessionResult(res, result.session);
        },
      }),
      defineRoute({
        method: 'post',
        path: '/mfa/verify',
        summary: 'Second factor (TOTP) for staff roles requiring MFA',
        auth: 'none',
        rateLimit: { name: 'mfa-ip', points: 30, durationSec: 900, by: 'ip' },
        successStatus: 200,
        schema: {
          body: z.object({ mfaToken: z.string().min(10), code: z.string().regex(/^\d{6}$/), client: Client }).strict(),
          response: SessionResponse,
        },
        handler: async ({ body }, req, res) =>
          this.sessionResult(res, await this.resolve<VerifyMfa>(req, 'verifyMfa').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/otp/request',
        summary: 'Send a login code by SMS (guardians)',
        auth: 'none',
        rateLimit: { name: 'otp-ip', points: 10, durationSec: 3600, by: 'ip' },
        successStatus: 202,
        schema: { body: z.object({ phone: Phone }).strict() },
        handler: async ({ body }, req) => {
          await this.resolve<RequestOtp>(req, 'requestOtp').execute(body);
          return { status: 202, data: { sent: true } };
        },
      }),
      defineRoute({
        method: 'post',
        path: '/otp/verify',
        summary: 'Verify the SMS code and sign in (guardians)',
        auth: 'none',
        rateLimit: { name: 'otp-verify-ip', points: 30, durationSec: 900, by: 'ip' },
        successStatus: 200,
        schema: {
          body: z.object({ phone: Phone, code: z.string().regex(/^\d{6}$/), client: Client }).strict(),
          response: SessionResponse,
        },
        handler: async ({ body }, req, res) =>
          this.sessionResult(res, await this.resolve<VerifyOtp>(req, 'verifyOtp').verify(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/refresh',
        summary: 'Rotate the refresh token (reuse revokes the session family)',
        auth: 'none',
        successStatus: 200,
        schema: {
          body: z
            .object({ refreshToken: z.string().min(20).optional() })
            .strict()
            .default({}),
          response: SessionResponse,
        },
        handler: async ({ body }, req, res) => {
          const token = body.refreshToken ?? this.refreshCookie(req);
          if (!token) throw new AuthError('REFRESH_INVALID', 'No refresh token');
          return this.sessionResult(res, await this.resolve<RefreshSession>(req, 'refreshSession').refresh(token));
        },
      }),
      defineRoute({
        method: 'post',
        path: '/logout',
        summary: 'Revoke the current session',
        auth: 'none',
        schema: {
          body: z
            .object({ refreshToken: z.string().min(20).optional() })
            .strict()
            .default({}),
        },
        handler: async ({ body }, req, res) => {
          const token = body.refreshToken ?? this.refreshCookie(req);
          if (token) await this.resolve<Logout>(req, 'logout').execute({ refreshToken: token });
          clearSessionCookies(res, this.config.COOKIE_SECURE);
          return this.noContent();
        },
      }),
    ];
  }

  private refreshCookie(req: Request): string | undefined {
    return parseCookies(req)[cookieNames(this.config.COOKIE_SECURE).refresh];
  }

  private sessionResult(res: Response, s: IssuedSession): RouteResult {
    const base = { user: s.user, expiresIn: s.accessExpiresIn, mfaEnrollmentRequired: s.mfaEnrollmentRequired };
    if (s.client === 'web') {
      const secure = this.config.COOKIE_SECURE;
      const names = cookieNames(secure);
      res.cookie(names.access, s.accessToken, sessionCookieOptions(secure, s.accessExpiresIn * 1000));
      res.cookie(
        names.refresh,
        s.refreshToken,
        sessionCookieOptions(secure, s.refreshExpiresAt.getTime() - Date.now()),
      );
      res.cookie(
        names.csrf,
        s.csrfToken,
        sessionCookieOptions(secure, s.refreshExpiresAt.getTime() - Date.now(), false),
      );
      return this.ok({ ...base, csrfToken: s.csrfToken });
    }
    return this.ok({ ...base, accessToken: s.accessToken, refreshToken: s.refreshToken });
  }
}
