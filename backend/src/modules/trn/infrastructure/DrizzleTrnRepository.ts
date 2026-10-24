import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  crewAssignment,
  gpsPing,
  route,
  routeStop,
  stop,
  transportAssignment,
  trip,
  tripStopEvent,
  vehicle,
  vehicleAlert,
  vehicleDocument,
  vehiclePosition,
} from '../../../shared/infrastructure/db/schema/trn.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { Ping } from '../domain/geo.js';
import type {
  AlertRow,
  AssignmentRow,
  CrewRow,
  DocumentRow,
  PositionRow,
  RouteRow,
  RouteStopRow,
  TripDirection,
  TripRow,
  TrnRepository,
  VehicleRow,
} from '../application/ports.js';

// numeric(9,6) arrives as a string
const num = (v: string | null): number | null => (v === null ? null : Number(v));

const vehicleCols = {
  id: vehicle.id,
  campusId: vehicle.campusId,
  regNo: vehicle.regNo,
  kind: vehicle.kind,
  capacity: vehicle.capacity,
  gpsDeviceId: vehicle.gpsDeviceId,
  isActive: vehicle.isActive,
  hasDeviceKey: sql<boolean>`(${vehicle.gpsDeviceKeyHash} IS NOT NULL)`,
};

const tripCols = {
  id: trip.id,
  campusId: trip.campusId,
  routeId: trip.routeId,
  routeName: route.name,
  vehicleId: trip.vehicleId,
  tripDate: trip.tripDate,
  direction: trip.direction,
  startedAt: trip.startedAt,
  endedAt: trip.endedAt,
};

const assignmentCols = {
  id: transportAssignment.id,
  campusId: transportAssignment.campusId,
  studentId: transportAssignment.studentId,
  enrolmentId: transportAssignment.enrolmentId,
  routeId: transportAssignment.routeId,
  pickupStopId: transportAssignment.pickupStopId,
  dropStopId: transportAssignment.dropStopId,
  direction: transportAssignment.direction,
  validFrom: transportAssignment.validFrom,
  validTo: transportAssignment.validTo,
};

const positionCols = {
  vehicleId: vehiclePosition.vehicleId,
  recordedAt: vehiclePosition.recordedAt,
  lat: vehiclePosition.lat,
  lng: vehiclePosition.lng,
  speedKmh: vehiclePosition.speedKmh,
  heading: vehiclePosition.heading,
  tripId: vehiclePosition.tripId,
  source: vehiclePosition.source,
};

const documentCols = {
  id: vehicleDocument.id,
  vehicleId: vehicleDocument.vehicleId,
  regNo: vehicle.regNo,
  docType: vehicleDocument.docType,
  docNo: vehicleDocument.docNo,
  expiresOn: vehicleDocument.expiresOn,
  fileId: vehicleDocument.fileId,
};

/** Assignment valid on a date (valid_to inclusive). */
const validOn = (onDate: string): SQL =>
  and(
    lte(transportAssignment.validFrom, onDate),
    or(isNull(transportAssignment.validTo), gte(transportAssignment.validTo, onDate)),
  )!;

/**
 * Tables without org/campus columns (route_stop, vehicle_document, crew_assignment, gps_ping) have no RLS of their own;
 * every query on them is joined to (or gated by) the RLS-protected vehicle / route row.
 */
