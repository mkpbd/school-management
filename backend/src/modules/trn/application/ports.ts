import type { Ping } from '../domain/geo.js';

export type TripDirection = 'pickup' | 'drop';

export interface VehicleRow {
  id: string;
  campusId: string;
  regNo: string;
  kind: string;
  capacity: number;
  gpsDeviceId: string | null;
  isActive: boolean;
  hasDeviceKey: boolean;
}

export interface RouteRow {
  id: string;
  campusId: string;
  code: string;
  name: string;
  vehicleId: string | null;
  isActive: boolean;
}

export interface RouteStopRow {
  stopId: string;
  seq: number;
  name: string;
  area: string | null;
  lat: number | null;
  lng: number | null;
  pickupTime: string | null;
  dropTime: string | null;
}

export interface TripRow {
  id: string;
  campusId: string;
  routeId: string;
  routeName: string;
  vehicleId: string;
  tripDate: string;
  direction: TripDirection;
  startedAt: Date | null;
  endedAt: Date | null;
}

export interface PositionRow {
  vehicleId: string;
  recordedAt: Date;
  lat: number;
  lng: number;
  speedKmh: number | null;
  heading: number | null;
  tripId: string | null;
  source: 'device' | 'driver_app';
}

export interface AssignmentRow {
  id: string;
  campusId: string;
  studentId: string;
  enrolmentId: string;
  routeId: string;
  pickupStopId: string;
  dropStopId: string | null;
  direction: 'both' | 'pickup_only' | 'drop_only';
  validFrom: string;
  validTo: string | null;
}

export interface CrewRow {
  id: string;
  vehicleId: string;
  staffId: string;
  role: 'driver' | 'helper' | 'attendant';
  validFrom: string;
  validTo: string | null;
  licenceNo: string | null;
  licenceExpiresOn: string | null;
}

export interface DocumentRow {
  id: string;
  vehicleId: string;
  regNo: string;
  docType: string;
  docNo: string | null;
  expiresOn: string;
  fileId: string | null;
}

export interface AlertRow {
  id: string;
  campusId: string;
  vehicleId: string;
  regNo: string;
  tripId: string | null;
  kind: string;
  at: Date;
  lat: number | null;
  lng: number | null;
  details: unknown;
  acknowledgedAt: Date | null;
}

export interface TrnRepository {
  // vehicles
  vehicle(id: string): Promise<VehicleRow | null>;
  vehicles(campusId?: string): Promise<VehicleRow[]>;
  /** device credentials; called in the system context (the device has no user) */
  vehicleByDevice(
    deviceId: string,
  ): Promise<{ id: string; campusId: string; keyHash: Buffer | null; isActive: boolean } | null>;
  setDeviceKey(vehicleId: string, deviceId: string, keyHash: Buffer, at: Date): Promise<void>;
  documents(vehicleId: string): Promise<DocumentRow[]>;
  insertDocument(values: Record<string, unknown>): Promise<string>;
  deleteDocument(id: string): Promise<boolean>;
  expiringDocuments(until: string, campusId?: string): Promise<DocumentRow[]>;
  crew(vehicleId: string, onDate: string): Promise<CrewRow[]>;
  insertCrew(values: Record<string, unknown>): Promise<string>;
  endCrew(id: string, validTo: string): Promise<boolean>;
  isCrew(vehicleId: string, staffId: string, onDate: string): Promise<boolean>;
  // routes & stops
  route(id: string): Promise<RouteRow | null>;
  routeStops(routeId: string): Promise<RouteStopRow[]>;
  replaceRouteStops(
    routeId: string,
    rows: Array<{ stopId: string; seq: number; pickupTime?: string | null; dropTime?: string | null }>,
  ): Promise<void>;
  visibleStopCount(ids: string[]): Promise<number>;
  // student assignments
  activeAssignmentCount(routeId: string, onDate: string): Promise<number>;
  assignmentOf(studentId: string, onDate: string): Promise<AssignmentRow | null>;
  assignment(id: string): Promise<AssignmentRow | null>;
  insertAssignment(values: Record<string, unknown>): Promise<string>;
  endAssignment(id: string, validTo: string): Promise<void>;
  manifest(routeId: string, onDate: string): Promise<AssignmentRow[]>;
  studentsAtStop(routeId: string, stopId: string, direction: TripDirection, onDate: string): Promise<string[]>;
  lockRoute(routeId: string): Promise<void>;
  // trips
  trip(id: string): Promise<TripRow | null>;
  tripFor(routeId: string, date: string, direction: TripDirection): Promise<TripRow | null>;
  insertTrip(values: Record<string, unknown>): Promise<string>;
  setTripTimes(id: string, patch: { startedAt?: Date; endedAt?: Date }): Promise<void>;
  activeTripOfVehicle(vehicleId: string, date: string): Promise<TripRow | null>;
  trips(f: { date: string; campusId?: string; routeId?: string }): Promise<TripRow[]>;
  tripStopEvents(tripId: string): Promise<Map<string, { nearAt: Date | null; arrivedAt: Date | null }>>;
  /** true only for the first "near" of this trip and stop */
  markStopNear(v: { tripId: string; stopId: string; orgId: string; campusId: string; at: Date }): Promise<boolean>;
  markStopArrived(v: { tripId: string; stopId: string; orgId: string; campusId: string; at: Date }): Promise<void>;
  // tracking
  insertPings(vehicleId: string, pings: Ping[]): Promise<number>;
  /** keeps the newest fix only (an older, late-arriving batch never moves the bus backwards) */
  upsertPosition(v: {
    vehicleId: string;
    orgId: string;
    campusId: string;
    ping: Ping;
    tripId: string | null;
    source: 'device' | 'driver_app';
  }): Promise<void>;
  position(vehicleId: string): Promise<PositionRow | null>;
  positions(vehicleIds: string[]): Promise<Map<string, PositionRow>>;
  track(vehicleId: string, from: Date, to: Date, limit: number): Promise<Ping[]>;
  // alerts
  hasRecentAlert(vehicleId: string, kind: string, since: Date): Promise<boolean>;
  insertAlert(values: Record<string, unknown>): Promise<void>;
  alerts(f: { campusId?: string; open?: boolean; limit: number }): Promise<AlertRow[]>;
  acknowledgeAlert(id: string, by: string, at: Date): Promise<boolean>;
}
