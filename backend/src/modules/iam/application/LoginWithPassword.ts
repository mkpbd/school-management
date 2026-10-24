import type { AuditLog } from '../../../shared/application/AuditLog.js';
import type { TransactionRunner } from '../../../shared/application/ports.js';
import { UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { AuthError, type AppError } from '../../../shared/domain/errors.js';
import { lockedUntilAfterFailure, type SessionClient } from '../domain/model.js';
import type { IamRepository } from '../domain/repositories.js';
import type { PasswordVerifier, TokenSigner } from './ports.js';
import type { IssuedSession, SessionIssuer } from './SessionIssuer.js';

export interface LoginInput {
  identifier: string; // username or e-mail
  password: string;
  client: SessionClient;
}

export type LoginOutput = { kind: 'session'; session: IssuedSession } | { kind: 'mfa_required'; mfaToken: string };

type Outcome = LoginOutput | { kind: 'failed'; error: AppError };

const INVALID = () => new AuthError('INVALID_CREDENTIALS', 'Incorrect username or password');

/**
 * Staff/student password login (flows.md §1). Failures are COMMITTED (counter, lockout, audit) and only then thrown,
 * which is why handle() returns an outcome instead of throwing.
 */
export class LoginWithPassword extends UseCase<LoginInput, Outcome> {
  private readonly d: {
    iamRepo: IamRepository;
    passwordHasher: PasswordVerifier;
    sessionIssuer: SessionIssuer;
    tokens: TokenSigner;
    auditLog: AuditLog;
    clock: Clock;
  };

  constructor(deps: {
    uow: TransactionRunner;
    iamRepo: IamRepository;
    passwordHasher: PasswordVerifier;
    sessionIssuer: SessionIssuer;
    tokens: TokenSigner;
    auditLog: AuditLog;
    clock: Clock;
  }) {
    super(deps.uow);
    this.d = deps;
  }

  async login(input: LoginInput): Promise<LoginOutput> {
    const outcome = await this.execute(input);
    if (outcome.kind === 'failed') throw outcome.error;
    return outcome;
  }

  protected async handle(input: LoginInput): Promise<Outcome> {
    const { iamRepo, passwordHasher, auditLog, clock } = this.d;
    const now = clock.now();
    const user = await iamRepo.findForLogin(input.identifier.trim());

    if (!user || !user.passwordHash || user.userType === 'guardian' || user.userType === 'system') {
      await passwordHasher.verifyDummy(input.password);
      await auditLog.record({ action: 'LOGIN_FAILED', actorUserId: null, details: { reason: 'unknown_user' } });
      return { kind: 'failed', error: INVALID() };
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      await auditLog.record({
        action: 'LOGIN_FAILED',
        actorUserId: user.id,
        entityType: 'user_account',
        entityId: user.id,
        details: { reason: 'locked' },
      });
      return {
        kind: 'failed',
        error: new AuthError('ACCOUNT_LOCKED', 'Account temporarily locked after repeated failures'),
      };
    }
    const valid = await passwordHasher.verify(user.passwordHash, input.password);
    if (!valid) {
      const { failedCount } = await iamRepo.recordFailedLogin(user.id, now);
      const until = lockedUntilAfterFailure(failedCount, now);
      if (until) await iamRepo.setLockedUntil(user.id, until);
      await auditLog.record({
        action: 'LOGIN_FAILED',
        actorUserId: user.id,
        entityType: 'user_account',
        entityId: user.id,
        details: { reason: 'password', failedCount },
      });
      return { kind: 'failed', error: INVALID() };
    }
    if (user.status !== 'active') {
      return { kind: 'failed', error: new AuthError('ACCOUNT_DISABLED', 'Account is not active') };
    }

    if (user.mfaType === 'totp') {
      const mfaToken = await this.d.tokens.signShortLived({ sub: user.id, org: user.orgId, purpose: 'mfa' });
      return { kind: 'mfa_required', mfaToken };
    }
    const mfaEnrollmentRequired = await iamRepo.hasRoleRequiringMfa(user.id);
    await iamRepo.recordSuccessfulLogin(user.id, now);
    const session = await this.d.sessionIssuer.issue(user, input.client, { mfaEnrollmentRequired });
    await auditLog.record({
      action: 'LOGIN',
      actorUserId: user.id,
      entityType: 'user_account',
      entityId: user.id,
      details: { client: input.client, method: 'password' },
    });
    return { kind: 'session', session };
  }
}
