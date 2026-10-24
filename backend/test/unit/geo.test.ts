import { describe, expect, it } from 'vitest';
import {
  acceptPings,
  distanceMeters,
  downsample,
  etaMinutes,
  vehicleStatus,
} from '../../src/modules/trn/domain/geo.js';

describe('transport geo rules', () => {
  it('distance: Gulshan 1 to Gulshan 2 is about 1.7 km', () => {
    const d = distanceMeters({ lat: 23.7806, lng: 90.4193 }, { lat: 23.7925, lng: 90.4078 });
    expect(d).toBeGreaterThan(1650);
    expect(d).toBeLessThan(1800);
    expect(distanceMeters({ lat: 23.78, lng: 90.41 }, { lat: 23.78, lng: 90.41 })).toBe(0);
  });

  it('accepts plausible fixes only, oldest first', () => {
    const now = new Date('2091-05-01T01:00:00Z');
    const at = (sec: number) => new Date(now.getTime() + sec * 1000);
    const { accepted, rejected } = acceptPings(
      [
        { recordedAt: at(-10), lat: 23.78, lng: 90.41 },
        { recordedAt: at(-30), lat: 23.77, lng: 90.41 },
        { recordedAt: at(600), lat: 23.78, lng: 90.41 }, // far future
        { recordedAt: at(-90_000), lat: 23.78, lng: 90.41 }, // older than a day
        { recordedAt: at(-5), lat: 0, lng: 0 }, // no fix
        { recordedAt: at(-5), lat: 23.78, lng: 90.41, speedKmh: 400 }, // impossible speed
      ],
      { now, maxFutureSec: 120, maxAgeSec: 86_400 },
    );
    expect(rejected).toBe(4);
    expect(accepted.map((p) => p.lat)).toEqual([23.77, 23.78]);
  });

  it('status from the last fix', () => {
    const now = new Date('2091-05-01T01:00:00Z');
    const o = { offlineAfterSec: 120, idleBelowKmh: 3 };
    expect(vehicleStatus(null, now, o)).toBe('no_signal');
    expect(vehicleStatus({ recordedAt: new Date(now.getTime() - 300_000), speedKmh: 30 }, now, o)).toBe('offline');
    expect(vehicleStatus({ recordedAt: now, speedKmh: 1 }, now, o)).toBe('idle');
    expect(vehicleStatus({ recordedAt: now, speedKmh: 25 }, now, o)).toBe('moving');
  });

  it('ETA clamps speed to city traffic and is at least a minute', () => {
    expect(etaMinutes(2000, 0)).toBe(13); // 2 km x 1.3 at 12 km/h
    expect(etaMinutes(2000, 100)).toBe(4); // capped at 40 km/h
    expect(etaMinutes(10, 20)).toBe(1);
  });

  it('downsample keeps first and last', () => {
    const pts = Array.from({ length: 101 }, (_, i) => i);
    const out = downsample(pts, 11);
    expect(out).toHaveLength(11);
    expect(out[0]).toBe(0);
    expect(out[10]).toBe(100);
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });
});
