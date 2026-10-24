import { createHash, randomBytes } from 'node:crypto';
import type { EventPublisher, TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { ConflictError, ForbiddenError, InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import type { HrmModuleApi } from '../../hrm/public-api/HrmModuleApi.js';
import type { SisModuleApi } from '../../sis/public-api/SisModuleApi.js';
import type {
  AssignmentRow,
  CrewRow,
  DocumentRow,
  RouteRow,
  RouteStopRow,
  TripDirection,
  TripRow,
  TrnRepository,
  VehicleRow,
} from './ports.js';

export interface TrnDeps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  trnRepo: TrnRepository;
  scopePolicy: ScopePolicy;
  outbox: EventPublisher;
  sisApi: SisModuleApi;
  hrmApi: HrmModuleApi;
  coreApi: CoreModuleApi;
}

export const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

export async function visibleVehicle(d: TrnDeps, id: string): Promise<VehicleRow> {
  const v = await d.trnRepo.vehicle(id);
  if (!v) throw new NotFoundError('Vehicle not found', 'VEHICLE_NOT_FOUND');
  d.scopePolicy.requireCampus(v.campusId);
  return v;
}

async function visibleRoute(d: TrnDeps, id: string): Promise<RouteRow> {
  const r = await d.trnRepo.route(id);
  if (!r) throw new NotFoundError('Route not found', 'ROUTE_NOT_FOUND');
  d.scopePolicy.requireCampus(r.campusId);
  return r;
}

/**
 * Drivers act only on the vehicle they crew today; the transport desk (trn.vehicle.edit) on any vehicle of its
 * campuses.
 */
export async function assertOperates(d: TrnDeps, vehicleId: string): Promise<void> {
  if (d.scopePolicy.has('trn.vehicle.edit')) return;
  const today = LocalDate.today(d.clock).iso;
  if (d.ctx.staffId && (await d.trnRepo.isCrew(vehicleId, d.ctx.staffId, today))) return;
  throw new ForbiddenError('NOT_VEHICLE_CREW', 'You are not assigned to this vehicle today');
}

// ---------------------------------------------------------------------------------------------------------------
// Vehicles: GPS device key, documents, crew (TRN-01)
// ---------------------------------------------------------------------------------------------------------------

/** Issues (or rotates) the key a GPS tracker / gateway uses on POST /trn/gps/ingest. Shown once, stored hashed. */
export class IssueDeviceKey extends UseCase<
  { vehicleId: string; deviceId: string },
  { vehicleId: string; deviceId: string; deviceKey: string; ingestPath: string }
> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle(i: { vehicleId: string; deviceId: string }) {
    const v = await visibleVehicle(this.d, i.vehicleId);
    const deviceKey = randomBytes(24).toString('base64url');
    await this.d.trnRepo.setDeviceKey(v.id, i.deviceId, sha256(deviceKey), this.d.clock.now());
    return { vehicleId: v.id, deviceId: i.deviceId, deviceKey, ingestPath: '/api/v1/trn/gps/ingest' };
  }
}

export class AddVehicleDocument extends UseCase<
  { vehicleId: string; docType: string; docNo?: string; expiresOn: string; fileId?: string },
  { id: string }
> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle(i: {
    vehicleId: string;
    docType: string;
    docNo?: string;
    expiresOn: string;
    fileId?: string;
  }) {
    await visibleVehicle(this.d, i.vehicleId);
    const id = await this.d.trnRepo.insertDocument({
      vehicleId: i.vehicleId,
      docType: i.docType,
      docNo: i.docNo ?? null,
      expiresOn: i.expiresOn,
      fileId: i.fileId ?? null,
    });
    return { id };
  }
}

export class ListVehicleDocuments extends Query<{ vehicleId: string }, DocumentRow[]> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle({ vehicleId }: { vehicleId: string }) {
    if (!(await this.d.trnRepo.vehicle(vehicleId))) throw new NotFoundError();
    return this.d.trnRepo.documents(vehicleId);
  }
}

export class DeleteVehicleDocument extends UseCase<{ id: string }, void> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    if (!(await this.d.trnRepo.deleteDocument(id))) throw new NotFoundError();
  }
}

