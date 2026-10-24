import { timingSafeEqual } from 'node:crypto';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { DomainEvent } from '../../../shared/domain/DomainEvent.js';
import { AuthError, ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import {
  acceptPings,
  distanceMeters,
  downsample,
  etaMinutes,
  vehicleStatus,
  type Ping,
  type VehicleStatus,
} from '../domain/geo.js';
import { assertOperates, sha256, visibleVehicle, type TrnDeps } from './FleetUseCases.js';
import type { AlertRow, PositionRow, RouteStopRow, TripRow } from './ports.js';

async function setting<T>(d: TrnDeps, key: string, campusId: string | null, fallback: T): Promise<T> {
  return (await d.coreApi.getSetting<T>(key, campusId)) ?? fallback;
}

async function liveOptions(d: TrnDeps, campusId: string | null) {
  return {
    offlineAfterSec: await setting(d, 'trn.offline_after_sec', campusId, 120),
    idleBelowKmh: await setting(d, 'trn.idle_below_kmh', campusId, 3),
  };
}

export interface IngestResult {
  vehicleId: string;
  accepted: number;
  stored: number;
  rejected: number;
  tripId: string | null;
  nearStops: string[];
  alerts: string[];
}

/**
 * TRN-04 ingest (device or driver app): stores plausible fixes, moves the live position forward, and while a trip is
 * running marks stops the bus comes near / reaches. The first "near" of a stop on a trip tells the guardians of the
 * students who get on (pickup) or off (drop) there; overspeed raises a desk alert (at most one per 10 minutes).
 */
async function ingest(
  d: TrnDeps,
  v: { id: string; campusId: string },
  pings: Ping[],
  source: 'device' | 'driver_app',
): Promise<IngestResult> {
  const now = d.clock.now();
  const { accepted, rejected } = acceptPings(pings, { now, maxFutureSec: 120, maxAgeSec: 24 * 3600 });
  const result: IngestResult = {
    vehicleId: v.id,
    accepted: accepted.length,
    stored: 0,
    rejected,
    tripId: null,
    nearStops: [],
    alerts: [],
  };
  if (!accepted.length) return result;
  result.stored = await d.trnRepo.insertPings(v.id, accepted);

  const today = LocalDate.today(d.clock).iso;
  const trip = await d.trnRepo.activeTripOfVehicle(v.id, today);
  result.tripId = trip?.id ?? null;
  const latest = accepted[accepted.length - 1]!;
  await d.trnRepo.upsertPosition({
    vehicleId: v.id,
    orgId: d.ctx.orgId,
    campusId: v.campusId,
    ping: latest,
    tripId: trip?.id ?? null,
    source,
  });

  const events: DomainEvent[] = [];
  if (trip) {
    const nearM = await setting(d, 'trn.near_stop_meters', v.campusId, 500);
    const arrivedM = await setting(d, 'trn.arrived_meters', v.campusId, 60);
    const stops = (await d.trnRepo.routeStops(trip.routeId)).filter((s) => s.lat !== null && s.lng !== null);
    const seen = await d.trnRepo.tripStopEvents(trip.id);
    const vehicle = (await d.trnRepo.vehicle(v.id))!;
    for (const p of accepted) {
      for (const s of stops) {
        const meters = distanceMeters(p, { lat: s.lat!, lng: s.lng! });
        const state = seen.get(s.stopId) ?? { nearAt: null, arrivedAt: null };
        if (meters <= nearM && !state.nearAt) {
          state.nearAt = p.recordedAt;
          seen.set(s.stopId, state);
          const first = await d.trnRepo.markStopNear({
            tripId: trip.id,
            stopId: s.stopId,
            orgId: d.ctx.orgId,
            campusId: v.campusId,
            at: p.recordedAt,
          });
          if (first) {
            result.nearStops.push(s.stopId);
            const studentIds = await d.trnRepo.studentsAtStop(trip.routeId, s.stopId, trip.direction, today);
            if (studentIds.length)
              events.push({
                type: 'trn.bus_near_stop.v1',
                aggregateType: 'trip',
                aggregateId: trip.id,
                orgId: d.ctx.orgId,
                campusId: v.campusId,
                occurredAt: now,
                payload: {
                  tripId: trip.id,
                  stopId: s.stopId,
                  stopName: s.name,
                  routeName: trip.routeName,
                  vehicleRegNo: vehicle.regNo,
                  direction: trip.direction,
                  etaMinutes: etaMinutes(meters, p.speedKmh ?? null),
                  studentIds,
                },
              });
          }
        }
        if (meters <= arrivedM && !state.arrivedAt) {
          state.arrivedAt = p.recordedAt;
          seen.set(s.stopId, state);
          await d.trnRepo.markStopArrived({
            tripId: trip.id,
            stopId: s.stopId,
            orgId: d.ctx.orgId,
            campusId: v.campusId,
            at: p.recordedAt,
          });
        }
      }
    }
  }

  const limit = await setting(d, 'trn.speed_limit_kmh', v.campusId, 60);
  const fastest = accepted.reduce<Ping | null>((m, p) => ((p.speedKmh ?? 0) > (m?.speedKmh ?? 0) ? p : m), null);
  if (fastest && (fastest.speedKmh ?? 0) > limit) {
    const since = new Date(now.getTime() - 10 * 60_000);
    if (!(await d.trnRepo.hasRecentAlert(v.id, 'overspeed', since))) {
      await d.trnRepo.insertAlert({
        orgId: d.ctx.orgId,
        campusId: v.campusId,
        vehicleId: v.id,
        tripId: trip?.id ?? null,
        kind: 'overspeed',
        at: fastest.recordedAt,
        lat: fastest.lat.toFixed(6),
        lng: fastest.lng.toFixed(6),
        details: { speedKmh: fastest.speedKmh, limitKmh: limit },
      });
      result.alerts.push('overspeed');
    }
  }
  if (events.length) await d.outbox.write(events);
  return result;
}

const PingInput = (p: { recordedAt: string; lat: number; lng: number; speedKmh?: number; heading?: number }): Ping => ({
  recordedAt: new Date(p.recordedAt),
  lat: p.lat,
  lng: p.lng,
  speedKmh: p.speedKmh ?? null,
  heading: p.heading ?? null,
});

export type PingDto = { recordedAt: string; lat: number; lng: number; speedKmh?: number; heading?: number };

/** Driver app (signed-in crew member) or the transport desk posting fixes for a vehicle. */
export class RecordDriverPings extends UseCase<{ vehicleId: string; pings: PingDto[] }, IngestResult> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle(i: { vehicleId: string; pings: PingDto[] }) {
    const v = await visibleVehicle(this.d, i.vehicleId);
    await assertOperates(this.d, v.id);
    if (!v.isActive) throw new ConflictError('VEHICLE_INACTIVE', 'Vehicle is not active');
    return ingest(this.d, v, i.pings.map(PingInput), 'driver_app');
  }
}

