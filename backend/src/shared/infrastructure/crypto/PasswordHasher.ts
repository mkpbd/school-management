import { hash, verify } from '@node-rs/argon2';

/** argon2id (spec §5.5; the library default algorithm). Parameters per OWASP: m=64 MiB, t=3, p=1. */
export class PasswordHasher {
  private static readonly OPTIONS = { memoryCost: 65_536, timeCost: 3, parallelism: 1 };
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, PasswordHasher.OPTIONS);
  }

  async verify(hashValue: string, password: string): Promise<boolean> {
    try {
      return await verify(hashValue, password);
    } catch {
      return false;
    }
  }

  /** Same cost as a real check, for unknown users (no user-enumeration by timing). */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}

/** Minimal policy (§4.3): length >= 10, not trivially weak. Breach-list (HIBP) check is a separate adapter. */
export function passwordPolicyErrors(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 10) errors.push('at least 10 characters');
  if (password.length > 128) errors.push('at most 128 characters');
  if (/^(.)\1+$/.test(password)) errors.push('must not repeat one character');
  return errors;
}
