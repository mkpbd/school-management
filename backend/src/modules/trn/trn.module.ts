import { asClass, Lifetime, type AwilixContainer } from 'awilix';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleDefinition } from '../../shared/module.js';
import {
  AddVehicleDocument,
  AssignCrew,
  AssignStudentTransport,
  DeleteVehicleDocument,
  EndCrew,
  EndStudentTransport,
  EndTrip,
  GetRoute,
  IssueDeviceKey,
  ListCrew,
  ListExpiringDocuments,
  ListTrips,
  ListVehicleDocuments,
  RouteManifest,
  SetRouteStops,
  StartTrip,
} from './application/FleetUseCases.js';
import {
  AcknowledgeAlert,
  GetLiveFleet,
  GetStudentBus,
  GetVehicleTrack,
  IngestDevicePings,
  ListAlerts,
  RecordDriverPings,
} from './application/TrackingUseCases.js';
import { DrizzleTrnRepository } from './infrastructure/DrizzleTrnRepository.js';
import { TrackingController } from './presentation/TrackingController.js';
import { TrnController } from './presentation/TrnController.js';

/** TRN: vehicles, documents, crew, routes, stops, student assignment, trips, live GPS tracking. */
export class TrnModule implements ModuleDefinition {
  readonly name = 'trn';

  register(container: AwilixContainer): void {
    const scoped = { lifetime: Lifetime.SCOPED };
    container.register({
      trnRepo: asClass(DrizzleTrnRepository, scoped),
      issueDeviceKey: asClass(IssueDeviceKey, scoped),
      addVehicleDocument: asClass(AddVehicleDocument, scoped),
      listVehicleDocuments: asClass(ListVehicleDocuments, scoped),
      deleteVehicleDocument: asClass(DeleteVehicleDocument, scoped),
      listExpiringDocuments: asClass(ListExpiringDocuments, scoped),
      assignCrew: asClass(AssignCrew, scoped),
      listCrew: asClass(ListCrew, scoped),
      endCrew: asClass(EndCrew, scoped),
      setRouteStops: asClass(SetRouteStops, scoped),
      getRoute: asClass(GetRoute, scoped),
      assignStudentTransport: asClass(AssignStudentTransport, scoped),
      endStudentTransport: asClass(EndStudentTransport, scoped),
      routeManifest: asClass(RouteManifest, scoped),
      startTrip: asClass(StartTrip, scoped),
      endTrip: asClass(EndTrip, scoped),
      listTrips: asClass(ListTrips, scoped),
      recordDriverPings: asClass(RecordDriverPings, scoped),
      ingestDevicePings: asClass(IngestDevicePings, scoped),
      getLiveFleet: asClass(GetLiveFleet, scoped),
      getVehicleTrack: asClass(GetVehicleTrack, scoped),
      getStudentBus: asClass(GetStudentBus, scoped),
      listAlerts: asClass(ListAlerts, scoped),
      acknowledgeAlert: asClass(AcknowledgeAlert, scoped),
    });
  }

  controllers(): BaseController[] {
    return [new TrnController(), new TrackingController()];
  }
}