/**
 * GPS tracker / gateway (no user): authenticated by device id + key (sha256 compared in constant time).
 * Runs in the system context; the vehicle row fixes organisation and campus.
 */
export class IngestDevicePings extends UseCase<
  { deviceId: string; deviceKey: string; pings: PingDto[] },
  IngestResult
> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle(i: { deviceId: string; deviceKey: string; pings: PingDto[] }) {
    const v = await this.d.trnRepo.vehicleByDevice(i.deviceId);
    const presented = sha256(i.deviceKey);
    const ok = !!v?.keyHash && v.keyHash.length === presented.length && timingSafeEqual(v.keyHash, presented);
    if (!v || !ok) throw new AuthError('DEVICE_UNAUTHORIZED', 'Unknown device or wrong device key');
    if (!v.isActive) throw new ConflictError('VEHICLE_INACTIVE', 'Vehicle is not active');
    return ingest(this.d, v, i.pings.map(PingInput), 'device');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Live views
// ---------------------------------------------------------------------------------------------------------------

export interface NextStop {
  stopId: string;
  name: string;
  distanceMeters: number;
  etaMinutes: number;
}

export interface LiveVehicle {
  vehicleId: string;
  regNo: string;
  kind: string;
  capacity: number;
  campusId: string;
  status: VehicleStatus;
  lastSeenSec: number | null;
  position: Omit<PositionRow, 'vehicleId' | 'tripId'> | null;
  trip: { id: string; routeId: string; routeName: string; direction: string; startedAt: Date | null } | null;
  nextStop: NextStop | null;
}

/** First stop of the trip not yet reached (route order for pickup, reverse for drop). */
async function nextStopOf(d: TrnDeps, trip: TripRow, pos: PositionRow | null): Promise<NextStop | null> {
  if (!pos) return null;
  const stops = await d.trnRepo.routeStops(trip.routeId);
  const ordered: RouteStopRow[] = trip.direction === 'pickup' ? stops : [...stops].reverse();
  const seen = await d.trnRepo.tripStopEvents(trip.id);
  const next = ordered.find((s) => s.lat !== null && s.lng !== null && !seen.get(s.stopId)?.arrivedAt);
  if (!next) return null;
  const meters = distanceMeters(pos, { lat: next.lat!, lng: next.lng! });
  return { stopId: next.stopId, name: next.name, distanceMeters: meters, etaMinutes: etaMinutes(meters, pos.speedKmh) };
}

export async function liveFleet(d: TrnDeps, campusId?: string): Promise<LiveVehicle[]> {
  const now = d.clock.now();
  const today = LocalDate.today(d.clock).iso;
  const vehicles = await d.trnRepo.vehicles(campusId);
  const positions = await d.trnRepo.positions(vehicles.map((v) => v.id));
  const opts = await liveOptions(d, campusId ?? null);
  const out: LiveVehicle[] = [];
  for (const v of vehicles) {
    const pos = positions.get(v.id) ?? null;
    const trip = await d.trnRepo.activeTripOfVehicle(v.id, today);
    out.push({
      vehicleId: v.id,
      regNo: v.regNo,
      kind: v.kind,
      capacity: v.capacity,
      campusId: v.campusId,
      status: vehicleStatus(pos, now, opts),
      lastSeenSec: pos ? Math.max(0, Math.round((now.getTime() - pos.recordedAt.getTime()) / 1000)) : null,
      position: pos
        ? {
            recordedAt: pos.recordedAt,
            lat: pos.lat,
            lng: pos.lng,
            speedKmh: pos.speedKmh,
            heading: pos.heading,
            source: pos.source,
          }
        : null,
      trip: trip
        ? {
            id: trip.id,
            routeId: trip.routeId,
            routeName: trip.routeName,
            direction: trip.direction,
            startedAt: trip.startedAt,
          }
        : null,
      nextStop: trip ? await nextStopOf(d, trip, pos) : null,
    });
  }
  return out;
}

/** Transport desk map: every vehicle with status (moving / idle / offline / no signal), trip and next stop. */
export class GetLiveFleet extends Query<{ campusId?: string }, LiveVehicle[]> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected handle(i: { campusId?: string }) {
    return liveFleet(this.d, i.campusId);
  }
}