/** Fitness / insurance / tax token / route permit expiring within N days (or already expired). */
export class ListExpiringDocuments extends Query<
  { withinDays: number; campusId?: string },
  Array<DocumentRow & { daysLeft: number }>
> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle(i: { withinDays: number; campusId?: string }) {
    const today = LocalDate.today(this.d.clock);
    const rows = await this.d.trnRepo.expiringDocuments(today.addDays(i.withinDays).iso, i.campusId);
    return rows.map((r) => ({ ...r, daysLeft: today.daysUntil(LocalDate.parse(r.expiresOn)) }));
  }
}

export class AssignCrew extends UseCase<
  {
    vehicleId: string;
    staffId: string;
    role: 'driver' | 'helper' | 'attendant';
    validFrom?: string;
    licenceNo?: string;
    licenceExpiresOn?: string;
  },
  { id: string }
> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle(i: {
    vehicleId: string;
    staffId: string;
    role: 'driver' | 'helper' | 'attendant';
    validFrom?: string;
    licenceNo?: string;
    licenceExpiresOn?: string;
  }) {
    const v = await visibleVehicle(this.d, i.vehicleId);
    const staff = await this.d.hrmApi.staffSummary(i.staffId);
    if (!staff || staff.status !== 'active')
      throw new NotFoundError('Active staff member not found', 'STAFF_NOT_FOUND');
    if (i.role === 'driver' && (!i.licenceNo || !i.licenceExpiresOn))
      throw new InvariantError('LICENCE_REQUIRED', 'A driver needs a licence number and expiry date');
    const today = LocalDate.today(this.d.clock).iso;
    if (i.licenceExpiresOn && i.licenceExpiresOn < today)
      throw new InvariantError('LICENCE_EXPIRED', 'The driving licence has expired');
    const validFrom = i.validFrom ?? today;
    if ((await this.d.trnRepo.crew(v.id, validFrom)).some((c) => c.staffId === i.staffId))
      throw new ConflictError('ALREADY_CREW', `${staff.fullNameEn} already crews this vehicle`);
    const id = await this.d.trnRepo.insertCrew({
      vehicleId: v.id,
      staffId: i.staffId,
      role: i.role,
      validFrom,
      licenceNo: i.licenceNo ?? null,
      licenceExpiresOn: i.licenceExpiresOn ?? null,
    });
    return { id };
  }
}

export class ListCrew extends Query<{ vehicleId: string }, Array<CrewRow & { name: string; phone: string }>> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle({ vehicleId }: { vehicleId: string }) {
    if (!(await this.d.trnRepo.vehicle(vehicleId))) throw new NotFoundError();
    const crew = await this.d.trnRepo.crew(vehicleId, LocalDate.today(this.d.clock).iso);
    const staff = await this.d.hrmApi.staffSummaries(crew.map((c) => c.staffId));
    return crew.map((c) => ({
      ...c,
      name: staff.get(c.staffId)?.fullNameEn ?? '',
      phone: staff.get(c.staffId)?.phone ?? '',
    }));
  }
}

export class EndCrew extends UseCase<{ id: string; validTo?: string }, void> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; validTo?: string }) {
    if (!(await this.d.trnRepo.endCrew(i.id, i.validTo ?? LocalDate.today(this.d.clock).iso)))
      throw new NotFoundError();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Routes, stops, student assignment (TRN-02)
// ---------------------------------------------------------------------------------------------------------------

export class SetRouteStops extends UseCase<
  { routeId: string; stops: Array<{ stopId: string; pickupTime?: string; dropTime?: string }> },
  RouteStopRow[]
> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle(i: {
    routeId: string;
    stops: Array<{ stopId: string; pickupTime?: string; dropTime?: string }>;
  }) {
    await visibleRoute(this.d, i.routeId);
    const ids = i.stops.map((s) => s.stopId);
    if (new Set(ids).size !== ids.length) throw new InvariantError('STOP_REPEATED', 'A stop appears twice');
    if ((await this.d.trnRepo.visibleStopCount(ids)) !== ids.length)
      throw new NotFoundError('A stop was not found', 'STOP_NOT_FOUND');
    // the order given is the pickup order
    await this.d.trnRepo.replaceRouteStops(
      i.routeId,
      i.stops.map((s, n) => ({ stopId: s.stopId, seq: n + 1, pickupTime: s.pickupTime, dropTime: s.dropTime })),
    );
    return this.d.trnRepo.routeStops(i.routeId);
  }
}

