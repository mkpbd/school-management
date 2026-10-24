import { asValue } from 'awilix';
import type { Request } from 'express';
import { z } from 'zod';
import { systemContext } from '../../../shared/application/RequestContext.js';
import { AuthError } from '../../../shared/domain/errors.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import { streamEvents } from '../../../shared/http/sse.js';
import type {
  AcknowledgeAlert,
  GetLiveFleet,
  GetStudentBus,
  GetVehicleTrack,
  IngestDevicePings,
  ListAlerts,
  PingDto,
  RecordDriverPings,
} from '../application/TrackingUseCases.js';

const Id = z.object({ id: zx.uuid() });
const PingSchema = z
  .object({
    recordedAt: z.iso.datetime({ offset: true }),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    speedKmh: z.number().min(0).max(300).optional(),
    heading: z
      .number()
      .min(0)
      .max(360)
      .transform((h) => Math.round(h) % 360)
      .optional(),
  })
  .strict();
const Pings = z.array(PingSchema).min(1).max(500);
const DEVICE_RATE = { name: 'gps-ingest', points: 1200, durationSec: 60, by: 'ip' as const };

/** OsmAnd / Traccar Client protocol: id, timestamp (unix s or ISO), lat, lon, speed (knots), bearing. */
const OsmAnd = z.object({
  id: z.string().min(3).max(200),
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  timestamp: z.string().max(40).optional(),
  speed: z.coerce.number().min(0).max(200).optional(),
  bearing: z.coerce.number().min(0).max(360).optional(),
});

function osmAndPing(q: z.infer<typeof OsmAnd>, now: Date): PingDto {
  const t = q.timestamp;
  const at = !t ? now : /^\d+(\.\d+)?$/.test(t) ? new Date(Number(t) * (Number(t) > 1e12 ? 1 : 1000)) : new Date(t);
  return {
    recordedAt: (Number.isNaN(at.getTime()) ? now : at).toISOString(),
    lat: q.lat,
    lng: q.lon,
    speedKmh: q.speed === undefined ? undefined : Math.round(q.speed * 1.852 * 10) / 10,
    heading: q.bearing === undefined ? undefined : Math.round(q.bearing) % 360,
  };
}

/** TRN-04 live tracking: ingest (tracker, phone app, driver app), live fleet, history, parent view, alerts. */
export class TrackingController extends BaseController {
  readonly basePath = '/trn';
  readonly tag = 'Transport tracking';

  /** Device routes have no user: run the use case in a child scope with the system context. */
  private async asDevice(req: Request, deviceId: string, deviceKey: string, pings: PingDto[]) {
    const scope = req.scope.createScope();
    scope.register({ ctx: asValue(systemContext(req.ctx.orgId, req.requestId)) });
    try {
      return await scope.resolve<IngestDevicePings>('ingestDevicePings').execute({ deviceId, deviceKey, pings });
    } finally {
      await scope.dispose();
    }
  }