export class GetVehicleTrack extends Query<
  { vehicleId: string; from: Date; to: Date; maxPoints: number },
  { vehicleId: string; points: Ping[]; totalPoints: number; distanceMeters: number }
> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle(i: { vehicleId: string; from: Date; to: Date; maxPoints: number }) {
    if (!(await this.d.trnRepo.vehicle(i.vehicleId))) throw new NotFoundError();
    const all = await this.d.trnRepo.track(i.vehicleId, i.from, i.to, 50_000);
    let meters = 0;
    for (let n = 1; n < all.length; n++) meters += distanceMeters(all[n - 1]!, all[n]!);
    return {
      vehicleId: i.vehicleId,
      points: downsample(all, i.maxPoints),
      totalPoints: all.length,
      distanceMeters: meters,
    };
  }
}

export interface StudentBus {
  studentId: string;
  route: { id: string; code: string; name: string };
  stop: {
    id: string;
    name: string;
    lat: number | null;
    lng: number | null;
    pickupTime: string | null;
    dropTime: string | null;
  };
  vehicle: { id: string; regNo: string; kind: string } | null;
  driver: { name: string } | null;
  status: VehicleStatus;
  lastSeenSec: number | null;
  position: { lat: number; lng: number; speedKmh: number | null; heading: number | null; recordedAt: Date } | null;
  trip: { id: string; direction: string; startedAt: Date | null } | null;
  /** the bus relative to this student's stop on the running trip */
  progress: { distanceMeters: number | null; etaMinutes: number | null; reached: boolean } | null;
}

