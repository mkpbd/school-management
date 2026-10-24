import { z } from 'zod';
import { route, stop, vehicle } from '../../../shared/infrastructure/db/schema/trn.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { crudRoutes, zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
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
} from '../application/FleetUseCases.js';

const Id = z.object({ id: zx.uuid() });
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const vehicleFields = {
  regNo: z.string().trim().min(3).max(40),
  kind: z.enum(['bus', 'minibus', 'microbus', 'van', 'car']),
  capacity: z.number().int().min(1).max(120),
  ownership: z.enum(['own', 'leased', 'contracted']).default('own'),
};

/** TRN fleet: vehicles, documents, crew, routes, stops, student assignment, trips (TRN-01, TRN-02). */
export class TrnController extends BaseController {
  readonly basePath = '/trn';
  readonly tag = 'Transport';

  routes(): RouteDefinition[] {
    return [
      // ---------------- vehicles ----------------
      ...crudRoutes({
        path: '/vehicles',
        entity: 'vehicle',
        table: vehicle,
        orgScoped: true,
        campusScoped: true,
        omit: ['gpsDeviceKeyHash'],
        permissions: { view: 'trn.vehicle.view', create: 'trn.vehicle.create', edit: 'trn.vehicle.edit' },
        filters: { campusId: vehicle.campusId, kind: vehicle.kind, isActive: vehicle.isActive },
        search: [vehicle.regNo],
        orderBy: [vehicle.regNo],
        createSchema: z.object({ campusId: zx.uuid().optional(), ...vehicleFields }),
        updateSchema: z.object({ ...vehicleFields, isActive: z.boolean() }),
      }),
      defineRoute({
        method: 'post',
        path: '/vehicles/:id/device-key',
        summary: 'Link a GPS tracker (device id) and issue its key; the key is shown only once',
        permission: 'trn.vehicle.edit',
        successStatus: 200,
        schema: {
          params: Id,
          body: z
            .object({
              deviceId: z
                .string()
                .trim()
                .min(3)
                .max(64)
                .regex(/^[\w.:-]+$/),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<IssueDeviceKey>(req, 'issueDeviceKey').execute({
              vehicleId: params.id,
              deviceId: body.deviceId,
            }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/vehicles/:id/documents',
        summary: 'Fitness, insurance, tax token, route permit, registration',
        permission: 'trn.vehicle.view',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(
            await this.resolve<ListVehicleDocuments>(req, 'listVehicleDocuments').execute({ vehicleId: params.id }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/vehicles/:id/documents',
        summary: 'Add a vehicle document with its expiry date',
        permission: 'trn.vehicle.edit',
        schema: {
          params: Id,
          body: z
            .object({
              docType: z.enum(['fitness', 'insurance', 'tax_token', 'route_permit', 'registration']),
              docNo: z.string().max(60).optional(),
              expiresOn: zx.date(),
              fileId: zx.uuid().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<AddVehicleDocument>(req, 'addVehicleDocument').execute({
              vehicleId: params.id,
              ...body,
            }),
          ),
      }),
      defineRoute({
        method: 'delete',
        path: '/vehicle-documents/:id',
        summary: 'Remove a vehicle document',
        permission: 'trn.vehicle.edit',
        schema: { params: Id },
        handler: async ({ params }, req) => {
          await this.resolve<DeleteVehicleDocument>(req, 'deleteVehicleDocument').execute(params);
          return this.noContent();
        },
      }),
      defineRoute({
        method: 'get',
        path: '/vehicle-documents/expiring',
        summary: 'Documents expiring within N days (negative daysLeft = already expired)',
        permission: 'trn.vehicle.view',
        schema: {
          query: z.object({
            withinDays: z.coerce.number().int().min(0).max(365).default(30),
            campusId: zx.uuid().optional(),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListExpiringDocuments>(req, 'listExpiringDocuments').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/vehicles/:id/crew',
        summary: "Today's driver / helper / attendant",
        permission: 'trn.vehicle.view',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<ListCrew>(req, 'listCrew').execute({ vehicleId: params.id })),
      }),
      defineRoute({
        method: 'post',
        path: '/vehicles/:id/crew',
        summary: 'Assign a staff member as driver (licence required), helper or attendant',
        permission: 'trn.vehicle.edit',
        schema: {
          params: Id,
          body: z
            .object({
              staffId: zx.uuid(),
              role: z.enum(['driver', 'helper', 'attendant']),
              validFrom: zx.date().optional(),
              licenceNo: z.string().max(40).optional(),
              licenceExpiresOn: zx.date().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(await this.resolve<AssignCrew>(req, 'assignCrew').execute({ vehicleId: params.id, ...body })),
      }),
      defineRoute({
        method: 'post',
        path: '/crew/:id/end',
        summary: 'End a crew assignment',
        permission: 'trn.vehicle.edit',
        schema: { params: Id, body: z.object({ validTo: zx.date().optional() }).strict() },
        handler: async ({ params, body }, req) => {
          await this.resolve<EndCrew>(req, 'endCrew').execute({ id: params.id, ...body });
          return this.noContent();
        },
      }),

      // ---------------- routes & stops ----------------
      ...crudRoutes({
        path: '/stops',
        entity: 'stop',
        table: stop,
        orgScoped: true,
        permissions: { view: 'trn.route.view', create: 'trn.route.create', edit: 'trn.route.edit' },
        filters: { feeZone: stop.feeZone, area: stop.area },
        search: [stop.name, stop.area],
        orderBy: [stop.name],
        createSchema: z.object({
          name: z.string().min(2).max(100),
          area: z.string().max(100).optional(),
          lat: z.number().min(-90).max(90).transform(String),
          lng: z.number().min(-180).max(180).transform(String),
          feeZone: z.string().max(20).optional(),
        }),
        updateSchema: z.object({
          name: z.string().min(2).max(100),
          area: z.string().max(100).nullable(),
          lat: z.number().min(-90).max(90).transform(String),
          lng: z.number().min(-180).max(180).transform(String),
          feeZone: z.string().max(20).nullable(),
        }),
      }),
      ...crudRoutes({
        path: '/routes',
        entity: 'route',
        table: route,
        orgScoped: true,
        campusScoped: true,
        permissions: { view: 'trn.route.view', create: 'trn.route.create', edit: 'trn.route.edit' },
        filters: { campusId: route.campusId, vehicleId: route.vehicleId, isActive: route.isActive },
        search: [route.code, route.name],
        orderBy: [route.code],
        createSchema: z.object({
          campusId: zx.uuid().optional(),
          code: zx.code(),
          name: z.string().min(2).max(100),
          shiftId: zx.uuid().optional(),
          vehicleId: zx.uuid().optional(),
        }),
        updateSchema: z.object({
          name: z.string().min(2).max(100),
          shiftId: zx.uuid().nullable(),
          vehicleId: zx.uuid().nullable(),
          isActive: z.boolean(),
        }),
      }).filter((r) => !(r.method === 'get' && r.path === '/routes/:id')),
      defineRoute({
        method: 'get',
        path: '/routes/:id',
        summary: 'Route with ordered stops, vehicle and number of students',
        permission: 'trn.route.view',
        schema: { params: Id },
        handler: async ({ params }, req) => this.ok(await this.resolve<GetRoute>(req, 'getRoute').execute(params)),
      }),
      defineRoute({
        method: 'put',
        path: '/routes/:id/stops',
        summary: 'Replace the stops of a route, in pickup order (drop runs in reverse)',
        permission: 'trn.route.edit',
        schema: {
          params: Id,
          body: z
            .object({
              stops: z
                .array(z.object({ stopId: zx.uuid(), pickupTime: Time.optional(), dropTime: Time.optional() }).strict())
                .max(60),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SetRouteStops>(req, 'setRouteStops').execute({ routeId: params.id, stops: body.stops }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/routes/:id/manifest',
        summary: 'Students on the route with their pickup / drop stops',
        permission: 'trn.assignment.view',
        schema: { params: Id, query: z.object({ date: zx.date().optional() }) },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<RouteManifest>(req, 'routeManifest').execute({ routeId: params.id, date: query.date }),
          ),
      }),

      // ---------------- student assignment ----------------
      defineRoute({
        method: 'post',
        path: '/assignments',
        summary: 'Put a student on a route (seat limit = vehicle capacity)',
        permission: 'trn.assignment.create',
        schema: {
          body: z
            .object({
              studentId: zx.uuid(),
              routeId: zx.uuid(),
              pickupStopId: zx.uuid(),
              dropStopId: zx.uuid().optional(),
              direction: z.enum(['both', 'pickup_only', 'drop_only']).default('both'),
              validFrom: zx.date().optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<AssignStudentTransport>(req, 'assignStudentTransport').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/assignments/:id/end',
        summary: 'End a student transport assignment',
        permission: 'trn.assignment.edit',
        successStatus: 200,
        schema: { params: Id, body: z.object({ validTo: zx.date().optional() }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<EndStudentTransport>(req, 'endStudentTransport').execute({ id: params.id, ...body }),
          ),
      }),

      // ---------------- trips ----------------
      defineRoute({
        method: 'post',
        path: '/trips/start',
        summary: "Driver starts today's pickup / drop run (resumes if already started)",
        permission: 'trn.trip.create',
        successStatus: 200,
        schema: {
          body: z
            .object({ routeId: zx.uuid(), direction: z.enum(['pickup', 'drop']), vehicleId: zx.uuid().optional() })
            .strict(),
        },
        handler: async ({ body }, req) => this.ok(await this.resolve<StartTrip>(req, 'startTrip').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/trips/:id/end',
        summary: 'Driver ends the run',
        permission: 'trn.trip.create',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) => this.ok(await this.resolve<EndTrip>(req, 'endTrip').execute(params)),
      }),
      defineRoute({
        method: 'get',
        path: '/trips',
        summary: 'Trips of a day',
        permission: 'trn.trip.view',
        schema: {
          query: z.object({
            date: zx.date().optional(),
            campusId: zx.uuid().optional(),
            routeId: zx.uuid().optional(),
          }),
        },
        handler: async ({ query }, req) => this.ok(await this.resolve<ListTrips>(req, 'listTrips').execute(query)),
      }),
    ];
  }
}