  routes(): RouteDefinition[] {
    const osmAndHandler = async ({ query }: { query: z.infer<typeof OsmAnd> }, req: Request) => {
      // Traccar Client has a single "device identifier" field: configure it as <deviceId>.<deviceKey>
      const dot = query.id.lastIndexOf('.');
      if (dot < 1) throw new AuthError('DEVICE_UNAUTHORIZED', 'Device identifier must be <deviceId>.<deviceKey>');
      const r = await this.asDevice(req, query.id.slice(0, dot), query.id.slice(dot + 1), [
        osmAndPing(query, new Date()),
      ]);
      return this.ok(r);
    };
    return [
      // ---------------- ingest ----------------
      defineRoute({
        method: 'post',
        path: '/gps/ingest',
        summary: 'GPS tracker / gateway batch upload (headers X-Device-Id, X-Device-Key)',
        description:
          'Up to 500 fixes per call; buffered fixes up to 24 h old are accepted, duplicates ignored. Issue the key with POST /trn/vehicles/{id}/device-key.',
        auth: 'none',
        rateLimit: DEVICE_RATE,
        successStatus: 200,
        schema: { body: z.object({ pings: Pings }).strict() },
        handler: async ({ body }, req) => {
          const deviceId = req.header('X-Device-Id');
          const deviceKey = req.header('X-Device-Key');
          if (!deviceId || !deviceKey)
            throw new AuthError('DEVICE_UNAUTHORIZED', 'X-Device-Id and X-Device-Key are required');
          return this.ok(await this.asDevice(req, deviceId, deviceKey, body.pings));
        },
      }),
      defineRoute({
        method: 'get',
        path: '/gps/osmand',
        summary: 'OsmAnd / Traccar Client protocol (any phone in the bus becomes a tracker)',
        description:
          'Point Traccar Client (Android / iOS) at https://<host>/api/v1/trn/gps/osmand with device identifier "<deviceId>.<deviceKey>". Speed is in knots.',
        auth: 'none',
        rateLimit: DEVICE_RATE,
        schema: { query: OsmAnd },
        handler: osmAndHandler,
      }),
      defineRoute({
        method: 'post',
        path: '/gps/osmand',
        summary: 'OsmAnd / Traccar Client protocol (POST with query parameters)',
        auth: 'none',
        rateLimit: DEVICE_RATE,
        successStatus: 200,
        schema: { query: OsmAnd },
        handler: osmAndHandler,
      }),
      defineRoute({
        method: 'post',
        path: '/vehicles/:id/pings',
        summary: "Driver app: post the phone's fixes for the vehicle you drive today",
        permission: 'trn.tracking.create',
        successStatus: 200,
        schema: { params: Id, body: z.object({ pings: Pings }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<RecordDriverPings>(req, 'recordDriverPings').execute({
              vehicleId: params.id,
              pings: body.pings,
            }),
          ),
      }),

      // ---------------- live views ----------------
      defineRoute({
        method: 'get',
        path: '/tracking/live',
        summary: 'All vehicles: position, moving / idle / offline, current trip, next stop and ETA',
        permission: 'trn.tracking.view',
        schema: { query: z.object({ campusId: zx.uuid().optional() }) },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<GetLiveFleet>(req, 'getLiveFleet').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/tracking/stream',
        summary: 'Live fleet as Server-Sent Events (event "update" every few seconds)',
        description: 'Use EventSource in the browser; with a bearer token use a fetch-based SSE client.',
        permission: 'trn.tracking.view',
        schema: {
          query: z.object({
            campusId: zx.uuid().optional(),
            intervalSec: z.coerce.number().int().min(2).max(60).default(5),
          }),
        },
        handler: async ({ query }, req, res) => {
          const uc = this.resolve<GetLiveFleet>(req, 'getLiveFleet');
          return streamEvents(req, res, () => uc.execute({ campusId: query.campusId }), {
            intervalMs: query.intervalSec * 1000,
          });
        },
      }),
      defineRoute({
        method: 'get',
        path: '/vehicles/:id/track',
        summary: 'Route history (polyline) between two times, downsampled',
        permission: 'trn.tracking.view',
        schema: {
          params: Id,
          query: z.object({
            from: z.iso.datetime({ offset: true }),
            to: z.iso.datetime({ offset: true }),
            maxPoints: z.coerce.number().int().min(2).max(5000).default(1000),
          }),
        },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<GetVehicleTrack>(req, 'getVehicleTrack').execute({
              vehicleId: params.id,
              from: new Date(query.from),
              to: new Date(query.to),
              maxPoints: query.maxPoints,
            }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/students/:id/bus',
        summary: "Where is my child's bus: position, status, distance and ETA to the child's stop",
        description: 'Guardians (own children), the student, or staff with trn.tracking.view.',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetStudentBus>(req, 'getStudentBus').execute({ studentId: params.id })),
      }),
      defineRoute({
        method: 'get',
        path: '/students/:id/bus/stream',
        summary: "The child's bus as Server-Sent Events",
        schema: { params: Id, query: z.object({ intervalSec: z.coerce.number().int().min(3).max(60).default(10) }) },
        handler: async ({ params, query }, req, res) => {
          const uc = this.resolve<GetStudentBus>(req, 'getStudentBus');
          return streamEvents(req, res, () => uc.execute({ studentId: params.id }), {
            intervalMs: query.intervalSec * 1000,
          });
        },
      }),

      // ---------------- alerts ----------------
      defineRoute({
        method: 'get',
        path: '/alerts',
        summary: 'Transport alerts (overspeed, ...)',
        permission: 'trn.tracking.view',
        schema: {
          query: z.object({
            campusId: zx.uuid().optional(),
            open: z
              .enum(['true', 'false'])
              .transform((v) => v === 'true')
              .optional(),
            limit: z.coerce.number().int().min(1).max(500).default(100),
          }),
        },
        handler: async ({ query }, req) => this.ok(await this.resolve<ListAlerts>(req, 'listAlerts').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/alerts/:id/acknowledge',
        summary: 'Acknowledge an alert',
        permission: 'trn.vehicle.edit',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<AcknowledgeAlert>(req, 'acknowledgeAlert').execute(params)),
      }),
    ];
  }
}
