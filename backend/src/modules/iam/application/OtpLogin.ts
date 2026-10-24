import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuditLog } from '../../../shared/application/AuditLog.js';
import type { Notifier, TransactionRunner } from '../../../shared/application/ports.js';
import { UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { AuthError, type AppError } from '../../../shared/domain/errors.js';
import { MAX_OTP_ATTEMPTS, OTP_TTL_MS, type SessionClient } from '../domain/model.js';
import type { IamRepository } from '../domain/repositories.js';
import type { IssuedSession, SessionIssuer } from './SessionIssuer.js';

function hashCode(challengeId: string, code: string): Buffer {
  return createHash('sha256').update(`${challengeId}:${code}`).digest();
}

/**
 * Guardian login step 1 (flows.md §2): send a 6-digit code by SMS.
 * The response never reveals whether the phone is registered (no enumeration).
 */
export class RequestOtp extends UseCase<{ phone: string }, { sent: true }> {
  private readonly d: { iamRepo: IamRepository; notifier: Notifier; clock: Clock };

  constructor(deps: RequestOtp['d'] & { uow: TransactionRunner }) {
    super(deps.uow);
    this.d = deps;
  }

  protected async handle({ phone }: { phone: string }): Promise<{ sent: true }> {
    const user = await this.d.iamRepo.findActiveGuardianByPhone(phone);
    if (!user) return { sent: true };
    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.d.iamRepo.insertOtp({
      id,
      phone,
      userId: user.id,
      purpose: 'login',
      codeHash: hashCode(id, code),
      expiresAt: new Date(this.d.clock.now().getTime() + OTP_TTL_MS),
    });
    await this.d.notifier.dispatch({
      eventCode: 'iam.otp',
      recipients: [{ userId: user.id, phone, locale: user.preferredLocale }],
      data: { code, minutes: OTP_TTL_MS / 60_000 },
      channels: ['sms'],
      priority: 'high',
    });
    return { sent: true };
  }
}

type VerifyOutcome = { kind: 'session'; session: IssuedSession } | { kind: 'failed'; error: AppError };

/** Guardian login step 2: verify the code (5 attempts, 5 minutes), then open a session. */
export class VerifyOtp extends UseCase<{ phone: string; code: string; client: SessionClient }, VerifyOutcome> {
  private readonly d: { iamRepo: IamRepository; sessionIssuer: SessionIssuer; auditLog: AuditLog; clock: Clock };

  constructor(deps: VerifyOtp['d'] & { uow: TransactionRunner }) {
    super(deps.uow);
    this.d = deps;
  }

  async verify(input: { phone: string; code: string; client: SessionClient }): Promise<IssuedSession> {
    const outcome = await this.execute(input);
    if (outcome.kind === 'failed') throw outcome.error;
    return outcome.session;
  }

  protected async handle(input: { phone: string; code: string; client: SessionClient }): Promise<VerifyOutcome> {
    const now = this.d.clock.now();
    const invalid = (): VerifyOutcome => ({
      kind: 'failed',
      error: new AuthError('OTP_INVALID', 'Invalid or expired code'),
    });
    const challenge = await this.d.iamRepo.latestOpenOtpForUpdate(input.phone, 'login', now);
    if (!challenge || !challenge.userId || challenge.attempts >= MAX_OTP_ATTEMPTS) return invalid();

    const expected = challenge.codeHash;
    const given = hashCode(challenge.id, input.code);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await this.d.iamRepo.incrementOtpAttempts(challenge.id); // committed, then the error is thrown
      return invalid();
    }
    await this.d.iamRepo.consumeOtp(challenge.id, now);
    const user = await this.d.iamRepo.findById(challenge.userId);
    if (!user || user.status !== 'active') return invalid();
    await this.d.iamRepo.recordSuccessfulLogin(user.id, now);
    const session = await this.d.sessionIssuer.issue(user, input.client);
    await this.d.auditLog.record({
      action: 'LOGIN',
      actorUserId: user.id,
      entityType: 'user_account',
      entityId: user.id,
      details: { client: input.client, method: 'otp' },
    });
    return { kind: 'session', session };
  }
}