export interface RouteDetail extends RouteRow {
  stops: RouteStopRow[];
  vehicle: VehicleRow | null;
  students: number;
}

export class GetRoute extends Query<{ id: string }, RouteDetail> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const r = await this.d.trnRepo.route(id);
    if (!r) throw new NotFoundError();
    return {
      ...r,
      stops: await this.d.trnRepo.routeStops(id),
      vehicle: r.vehicleId ? await this.d.trnRepo.vehicle(r.vehicleId) : null,
      students: await this.d.trnRepo.activeAssignmentCount(id, LocalDate.today(this.d.clock).iso),
    };
  }
}

/** Student -> route + stops; seats limited by the route's vehicle (route row locked against parallel bookings). */
export class AssignStudentTransport extends UseCase<
  {
    studentId: string;
    routeId: string;
    pickupStopId: string;
    dropStopId?: string;
    direction?: 'both' | 'pickup_only' | 'drop_only';
    validFrom?: string;
  },
  { id: string; seatsLeft: number }
> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle(i: {
    studentId: string;
    routeId: string;
    pickupStopId: string;
    dropStopId?: string;
    direction?: 'both' | 'pickup_only' | 'drop_only';
    validFrom?: string;
  }) {
    const { d } = this;
    const r = await visibleRoute(d, i.routeId);
    if (!r.isActive) throw new ConflictError('ROUTE_INACTIVE', 'Route is not active');
    const validFrom = i.validFrom ?? LocalDate.today(d.clock).iso;
    const enrolment = await d.sisApi.activeEnrolment(i.studentId, validFrom);
    if (!enrolment) throw new ConflictError('STUDENT_NOT_ENROLLED', 'Student has no active enrolment on that date');
    if (enrolment.campusId !== r.campusId)
      throw new InvariantError('ROUTE_OTHER_CAMPUS', "The route belongs to another campus than the student's");
    const onRoute = new Set((await d.trnRepo.routeStops(r.id)).map((s) => s.stopId));
    for (const s of [i.pickupStopId, i.dropStopId].filter(Boolean) as string[])
      if (!onRoute.has(s)) throw new InvariantError('STOP_NOT_ON_ROUTE', 'The stop is not on this route');
    if (await d.trnRepo.assignmentOf(i.studentId, validFrom))
      throw new ConflictError('ALREADY_ASSIGNED', 'End the current transport assignment first');

    await d.trnRepo.lockRoute(r.id);
    const vehicle = r.vehicleId ? await d.trnRepo.vehicle(r.vehicleId) : null;
    const taken = await d.trnRepo.activeAssignmentCount(r.id, validFrom);
    if (vehicle && taken >= vehicle.capacity)
      throw new ConflictError('ROUTE_FULL', `All ${vehicle.capacity} seats of ${vehicle.regNo} are taken`);
    const id = await d.trnRepo.insertAssignment({
      orgId: d.ctx.orgId,
      campusId: r.campusId,
      enrolmentId: enrolment.id,
      studentId: i.studentId,
      routeId: r.id,
      pickupStopId: i.pickupStopId,
      dropStopId: i.dropStopId ?? null,
      direction: i.direction ?? 'both',
      validFrom,
    });
    await d.outbox.write([
      {
        type: 'trn.assignment_changed.v1',
        aggregateType: 'transport_assignment',
        aggregateId: id,
        orgId: d.ctx.orgId,
        campusId: r.campusId,
        occurredAt: d.clock.now(),
        payload: { assignmentId: id, studentId: i.studentId, routeId: r.id, change: 'assigned', validFrom },
      },
    ]);
    return { id, seatsLeft: vehicle ? vehicle.capacity - taken - 1 : -1 };
  }
}

