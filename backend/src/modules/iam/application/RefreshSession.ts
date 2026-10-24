import type { AuditLog } from '../../../shared/application/AuditLog.js';
import type { TransactionRunner } from '../../../shared/application/ports.js';
import { UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { AuthError, type AppError } from '../../../shared/domain/errors.js';
import { sha256 } from '../../../shared/application/tokens.js';
import type { IamRepository } from '../domain/repositories.js';
import type { IssuedSession, SessionIssuer } from './SessionIssuer.js';

type Outcome = { kind: 'session'; session: IssuedSession } | { kind: 'failed'; error: AppError };

/**
 * Refresh-token rotation with reuse detection (flows.md §2): every refresh returns a new token in the same family.
 * Presenting an already-rotated token means it was stolen or replayed: the whole family is revoked.
 */
export class RefreshSession extends UseCase<{ refreshToken: string }, Outcome> {
  private readonly d: { iamRepo: IamRepository; sessionIssuer: SessionIssuer; auditLog: AuditLog; clock: Clock };

  constructor(deps: RefreshSession['d'] & { uow: TransactionRunner }) {
    super(deps.uow);
    this.d = deps;
  }

  async refresh(refreshToken: string): Promise<IssuedSession> {
    const outcome = await this.execute({ refreshToken });
    if (outcome.kind === 'failed') throw outcome.error;
    return outcome.session;
  }

  protected async handle({ refreshToken }: { refreshToken: string }): Promise<Outcome> {
    const now = this.d.clock.now();
    const record = await this.d.iamRepo.findRefreshTokenForUpdate(sha256(refreshToken));
    if (!record || record.revokedAt)
      return { kind: 'failed', error: new AuthError('REFRESH_INVALID', 'Session is no longer valid') };
    if (record.rotatedAt) {
      const revoked = await this.d.iamRepo.revokeFamily(record.familyId, 'reuse', now);
      await this.d.auditLog.record({
        action: 'REFRESH_REUSED',
        actorUserId: record.userId,
        entityType: 'refresh_token',
        entityId: record.familyId,
        details: { revoked },
      });
      return {
        kind: 'failed',
        error: new AuthError('REFRESH_REUSED', 'Session was used elsewhere; please sign in again'),
      };
    }
    if (record.expiresAt <= now) return { kind: 'failed', error: new AuthError('REFRESH_EXPIRED', 'Session expired') };

    const user = await this.d.iamRepo.findById(record.userId);
    if (!user || user.status !== 'active') {
      await this.d.iamRepo.revokeFamily(record.familyId, 'account_inactive', now);
      return { kind: 'failed', error: new AuthError('ACCOUNT_DISABLED', 'Account is not active') };
    }
    await this.d.iamRepo.markRotated(record.id, now);
    const session = await this.d.sessionIssuer.issue(user, record.client, { familyId: record.familyId });
    return { kind: 'session', session };
  }
}

/** Logout = revoke the refresh-token family of this session. */
export class Logout extends UseCase<{ refreshToken: string }, void> {
  private readonly d: { iamRepo: IamRepository; auditLog: AuditLog; clock: Clock };

  constructor(deps: Logout['d'] & { uow: TransactionRunner }) {
    super(deps.uow);
    this.d = deps;
  }

  protected async handle({ refreshToken }: { refreshToken: string }): Promise<void> {
    const record = await this.d.iamRepo.findRefreshTokenForUpdate(sha256(refreshToken));
    if (!record) return;
    await this.d.iamRepo.revokeFamily(record.familyId, 'logout', this.d.clock.now());
    await this.d.auditLog.record({
      action: 'LOGOUT',
      actorUserId: record.userId,
      entityType: 'refresh_token',
      entityId: record.familyId,
    });
  }
}
