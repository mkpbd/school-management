/**
 * Application-level audit events (logins, exports, break-glass, certificate issue) that database triggers cannot see.
 * Row-level changes are audited by the audit.tg_row_audit trigger automatically.
 */
export interface AuditLog {
  record(entry: {
    action: string; // LOGIN, LOGIN_FAILED, LOGOUT, REFRESH_REUSED, EXPORT, BREAK_GLASS, ...
    entityType?: string;
    entityId?: string;
    details?: Record<string, unknown>;
    actorUserId?: string | null;
  }): Promise<void>;
}
