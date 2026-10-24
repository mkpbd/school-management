import type { AuditLog } from '../../../shared/application/AuditLog.js';
import type { Cache, FieldCipher, TransactionRunner } from '../../../shared/application/ports.js';
import { UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { AuthError } from '../../../shared/domain/errors.js';
import type { SessionClient } from '../domain/model.js';
import type { IamRepository } from '../domain/repositories.js';
import type { TokenSigner, TotpVerifier } from './ports.js';
import type { IssuedSession, SessionIssuer } from './SessionIssuer.js';

/** Second step of staff login: TOTP code for roles with requires_mfa (spec §5.5). */
export class VerifyMfa extends UseCase<{ mfaToken: string; code: string; client: SessionClient }, IssuedSession> {
  private readonly d: {
    iamRepo: IamRepository;
    tokens: TokenSigner;
    totp: TotpVerifier;
    fieldCipher: FieldCipher;
    cache: Cache;
    sessionIssuer: SessionIssuer;
    auditLog: AuditLog;
    clock: Clock;
  };

  constructor(deps: VerifyMfa['d'] & { uow: TransactionRunner }) {
    super(deps.uow);
    this.d = deps;
  }

  protected async handle(input: { mfaToken: string; code: string; client: SessionClient }): Promise<IssuedSession> {
    const claims = await this.d.tokens.verifyShortLived(input.mfaToken, 'mfa');
    const user = await this.d.iamRepo.findById(claims.sub);
    if (!user || user.status !== 'active' || user.mfaType !== 'totp' || !user.mfaSecretEnc) {
      throw new AuthError('MFA_INVALID', 'Invalid or expired verification');
    }
    // a TOTP code is single-use (replay protection for its 90 s validity window)
    const replayKey = `totp-used:${user.id}:${input.code}`;
    if (await this.d.cache.get(replayKey)) throw new AuthError('MFA_INVALID', 'Code already used');
    const ok = await this.d.totp.verify(this.d.fieldCipher.decrypt(user.mfaSecretEnc), input.code);
    if (!ok) throw new AuthError('MFA_INVALID', 'Incorrect verification code');
    await this.d.cache.set(replayKey, true, 90);

    await this.d.iamRepo.recordSuccessfulLogin(user.id, this.d.clock.now());
    const session = await this.d.sessionIssuer.issue(user, input.client);
    await this.d.auditLog.record({
      action: 'LOGIN',
      actorUserId: user.id,
      entityType: 'user_account',
      entityId: user.id,
      details: { client: input.client, method: 'password+totp' },
    });
    return session;
  }
}
