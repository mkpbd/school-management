import { client, refreshSession, unwrap } from "../client";
import type { LoginResult, Me, Session } from "../types";

/** Auth (backend/src/modules/iam/presentation). The web app always uses client "web": httpOnly cookies + CSRF. */
export const auth = {
  /** Staff / student password login. May answer `{ mfaRequired, mfaToken }` for roles that need TOTP. */
  login: (identifier: string, password: string) =>
    unwrap<LoginResult>(
      client.POST("/api/v1/auth/login", {
        body: { identifier, password, client: "web" },
      }),
    ),

  verifyMfa: (mfaToken: string, code: string) =>
    unwrap<Session>(
      client.POST("/api/v1/auth/mfa/verify", {
        body: { mfaToken, code, client: "web" },
      }),
    ),

  /** Guardians: send a 6-digit login code by SMS. Phone in E.164, e.g. +8801712345678. */
  requestOtp: (phone: string) =>
    unwrap<{ sent: true }>(
      client.POST("/api/v1/auth/otp/request", { body: { phone } }),
    ),

  verifyOtp: (phone: string, code: string) =>
    unwrap<Session>(
      client.POST("/api/v1/auth/otp/verify", {
        body: { phone, code, client: "web" },
      }),
    ),

  /** Rotates the refresh cookie; resolves false when the session is gone. */
  refresh: refreshSession,

  logout: () => unwrap<null>(client.POST("/api/v1/auth/logout", { body: {} })),

  /** Current user and effective grants (menus, permission checks; the server stays authoritative). */
  me: () => unwrap<Me>(client.GET("/api/v1/me")),
};

export function isMfaChallenge(
  r: LoginResult,
): r is { mfaRequired: true; mfaToken: string } {
  return "mfaRequired" in r && r.mfaRequired;
}
