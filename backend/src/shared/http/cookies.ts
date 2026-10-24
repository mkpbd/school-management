import type { CookieOptions, Request, Response } from 'express';

/**
 * Session cookies (docs/backend/cross-cutting.md §4.2). `__Host-` prefix requires Secure, so plain names are used
 * when COOKIE_SECURE=false (local http development).
 */
export function cookieNames(secure: boolean) {
  const p = secure ? '__Host-' : '';
  return { access: `${p}access`, refresh: `${p}refresh`, csrf: `${p}csrf` };
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function sessionCookieOptions(secure: boolean, maxAgeMs: number, httpOnly = true): CookieOptions {
  return { httpOnly, secure, sameSite: 'lax', path: '/', maxAge: maxAgeMs };
}

export function clearSessionCookies(res: Response, secure: boolean): void {
  const names = cookieNames(secure);
  for (const name of Object.values(names)) res.clearCookie(name, { path: '/', secure, sameSite: 'lax' });
}
