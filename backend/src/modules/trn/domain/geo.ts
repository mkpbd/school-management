import { distanceMeters, type LatLng } from '../../../shared/domain/geo.js';

export { distanceMeters, type LatLng };

export interface Ping extends LatLng {
  recordedAt: Date;
  speedKmh?: number | null;
  heading?: number | null;
}

export type VehicleStatus = 'moving' | 'idle' | 'offline' | 'no_signal';

export interface PingWindow {
  now: Date;
  /** device clocks drift: allow fixes slightly in the future */
  maxFutureSec: number;
  /** buffered fixes uploaded late are still history; older ones are dropped */
  maxAgeSec: number;
}

/** Splits a device batch into plausible fixes (sorted oldest first) and rejected ones. */
export function acceptPings(pings: Ping[], w: PingWindow): { accepted: Ping[]; rejected: number } {
  const newest = w.now.getTime() + w.maxFutureSec * 1000;
  const oldest = w.now.getTime() - w.maxAgeSec * 1000;
  const accepted = pings
    .filter((p) => {
      const t = p.recordedAt.getTime();
      return (
        Number.isFinite(t) &&
        t <= newest &&
        t >= oldest &&
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lng) <= 180 &&
        !(p.lat === 0 && p.lng === 0) && // "null island": tracker without a fix
        (p.speedKmh == null || (p.speedKmh >= 0 && p.speedKmh < 300))
      );
    })
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  return { accepted, rejected: pings.length - accepted.length };
}

/** Live status from the latest fix: offline when silent too long, idle when (nearly) standing still. */
export function vehicleStatus(
  last: { recordedAt: Date; speedKmh: number | null } | null,
  now: Date,
  o: { offlineAfterSec: number; idleBelowKmh: number },
): VehicleStatus {
  if (!last) return 'no_signal';
  if (now.getTime() - last.recordedAt.getTime() > o.offlineAfterSec * 1000) return 'offline';
  return (last.speedKmh ?? 0) < o.idleBelowKmh ? 'idle' : 'moving';
}

/**
 * Minutes to cover the straight-line distance; city traffic is slower than the instant speed, so the speed used
 * is clamped to [minKmh, maxKmh] and straight-line distance is stretched by a road factor.
 */
export function etaMinutes(
  meters: number,
  speedKmh: number | null,
  o: { minKmh: number; maxKmh: number; roadFactor: number } = { minKmh: 12, maxKmh: 40, roadFactor: 1.3 },
): number {
  const kmh = Math.min(o.maxKmh, Math.max(o.minKmh, speedKmh ?? 0));
  return Math.max(1, Math.round(((meters * o.roadFactor) / 1000 / kmh) * 60));
}

/** Keeps at most `max` points of a track, always including the first and the last. */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max || max < 2) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]!);
}