/** "Where is my child's bus?" for the guardian, the student, or staff with trn.tracking.view. */
export class GetStudentBus extends Query<{ studentId: string }, StudentBus> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle({ studentId }: { studentId: string }) {
    const { d } = this;
    const allowed =
      d.scopePolicy.has('trn.tracking.view') ||
      d.ctx.studentId === studentId ||
      (!!d.ctx.guardianId && (await d.sisApi.isGuardianOf(d.ctx.guardianId, studentId)));
    if (!allowed) throw new NotFoundError();
    const today = LocalDate.today(d.clock).iso;
    const a = await d.trnRepo.assignmentOf(studentId, today);
    if (!a) throw new NotFoundError('The student does not use school transport', 'NO_TRANSPORT');
    const route = (await d.trnRepo.route(a.routeId))!;
    const stops = await d.trnRepo.routeStops(route.id);
    const vehicle = route.vehicleId ? await d.trnRepo.vehicle(route.vehicleId) : null;
    const trip = vehicle ? await d.trnRepo.activeTripOfVehicle(vehicle.id, today) : null;
    const myStopId = trip?.direction === 'drop' ? (a.dropStopId ?? a.pickupStopId) : a.pickupStopId;
    const myStop = stops.find((s) => s.stopId === myStopId)!;
    const pos = vehicle ? await d.trnRepo.position(vehicle.id) : null;
    const driverCrew = vehicle ? (await d.trnRepo.crew(vehicle.id, today)).find((c) => c.role === 'driver') : undefined;
    const driver = driverCrew ? await d.hrmApi.staffSummary(driverCrew.staffId) : null;
    let progress: StudentBus['progress'] = null;
    if (trip && trip.routeId === route.id) {
      const reached = !!(await d.trnRepo.tripStopEvents(trip.id)).get(myStop.stopId)?.arrivedAt;
      const meters =
        pos && myStop.lat !== null && myStop.lng !== null
          ? distanceMeters(pos, { lat: myStop.lat, lng: myStop.lng })
          : null;
      progress = {
        distanceMeters: meters,
        etaMinutes: meters === null || reached ? null : etaMinutes(meters, pos?.speedKmh ?? null),
        reached,
      };
    }
    return {
      studentId,
      route: { id: route.id, code: route.code, name: route.name },
      stop: {
        id: myStop.stopId,
        name: myStop.name,
        lat: myStop.lat,
        lng: myStop.lng,
        pickupTime: myStop.pickupTime,
        dropTime: myStop.dropTime,
      },
      vehicle: vehicle ? { id: vehicle.id, regNo: vehicle.regNo, kind: vehicle.kind } : null,
      driver: driver ? { name: driver.fullNameEn } : null,
      status: vehicleStatus(pos, d.clock.now(), await liveOptions(d, route.campusId)),
      lastSeenSec: pos ? Math.max(0, Math.round((d.clock.now().getTime() - pos.recordedAt.getTime()) / 1000)) : null,
      position: pos
        ? { lat: pos.lat, lng: pos.lng, speedKmh: pos.speedKmh, heading: pos.heading, recordedAt: pos.recordedAt }
        : null,
      trip: trip ? { id: trip.id, direction: trip.direction, startedAt: trip.startedAt } : null,
      progress,
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------------------------------------------

export class ListAlerts extends Query<{ campusId?: string; open?: boolean; limit: number }, AlertRow[]> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected handle(i: { campusId?: string; open?: boolean; limit: number }) {
    return this.d.trnRepo.alerts(i);
  }
}

export class AcknowledgeAlert extends UseCase<{ id: string }, { id: string; acknowledged: true }> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    if (!(await this.d.trnRepo.acknowledgeAlert(id, this.d.ctx.userId!, this.d.clock.now())))
      throw new NotFoundError('Alert not found or already acknowledged');
    return { id, acknowledged: true as const };
  }
}
