/**
 * DEV ONLY: drives a fake GPS tracker along a path so live tracking can be watched (Swagger / SSE / map).
 *   npm run trn:simulate -- --device BUS-01 --key <deviceKey> [--base http://localhost:8080] [--every 3]
 *   [--path "lat,lng;lat,lng;..."] [--kmh 25] [--loop]
 * Uses the same endpoint as real trackers: POST /api/v1/trn/gps/ingest with X-Device-Id / X-Device-Key.
 */
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    device: { type: 'string' },
    key: { type: 'string' },
    base: { type: 'string', default: 'http://localhost:8080' },
    every: { type: 'string', default: '3' },
    kmh: { type: 'string', default: '25' },
    path: { type: 'string' },
    loop: { type: 'boolean', default: false },
  },
});
if (!values.device || !values.key) {
  console.error('usage: npm run trn:simulate -- --device <deviceId> --key <deviceKey> [--base URL] [--every sec]');
  process.exit(1);
}

// default: Gulshan 1 -> Gulshan 2 -> Banani -> Mohakhali (Dhaka)
const DEFAULT_PATH = '23.7626,90.4193;23.7806,90.4193;23.7925,90.4078;23.7937,90.4006;23.7787,90.4005';
const waypoints = (values.path ?? DEFAULT_PATH).split(';').map((p) => {
  const [lat, lng] = p.split(',').map(Number) as [number, number];
  return { lat, lng };
});

const rad = (d: number) => (d * Math.PI) / 180;
const meters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};
const bearing = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
};

const everySec = Number(values.every);
const step = (Number(values.kmh) * 1000 * everySec) / 3600; // metres per tick
let leg = 0;
let travelled = 0;

async function tick(): Promise<boolean> {
  const a = waypoints[leg]!;
  const b = waypoints[leg + 1]!;
  const len = meters(a, b);
  const f = Math.min(1, travelled / len);
  const pos = { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
  const jitter = 0.85 + Math.random() * 0.3;
  const res = await fetch(`${values.base}/api/v1/trn/gps/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': values.device!, 'X-Device-Key': values.key! },
    body: JSON.stringify({
      pings: [
        {
          recordedAt: new Date().toISOString(),
          lat: Number(pos.lat.toFixed(6)),
          lng: Number(pos.lng.toFixed(6)),
          speedKmh: Math.round(Number(values.kmh) * jitter * 10) / 10,
          heading: bearing(a, b),
        },
      ],
    }),
  });
  const body = (await res.json()) as { data?: { nearStops?: string[]; tripId?: string | null } };
  console.log(
    `${new Date().toISOString()} leg ${leg + 1}/${waypoints.length - 1} ${pos.lat.toFixed(5)},${pos.lng.toFixed(5)} -> ${res.status}` +
      (body.data?.nearStops?.length ? `  near stop(s): ${body.data.nearStops.join(', ')}` : '') +
      (body.data && !body.data.tripId ? '  (no trip running)' : ''),
  );
  travelled += step;
  if (travelled >= len) {
    travelled = 0;
    leg++;
    if (leg >= waypoints.length - 1) {
      if (!values.loop) return false;
      leg = 0;
    }
  }
  return true;
}

for (;;) {
  // the dev API restarts on file changes: a failed upload is logged and the bus keeps driving
  const more = await tick().catch((err: unknown) => {
    console.warn(`${new Date().toISOString()} upload failed (${(err as Error).message}); retrying next tick`);
    travelled += step;
    return true;
  });
  if (!more) break;
  await new Promise((r) => setTimeout(r, everySec * 1000));
}
console.log('route finished');
