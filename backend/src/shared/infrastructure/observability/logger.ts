import { AsyncLocalStorage } from 'node:async_hooks';
import { pino, type Logger } from 'pino';

/** Correlation fields added to every log line written during a request or job. */
export interface LogContext {
  requestId?: string;
  userId?: string | null;
  orgId?: string;
  campusId?: string;
  job?: string;
}

export const logContext = new AsyncLocalStorage<LogContext>();

/** PII never reaches logs (docs/backend/cross-cutting.md §18). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.otp',
  '*.code',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.nid',
  '*.birthCertNo',
  '*.secret',
];

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    base: { service: 'school-backend' },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin: () => ({ ...logContext.getStore() }),
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  });
}

/** Masks a phone number for logs: +8801712345678 -> +880171****678 */
export function maskPhone(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  return phone.length > 7 ? `${phone.slice(0, 7)}****${phone.slice(-3)}` : '****';
}
