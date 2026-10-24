import { randomBytes, randomUUID } from 'node:crypto';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { newOpaqueToken } from '../../../shared/application/tokens.js';
import type { SessionClient, UserAccount } from '../domain/model.js';
import type { IamRepository } from '../domain/repositories.js';
import type { TokenSigner } from './ports.js';

export interface IssuedSession {
  accessToken: string;
  accessExpiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  csrfToken: string;
  client: SessionClient;
  user: { id: string; type: UserAccount['userType']; locale: 'en' | 'bn' };
  mfaEnrollmentRequired: boolean;
}

/** Creates a login session: a new refresh-token family + access token (docs/backend/cross-cutting.md §4.2). */
export class SessionIssuer {
  private readonly iamRepo: IamRepository;
  private readonly tokens: TokenSigner;
  private readonly clock: Clock;
  private readonly ctx: RequestContext;
  private readonly ttlDaysWeb: number;
  private readonly ttlDaysApp: number;

  constructor(deps: {
    iamRepo: IamRepository;
    tokens: TokenSigner;
    clock: Clock;
    ctx: RequestContext;
    config: { REFRESH_TOKEN_TTL_DAYS_WEB: number; REFRESH_TOKEN_TTL_DAYS_APP: number };
  }) {
    this.iamRepo = deps.iamRepo;
    this.tokens = deps.tokens;
    this.clock = deps.clock;
    this.ctx = deps.ctx;
    this.ttlDaysWeb = deps.config.REFRESH_TOKEN_TTL_DAYS_WEB;
    this.ttlDaysApp = deps.config.REFRESH_TOKEN_TTL_DAYS_APP;
  }

  async issue(
    user: UserAccount,
    client: SessionClient,
    opts: { mfaEnrollmentRequired?: boolean; familyId?: string } = {},
  ): Promise<IssuedSession> {
    if (user.userType === 'system') throw new Error('System users cannot log in');
    const now = this.clock.now();
    const familyId = opts.familyId ?? randomUUID();
    const days = client === 'web' ? this.ttlDaysWeb : this.ttlDaysApp;
    const refreshExpiresAt = new Date(now.getTime() + days * 86_400_000);
    const refresh = newOpaqueToken();
    await this.iamRepo.insertRefreshToken({
      userId: user.id,
      familyId,
      tokenHash: refresh.hash,
      client,
      expiresAt: refreshExpiresAt,
      ip: this.ctx.ip,
      userAgent: this.ctx.userAgent,
    });
    const accessToken = await this.tokens.signAccess({
      sub: user.id,
      org: user.orgId,
      typ: user.userType,
      av: user.authzVersion,
      sid: familyId,
    });
    return {
      accessToken,
      accessExpiresIn: this.tokens.accessTokenTtlSec,
      refreshToken: refresh.token,
      refreshExpiresAt,
      csrfToken: randomBytes(24).toString('base64url'),
      client,
      user: { id: user.id, type: user.userType, locale: user.preferredLocale },
      mfaEnrollmentRequired: opts.mfaEnrollmentRequired ?? false,
    };
  }
}
