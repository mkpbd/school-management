import type { Request, Response } from 'express';
import type { RouteResult } from './RouteDefinition.js';

/**
 * Server-Sent Events: pushes `produce()` every `intervalMs` until the client disconnects or `maxDurationMs` passes
 * (EventSource reconnects by itself). The first value is produced before any byte is written, so authorisation /
 * not-found errors still become normal problem+json responses. `no-transform` keeps compression from buffering.
 */
export async function streamEvents(
  req: Request,
  res: Response,
  produce: () => Promise<unknown>,
  o: { intervalMs: number; maxDurationMs?: number; event?: string },
): Promise<RouteResult | undefined> {
  const event = o.event ?? 'update';
  const first = await produce();
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: do not buffer
  });
  res.flushHeaders();
  const write = (data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.write(`retry: ${Math.max(1000, o.intervalMs)}\n\n`);
  write(first);

  let busy = false;
  const timer = setInterval(() => {
    if (busy) return; // a slow query never piles up
    busy = true;
    produce()
      .then(write)
      .catch(() => {
        res.write(`event: error\ndata: {"code":"STREAM_FAILED"}\n\n`);
        stop();
      })
      .finally(() => {
        busy = false;
      });
  }, o.intervalMs);
  const deadline = setTimeout(() => stop(), o.maxDurationMs ?? 15 * 60_000);
  const stop = () => {
    clearInterval(timer);
    clearTimeout(deadline);
    if (!res.writableEnded) res.end();
  };
  req.on('close', stop);
  return undefined; // response handled here
}
