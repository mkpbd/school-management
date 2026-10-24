import type { AuditLog } from '../../application/AuditLog.js';
import type { RequestContext } from '../../application/RequestContext.js';
import { auditEvent } from '../db/schema/audit.js';
import type { UnitOfWork } from '../db/UnitOfWork.js';

/** Writes `source = 'app'` rows into audit.audit_event in the current transaction (append-only table). */
export class DbAuditLog implements AuditLog {
  private readonly uow: UnitOfWork;
  private readonly ctx: RequestContext;

  constructor(deps: { uow: UnitOfWork; ctx: RequestContext }) {
    this.uow = deps.uow;
    this.ctx = deps.ctx;
  }

  async record(entry: Parameters<AuditLog['record']>[0]): Promise<void> {
    await this.uow
      .tx()
      .insert(auditEvent)
      .values({
        orgId: this.ctx.orgId,
        campusId: this.ctx.activeCampusId ?? null,
        actorUserId: entry.actorUserId === undefined ? this.ctx.userId : entry.actorUserId,
        requestId: this.ctx.requestId,
        ip: this.ctx.ip ?? null,
        source: 'app',
        action: entry.action,
        entityId: entry.entityId ?? null,
        tableName: entry.entityType ?? null,
        after: entry.details ?? null,
      });
  }
}
