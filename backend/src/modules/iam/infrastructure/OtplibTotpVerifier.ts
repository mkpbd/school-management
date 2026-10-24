import { verify } from 'otplib';
import type { TotpVerifier } from '../application/ports.js';

/** RFC 6238 TOTP (30 s steps) with ±1 step tolerance for clock drift. */
export class OtplibTotpVerifier implements TotpVerifier {
  async verify(secret: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    try {
      const result = await verify({ secret, token: code, epochTolerance: 30 });
      return result.valid;
    } catch {
      return false;
    }
  }
}
