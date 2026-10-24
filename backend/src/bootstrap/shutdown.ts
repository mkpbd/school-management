import type { Logger } from 'pino';

/**
 * Graceful shutdown on SIGTERM/SIGINT: run closers in order, force-exit after the timeout.
 * Orchestrators send SIGTERM before killing the container (readiness already failing => no new traffic).
 */
export function registerShutdown(logger: Logger, closers: Array<() => Promise<unknown>>, timeoutMs: number): void {
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      logger.error('shutdown timed out; forcing exit');
      process.exit(1);
    }, timeoutMs);
    timer.unref();
    for (const close of closers) {
      try {
        await close();
      } catch (err) {
        logger.error({ err }, 'error during shutdown');
      }
    }
    logger.info('shutdown complete');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled rejection'));
}