export class DrizzleTrnRepository implements TrnRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  // ---------------- vehicles ----------------
  async vehicle(id: string): Promise<VehicleRow | null> {
    const [r] = await this.tx.select(vehicleCols).from(vehicle).where(eq(vehicle.id, id));
    return r ?? null;
  }

  async vehicles(campusId?: string): Promise<VehicleRow[]> {
    return this.tx
      .select(vehicleCols)
      .from(vehicle)
      .where(and(eq(vehicle.isActive, true), campusId ? eq(vehicle.campusId, campusId) : undefined))
      .orderBy(asc(vehicle.regNo));
  }

  async vehicleByDevice(deviceId: string) {
    const [r] = await this.tx
      .select({
        id: vehicle.id,
        campusId: vehicle.campusId,
        keyHash: vehicle.gpsDeviceKeyHash,
        isActive: vehicle.isActive,
      })
      .from(vehicle)
      .where(eq(vehicle.gpsDeviceId, deviceId));
    return r ?? null;
  }

  async setDeviceKey(vehicleId: string, deviceId: string, keyHash: Buffer, at: Date): Promise<void> {
    await this.tx
      .update(vehicle)
      .set({ gpsDeviceId: deviceId, gpsDeviceKeyHash: keyHash, gpsKeyRotatedAt: at })
      .where(eq(vehicle.id, vehicleId));
  }

  async documents(vehicleId: string): Promise<DocumentRow[]> {
    return this.tx
      .select(documentCols)
      .from(vehicleDocument)
      .innerJoin(vehicle, eq(vehicle.id, vehicleDocument.vehicleId))
      .where(eq(vehicleDocument.vehicleId, vehicleId))
      .orderBy(asc(vehicleDocument.expiresOn));
  }

  async insertDocument(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(vehicleDocument)
      .values(values as typeof vehicleDocument.$inferInsert)
      .returning({ id: vehicleDocument.id });
    return r!.id;
  }

  async deleteDocument(id: string): Promise<boolean> {
    const rows = await this.tx
      .delete(vehicleDocument)
      .where(
        and(
          eq(vehicleDocument.id, id),
          inArray(vehicleDocument.vehicleId, this.tx.select({ id: vehicle.id }).from(vehicle)),
        ),
      )
      .returning({ id: vehicleDocument.id });
    return rows.length > 0;
  }

  async expiringDocuments(until: string, campusId?: string): Promise<DocumentRow[]> {
    return this.tx
      .select(documentCols)
      .from(vehicleDocument)
      .innerJoin(vehicle, eq(vehicle.id, vehicleDocument.vehicleId))
      .where(
        and(
          lte(vehicleDocument.expiresOn, until),
          eq(vehicle.isActive, true),
          campusId ? eq(vehicle.campusId, campusId) : undefined,
        ),
      )
      .orderBy(asc(vehicleDocument.expiresOn));
  }

  async crew(vehicleId: string, onDate: string): Promise<CrewRow[]> {
    return this.tx
      .select({
        id: crewAssignment.id,
        vehicleId: crewAssignment.vehicleId,
        staffId: crewAssignment.staffId,
        role: crewAssignment.role,
        validFrom: crewAssignment.validFrom,
        validTo: crewAssignment.validTo,
        licenceNo: crewAssignment.licenceNo,
        licenceExpiresOn: crewAssignment.licenceExpiresOn,
      })
      .from(crewAssignment)
      .innerJoin(vehicle, eq(vehicle.id, crewAssignment.vehicleId))
      .where(
        and(
          eq(crewAssignment.vehicleId, vehicleId),
          lte(crewAssignment.validFrom, onDate),
          or(isNull(crewAssignment.validTo), gte(crewAssignment.validTo, onDate)),
        ),
      )
      .orderBy(asc(crewAssignment.role));
  }

  async insertCrew(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(crewAssignment)
      .values(values as typeof crewAssignment.$inferInsert)
      .returning({ id: crewAssignment.id });
    return r!.id;
  }

  async endCrew(id: string, validTo: string): Promise<boolean> {
    const rows = await this.tx
      .update(crewAssignment)
      .set({ validTo })
      .where(
        and(
          eq(crewAssignment.id, id),
          inArray(crewAssignment.vehicleId, this.tx.select({ id: vehicle.id }).from(vehicle)),
        ),
      )
      .returning({ id: crewAssignment.id });
    return rows.length > 0;
  }

  async isCrew(vehicleId: string, staffId: string, onDate: string): Promise<boolean> {
    return (await this.crew(vehicleId, onDate)).some((c) => c.staffId === staffId);
  }

  // ---------------- routes & stops ----------------
  async route(id: string): Promise<RouteRow | null> {
    const [r] = await this.tx
      .select({
        id: route.id,
        campusId: route.campusId,
        code: route.code,
        name: route.name,
        vehicleId: route.vehicleId,
        isActive: route.isActive,
      })
      .from(route)
      .where(eq(route.id, id));
    return r ?? null;
  }

  async routeStops(routeId: string): Promise<RouteStopRow[]> {
    const rows = await this.tx
      .select({
        stopId: routeStop.stopId,
        seq: routeStop.seq,
        name: stop.name,
        area: stop.area,
        lat: stop.lat,
        lng: stop.lng,
        pickupTime: routeStop.pickupTime,
        dropTime: routeStop.dropTime,
      })
      .from(routeStop)
      .innerJoin(route, eq(route.id, routeStop.routeId))
      .innerJoin(stop, eq(stop.id, routeStop.stopId))
      .where(eq(routeStop.routeId, routeId))
      .orderBy(asc(routeStop.seq));
    return rows.map((r) => ({ ...r, lat: num(r.lat), lng: num(r.lng) }));
  }

  async replaceRouteStops(
    routeId: string,
    rows: Array<{ stopId: string; seq: number; pickupTime?: string | null; dropTime?: string | null }>,
  ): Promise<void> {
    await this.tx.delete(routeStop).where(eq(routeStop.routeId, routeId));
    if (rows.length)
      await this.tx.insert(routeStop).values(
        rows.map((r) => ({
          routeId,
          stopId: r.stopId,
          seq: r.seq,
          pickupTime: r.pickupTime ?? null,
          dropTime: r.dropTime ?? null,
        })),
      );
  }

  async visibleStopCount(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const [r] = await this.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(stop)
      .where(inArray(stop.id, ids));
    return r?.n ?? 0;
  }

  // ---------------- assignments ----------------
  async activeAssignmentCount(routeId: string, onDate: string): Promise<number> {
    const [r] = await this.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(transportAssignment)
      .where(and(eq(transportAssignment.routeId, routeId), validOn(onDate)));
    return r?.n ?? 0;
  }

  async assignmentOf(studentId: string, onDate: string): Promise<AssignmentRow | null> {
    const [r] = await this.tx
      .select(assignmentCols)
      .from(transportAssignment)
      .where(and(eq(transportAssignment.studentId, studentId), validOn(onDate)));
    return r ?? null;
  }

  async assignment(id: string): Promise<AssignmentRow | null> {
    const [r] = await this.tx.select(assignmentCols).from(transportAssignment).where(eq(transportAssignment.id, id));
    return r ?? null;
  }

  async insertAssignment(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(transportAssignment)
      .values(values as typeof transportAssignment.$inferInsert)
      .returning({ id: transportAssignment.id });
    return r!.id;
  }

  async endAssignment(id: string, validTo: string): Promise<void> {
    await this.tx.update(transportAssignment).set({ validTo }).where(eq(transportAssignment.id, id));
  }

  async manifest(routeId: string, onDate: string): Promise<AssignmentRow[]> {
    return this.tx
      .select(assignmentCols)
      .from(transportAssignment)
      .where(and(eq(transportAssignment.routeId, routeId), validOn(onDate)))
      .orderBy(asc(transportAssignment.pickupStopId));
  }

  async studentsAtStop(routeId: string, stopId: string, direction: TripDirection, onDate: string): Promise<string[]> {
    const atStop =
      direction === 'pickup'
        ? and(
            eq(transportAssignment.pickupStopId, stopId),
            inArray(transportAssignment.direction, ['both', 'pickup_only']),
          )
        : and(
            sql`coalesce(${transportAssignment.dropStopId}, ${transportAssignment.pickupStopId}) = ${stopId}`,
            inArray(transportAssignment.direction, ['both', 'drop_only']),
          );
    const rows = await this.tx
      .select({ studentId: transportAssignment.studentId })
      .from(transportAssignment)
      .where(and(eq(transportAssignment.routeId, routeId), validOn(onDate), atStop));
    return rows.map((r) => r.studentId);
  }

  async lockRoute(routeId: string): Promise<void> {
    await this.tx.select({ id: route.id }).from(route).where(eq(route.id, routeId)).for('update');
  }

  // ---------------- trips ----------------
  private tripQuery() {
    return this.tx.select(tripCols).from(trip).innerJoin(route, eq(route.id, trip.routeId));
  }

  async trip(id: string): Promise<TripRow | null> {
    const [r] = await this.tripQuery().where(eq(trip.id, id));
    return r ?? null;
  }

  async tripFor(routeId: string, date: string, direction: TripDirection): Promise<TripRow | null> {
    const [r] = await this.tripQuery().where(
      and(eq(trip.routeId, routeId), eq(trip.tripDate, date), eq(trip.direction, direction)),
    );
    return r ?? null;
  }

  async insertTrip(values: Record<string, unknown>): Promise<string> {
    const [r] = await this.tx
      .insert(trip)
      .values(values as typeof trip.$inferInsert)
      .returning({ id: trip.id });
    return r!.id;
  }

  async setTripTimes(id: string, patch: { startedAt?: Date; endedAt?: Date }): Promise<void> {
    await this.tx.update(trip).set(patch).where(eq(trip.id, id));
  }

  async activeTripOfVehicle(vehicleId: string, date: string): Promise<TripRow | null> {
    const [r] = await this.tripQuery()
      .where(
        and(eq(trip.vehicleId, vehicleId), eq(trip.tripDate, date), isNotNull(trip.startedAt), isNull(trip.endedAt)),
      )
      .orderBy(desc(trip.startedAt))
      .limit(1);
    return r ?? null;
  }

  async trips(f: { date: string; campusId?: string; routeId?: string }): Promise<TripRow[]> {
    return this.tripQuery()
      .where(
        and(
          eq(trip.tripDate, f.date),
          f.campusId ? eq(trip.campusId, f.campusId) : undefined,
          f.routeId ? eq(trip.routeId, f.routeId) : undefined,
        ),
      )
      .orderBy(asc(route.code), asc(trip.direction));
  }

  async tripStopEvents(tripId: string) {
    const rows = await this.tx
      .select({ stopId: tripStopEvent.stopId, nearAt: tripStopEvent.nearAt, arrivedAt: tripStopEvent.arrivedAt })
      .from(tripStopEvent)
      .where(eq(tripStopEvent.tripId, tripId));
    return new Map(rows.map((r) => [r.stopId, { nearAt: r.nearAt, arrivedAt: r.arrivedAt }]));
  }

  async markStopNear(v: { tripId: string; stopId: string; orgId: string; campusId: string; at: Date }) {
    const rows = await this.tx
      .insert(tripStopEvent)
      .values({ tripId: v.tripId, stopId: v.stopId, orgId: v.orgId, campusId: v.campusId, nearAt: v.at })
      .onConflictDoNothing()
      .returning({ stopId: tripStopEvent.stopId });
    return rows.length > 0;
  }

  async markStopArrived(v: { tripId: string; stopId: string; orgId: string; campusId: string; at: Date }) {
    await this.tx
      .insert(tripStopEvent)
      .values({
        tripId: v.tripId,
        stopId: v.stopId,
        orgId: v.orgId,
        campusId: v.campusId,
        nearAt: v.at,
        arrivedAt: v.at,
      })
      .onConflictDoUpdate({
        target: [tripStopEvent.tripId, tripStopEvent.stopId],
        set: { arrivedAt: sql`coalesce(${tripStopEvent.arrivedAt}, excluded.arrived_at)` },
      });
  }

  // ---------------- tracking ----------------
  async insertPings(vehicleId: string, pings: Ping[]): Promise<number> {
    if (!pings.length) return 0;
    const rows = await this.tx
      .insert(gpsPing)
      .values(
        pings.map((p) => ({
          vehicleId,
          recordedAt: p.recordedAt,
          lat: p.lat.toFixed(6),
          lng: p.lng.toFixed(6),
          speedKmh: p.speedKmh == null ? null : p.speedKmh.toFixed(1),
          heading: p.heading ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ at: gpsPing.recordedAt });
    return rows.length;
  }

  async upsertPosition(v: {
    vehicleId: string;
    orgId: string;
    campusId: string;
    ping: Ping;
    tripId: string | null;
    source: 'device' | 'driver_app';
  }): Promise<void> {
    const values = {
      vehicleId: v.vehicleId,
      orgId: v.orgId,
      campusId: v.campusId,
      recordedAt: v.ping.recordedAt,
      receivedAt: new Date(),
      lat: v.ping.lat.toFixed(6),
      lng: v.ping.lng.toFixed(6),
      speedKmh: v.ping.speedKmh == null ? null : v.ping.speedKmh.toFixed(1),
      heading: v.ping.heading ?? null,
      tripId: v.tripId,
      source: v.source,
    };
    await this.tx
      .insert(vehiclePosition)
      .values(values)
      .onConflictDoUpdate({
        target: vehiclePosition.vehicleId,
        set: {
          recordedAt: values.recordedAt,
          receivedAt: values.receivedAt,
          lat: values.lat,
          lng: values.lng,
          speedKmh: values.speedKmh,
          heading: values.heading,
          tripId: values.tripId,
          source: values.source,
        },
        setWhere: sql`${vehiclePosition.recordedAt} < excluded.recorded_at`,
      });
  }

  private toPosition(r: {
    vehicleId: string;
    recordedAt: Date;
    lat: string;
    lng: string;
    speedKmh: string | null;
    heading: number | null;
    tripId: string | null;
    source: 'device' | 'driver_app';
  }): PositionRow {
    return { ...r, lat: Number(r.lat), lng: Number(r.lng), speedKmh: num(r.speedKmh) };
  }

  async position(vehicleId: string): Promise<PositionRow | null> {
    const [r] = await this.tx
      .select(positionCols)
      .from(vehiclePosition)
      .where(eq(vehiclePosition.vehicleId, vehicleId));
    return r ? this.toPosition(r) : null;
  }

  async positions(vehicleIds: string[]): Promise<Map<string, PositionRow>> {
    if (!vehicleIds.length) return new Map();
    const rows = await this.tx
      .select(positionCols)
      .from(vehiclePosition)
      .where(inArray(vehiclePosition.vehicleId, vehicleIds));
    return new Map(rows.map((r) => [r.vehicleId, this.toPosition(r)]));
  }

  async track(vehicleId: string, from: Date, to: Date, limit: number): Promise<Ping[]> {
    const rows = await this.tx
      .select({
        recordedAt: gpsPing.recordedAt,
        lat: gpsPing.lat,
        lng: gpsPing.lng,
        speedKmh: gpsPing.speedKmh,
        heading: gpsPing.heading,
      })
      .from(gpsPing)
      .where(and(eq(gpsPing.vehicleId, vehicleId), gte(gpsPing.recordedAt, from), lte(gpsPing.recordedAt, to)))
      .orderBy(asc(gpsPing.recordedAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, lat: Number(r.lat), lng: Number(r.lng), speedKmh: num(r.speedKmh) }));
  }

  // ---------------- alerts ----------------
  async hasRecentAlert(vehicleId: string, kind: string, since: Date): Promise<boolean> {
    const [r] = await this.tx
      .select({ id: vehicleAlert.id })
      .from(vehicleAlert)
      .where(
        and(
          eq(vehicleAlert.vehicleId, vehicleId),
          eq(vehicleAlert.kind, kind as AlertRow['kind'] as never),
          gte(vehicleAlert.at, since),
        ),
      )
      .limit(1);
    return !!r;
  }

  async insertAlert(values: Record<string, unknown>): Promise<void> {
    await this.tx.insert(vehicleAlert).values(values as typeof vehicleAlert.$inferInsert);
  }

  async alerts(f: { campusId?: string; open?: boolean; limit: number }): Promise<AlertRow[]> {
    const rows = await this.tx
      .select({
        id: vehicleAlert.id,
        campusId: vehicleAlert.campusId,
        vehicleId: vehicleAlert.vehicleId,
        regNo: vehicle.regNo,
        tripId: vehicleAlert.tripId,
        kind: vehicleAlert.kind,
        at: vehicleAlert.at,
        lat: vehicleAlert.lat,
        lng: vehicleAlert.lng,
        details: vehicleAlert.details,
        acknowledgedAt: vehicleAlert.acknowledgedAt,
      })
      .from(vehicleAlert)
      .innerJoin(vehicle, eq(vehicle.id, vehicleAlert.vehicleId))
      .where(
        and(
          f.campusId ? eq(vehicleAlert.campusId, f.campusId) : undefined,
          f.open ? isNull(vehicleAlert.acknowledgedAt) : undefined,
        ),
      )
      .orderBy(desc(vehicleAlert.at))
      .limit(f.limit);
    return rows.map((r) => ({ ...r, lat: num(r.lat), lng: num(r.lng) }));
  }

  async acknowledgeAlert(id: string, by: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(vehicleAlert)
      .set({ acknowledgedAt: at, acknowledgedBy: by })
      .where(and(eq(vehicleAlert.id, id), isNull(vehicleAlert.acknowledgedAt)))
      .returning({ id: vehicleAlert.id });
    return rows.length > 0;
  }
}