export class EndStudentTransport extends UseCase<{ id: string; validTo?: string }, AssignmentRow> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle(i: { id: string; validTo?: string }) {
    const a = await this.d.trnRepo.assignment(i.id);
    if (!a) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(a.campusId);
    if (a.validTo) throw new ConflictError('ASSIGNMENT_ENDED', 'Assignment already ended');
    const validTo = i.validTo ?? LocalDate.today(this.d.clock).iso;
    if (validTo < a.validFrom) throw new InvariantError('DATE_RANGE_INVALID', 'End date is before the start date');
    await this.d.trnRepo.endAssignment(a.id, validTo);
    await this.d.outbox.write([
      {
        type: 'trn.assignment_changed.v1',
        aggregateType: 'transport_assignment',
        aggregateId: a.id,
        orgId: this.d.ctx.orgId,
        campusId: a.campusId,
        occurredAt: this.d.clock.now(),
        payload: { assignmentId: a.id, studentId: a.studentId, routeId: a.routeId, change: 'ended', validTo },
      },
    ]);
    return { ...a, validTo };
  }
}

/** Who rides this route (with pickup / drop stop), for the driver and the transport desk. */
export class RouteManifest extends Query<
  { routeId: string; date?: string },
  Array<AssignmentRow & { studentName: string; admissionNo: string }>
> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle(i: { routeId: string; date?: string }) {
    if (!(await this.d.trnRepo.route(i.routeId))) throw new NotFoundError();
    const rows = await this.d.trnRepo.manifest(i.routeId, i.date ?? LocalDate.today(this.d.clock).iso);
    const briefs = await this.d.sisApi.studentBriefs(rows.map((r) => r.studentId));
    return rows.map((r) => ({
      ...r,
      studentName: briefs.get(r.studentId)?.fullNameEn ?? '',
      admissionNo: briefs.get(r.studentId)?.admissionNo ?? '',
    }));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Trips: one run of a route per day and direction
// ---------------------------------------------------------------------------------------------------------------

export class StartTrip extends UseCase<
  { routeId: string; direction: TripDirection; vehicleId?: string },
  TripRow & { resumed: boolean }
> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle(i: { routeId: string; direction: TripDirection; vehicleId?: string }) {
    const { d } = this;
    const r = await visibleRoute(d, i.routeId);
    const vehicleId = i.vehicleId ?? r.vehicleId;
    if (!vehicleId) throw new InvariantError('NO_VEHICLE', 'The route has no vehicle; pass vehicleId');
    await visibleVehicle(d, vehicleId);
    await assertOperates(d, vehicleId);
    const today = LocalDate.today(d.clock).iso;
    const existing = await d.trnRepo.tripFor(r.id, today, i.direction);
    if (existing?.endedAt)
      throw new ConflictError('TRIP_COMPLETED', `Today's ${i.direction} trip is already completed`);
    if (existing?.startedAt) return { ...existing, resumed: true };
    const id =
      existing?.id ??
      (await d.trnRepo.insertTrip({
        orgId: d.ctx.orgId,
        campusId: r.campusId,
        routeId: r.id,
        vehicleId,
        tripDate: today,
        direction: i.direction,
      }));
    await d.trnRepo.setTripTimes(id, { startedAt: d.clock.now() });
    return { ...(await d.trnRepo.trip(id))!, resumed: false };
  }
}

export class EndTrip extends UseCase<{ id: string }, TripRow> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected async handle({ id }: { id: string }) {
    const t = await this.d.trnRepo.trip(id);
    if (!t) throw new NotFoundError();
    this.d.scopePolicy.requireCampus(t.campusId);
    await assertOperates(this.d, t.vehicleId);
    if (!t.startedAt) throw new ConflictError('TRIP_NOT_STARTED', 'Trip was not started');
    if (t.endedAt) throw new ConflictError('TRIP_COMPLETED', 'Trip is already completed');
    await this.d.trnRepo.setTripTimes(id, { endedAt: this.d.clock.now() });
    return (await this.d.trnRepo.trip(id))!;
  }
}

export class ListTrips extends Query<{ date?: string; campusId?: string; routeId?: string }, TripRow[]> {
  constructor(private readonly d: TrnDeps) {
    super(d.uow);
  }
  protected handle(i: { date?: string; campusId?: string; routeId?: string }) {
    return this.d.trnRepo.trips({ ...i, date: i.date ?? LocalDate.today(this.d.clock).iso });
  }
}
