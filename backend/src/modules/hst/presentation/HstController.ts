import { z } from 'zod';
import { bed, hostel, room } from '../../../shared/infrastructure/db/schema/hst.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { crudRoutes, zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  AddBeds,
  AlertOverdueOutpasses,
  AllocateBed,
  CancelOutpass,
  CheckInAtGate,
  CheckOutAtGate,
  CreateRoom,
  DecideOutpass,
  GetOccupancy,
  GetRollCall,
  GetStudentHostel,
  ListOutpasses,
  ListResidents,
  ListVisitors,
  LogVisitorIn,
  LogVisitorOut,
  MarkRollCall,
  RequestOutpass,
  TransferBed,
  VacateBed,
} from '../application/HostelUseCases.js';

const Id = z.object({ id: zx.uuid() });
const Session = z.enum(['morning', 'night']);
const Instant = z.iso.datetime({ offset: true });

/** HST: hostels, rooms, beds, allocations, roll call, out-passes, gate, visitors. */
export class HstController extends BaseController {
  readonly basePath = '/hst';
  readonly tag = 'Hostel';

  routes(): RouteDefinition[] {
    return [
      // ---------------- structure ----------------
      ...crudRoutes({
        path: '/hostels',
        entity: 'hostel',
        table: hostel,
        orgScoped: true,
        campusScoped: true,
        permissions: { view: 'hst.hostel.view', create: 'hst.hostel.create', edit: 'hst.hostel.edit' },
        filters: { campusId: hostel.campusId, gender: hostel.gender, isActive: hostel.isActive },
        orderBy: [hostel.code],
        createSchema: z.object({
          campusId: zx.uuid().optional(),
          code: zx.code(),
          name: zx.name(),
          gender: z.enum(['boys', 'girls', 'mixed']),
          wardenStaffId: zx.uuid().optional(),
          address: z.string().max(300).optional(),
          phone: zx.phone().optional(),
        }),
        updateSchema: z.object({
          name: zx.name(),
          wardenStaffId: zx.uuid().nullable(),
          address: z.string().max(300).nullable(),
          phone: zx.phone().nullable(),
          isActive: z.boolean(),
        }),
      }),
      ...crudRoutes({
        path: '/rooms',
        entity: 'room',
        table: room,
        permissions: { view: 'hst.hostel.view', edit: 'hst.hostel.edit' },
        filters: { hostelId: room.hostelId, floor: room.floor, roomType: room.roomType },
        orderBy: [room.floor, room.code],
        updateSchema: z.object({ monthlyFeePaisa: zx.paisa(), isActive: z.boolean() }),
      }),
      defineRoute({
        method: 'post',
        path: '/hostels/:id/rooms',
        summary: 'Add a room with its beds (single 1, double 2, triple 3, quad 4; dormitory: beds required)',
        permission: 'hst.hostel.create',
        schema: {
          params: Id,
          body: z
            .object({
              code: z.string().trim().min(1).max(20),
              floor: z.number().int().min(-2).max(50).default(0),
              roomType: z.enum(['single', 'double', 'triple', 'quad', 'dormitory']),
              monthlyFeePaisa: zx.paisa().default(0),
              beds: z.number().int().min(1).max(60).optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(await this.resolve<CreateRoom>(req, 'createRoom').execute({ hostelId: params.id, ...body })),
      }),
      defineRoute({
        method: 'post',
        path: '/rooms/:id/beds',
        summary: 'Add beds to a room',
        permission: 'hst.hostel.create',
        schema: {
          params: Id,
          body: z.object({ codes: z.array(z.string().trim().min(1).max(10)).min(1).max(60) }).strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(await this.resolve<AddBeds>(req, 'addBeds').execute({ roomId: params.id, codes: body.codes })),
      }),
      ...crudRoutes({
        path: '/beds',
        entity: 'bed',
        table: bed,
        permissions: { view: 'hst.hostel.view', edit: 'hst.hostel.edit' },
        filters: { roomId: bed.roomId, isActive: bed.isActive },
        orderBy: [bed.code],
        updateSchema: z.object({ isActive: z.boolean() }),
      }),
      defineRoute({
        method: 'get',
        path: '/hostels/:id/occupancy',
        summary: 'Room / bed map: who sleeps where, free beds',
        permission: 'hst.allocation.view',
        schema: { params: Id, query: z.object({ date: zx.date().optional() }) },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<GetOccupancy>(req, 'getOccupancy').execute({ hostelId: params.id, date: query.date }),
          ),
      }),

      // ---------------- allocations ----------------
      defineRoute({
        method: 'post',
        path: '/allocations',
        summary: 'Give a student a bed (gender, campus, one bed at a time); rent + meals billed monthly via FEE',
        permission: 'hst.allocation.create',
        schema: {
          body: z
            .object({
              studentId: zx.uuid(),
              bedId: zx.uuid(),
              validFrom: zx.date().optional(),
              mealPlan: z.enum(['full', 'none']).default('full'),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<AllocateBed>(req, 'allocateBed').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/allocations/:id/transfer',
        summary: 'Move to another bed from a date',
        permission: 'hst.allocation.edit',
        schema: {
          params: Id,
          body: z
            .object({ bedId: zx.uuid(), fromDate: zx.date().optional(), mealPlan: z.enum(['full', 'none']).optional() })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<TransferBed>(req, 'transferBed').execute({ allocationId: params.id, ...body }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/allocations/:id/vacate',
        summary: 'Leave the hostel (rent and meal billing stop after the last day)',
        permission: 'hst.allocation.edit',
        successStatus: 200,
        schema: {
          params: Id,
          body: z.object({ lastDay: zx.date().optional(), reason: z.string().min(2).max(200) }).strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<VacateBed>(req, 'vacateBed').execute({ allocationId: params.id, ...body })),
      }),
      defineRoute({
        method: 'get',
        path: '/hostels/:id/residents',
        summary: 'Residents with room and bed',
        permission: 'hst.allocation.view',
        schema: { params: Id, query: z.object({ date: zx.date().optional() }) },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<ListResidents>(req, 'listResidents').execute({ hostelId: params.id, date: query.date }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/students/:id',
        summary: "A student's hostel: room, warden, out-passes, recent roll calls (guardian / student / staff)",
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetStudentHostel>(req, 'getStudentHostel').execute({ studentId: params.id })),
      }),

      // ---------------- roll call ----------------
      defineRoute({
        method: 'get',
        path: '/hostels/:id/roll-call',
        summary: 'Roll call sheet (residents out on a pass are flagged)',
        permission: 'hst.roll_call.view',
        schema: { params: Id, query: z.object({ date: zx.date(), session: Session }) },
        handler: async ({ params, query }, req) =>
          this.ok(await this.resolve<GetRollCall>(req, 'getRollCall').execute({ hostelId: params.id, ...query })),
      }),
      defineRoute({
        method: 'put',
        path: '/hostels/:id/roll-call',
        summary: 'Mark the roll call; a new "absent" texts the guardian',
        permission: 'hst.roll_call.create',
        idempotent: true,
        schema: {
          params: Id,
          query: z.object({ date: zx.date(), session: Session }),
          body: z
            .object({
              entries: z
                .array(
                  z
                    .object({
                      studentId: zx.uuid(),
                      status: z.enum(['present', 'absent', 'late', 'on_leave']),
                      note: z.string().max(200).optional(),
                    })
                    .strict(),
                )
                .min(1)
                .max(1000),
            })
            .strict(),
        },
        handler: async ({ params, query, body }, req) =>
          this.ok(
            await this.resolve<MarkRollCall>(req, 'markRollCall').execute({
              hostelId: params.id,
              ...query,
              entries: body.entries,
            }),
          ),
      }),

      // ---------------- out-passes & gate ----------------
      defineRoute({
        method: 'post',
        path: '/outpasses',
        summary: 'Request an out-pass (guardian for own child, or hostel staff)',
        schema: {
          body: z
            .object({
              studentId: zx.uuid(),
              kind: z.enum(['day_out', 'home_leave', 'medical', 'other']),
              destination: z.string().min(2).max(200),
              reason: z.string().max(300).optional(),
              escortName: z.string().max(100).optional(),
              escortPhone: zx.phone().optional(),
              outFrom: Instant,
              returnBy: Instant,
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<RequestOutpass>(req, 'requestOutpass').execute(body)),
      }),
      defineRoute({
        method: 'get',
        path: '/outpasses',
        summary: 'Out-passes (staff: any; guardian: studentId of own child)',
        schema: {
          query: z.object({
            hostelId: zx.uuid().optional(),
            studentId: zx.uuid().optional(),
            status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'out', 'returned']).optional(),
            limit: z.coerce.number().int().min(1).max(500).default(100),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListOutpasses>(req, 'listOutpasses').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/outpasses/:id/decide',
        summary: 'Warden approves or rejects (guardian is told)',
        permission: 'hst.outpass.approve',
        successStatus: 200,
        schema: {
          params: Id,
          body: z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(300).optional() }).strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<DecideOutpass>(req, 'decideOutpass').execute({ id: params.id, ...body })),
      }),
      defineRoute({
        method: 'post',
        path: '/outpasses/:id/cancel',
        summary: 'Cancel a pending / approved out-pass (requester or warden)',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<CancelOutpass>(req, 'cancelOutpass').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/outpasses/:id/check-out',
        summary: 'Gate: student leaves on an approved pass (guardian texted)',
        permission: 'hst.gate.create',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<CheckOutAtGate>(req, 'checkOutAtGate').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/outpasses/:id/check-in',
        summary: 'Gate: student is back (minutes late recorded; guardian texted)',
        permission: 'hst.gate.create',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<CheckInAtGate>(req, 'checkInAtGate').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/tasks/overdue-outpasses',
        summary: 'Alert guardians / wardens of students not back in time (also every 10 minutes)',
        permission: 'hst.outpass.approve',
        successStatus: 200,
        handler: async (_i, req) =>
          this.ok(await this.resolve<AlertOverdueOutpasses>(req, 'alertOverdueOutpasses').execute({})),
      }),

      // ---------------- visitors ----------------
      defineRoute({
        method: 'post',
        path: '/visitors',
        summary: 'Sign a visitor in (flags whether the phone is the primary guardian)',
        permission: 'hst.gate.create',
        schema: {
          body: z
            .object({
              studentId: zx.uuid(),
              visitorName: zx.name(),
              relation: z.string().min(2).max(50),
              phone: zx.phone().optional(),
              idDocNo: z.string().max(40).optional(),
              purpose: z.string().max(200).optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<LogVisitorIn>(req, 'logVisitorIn').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/visitors/:id/out',
        summary: 'Sign a visitor out',
        permission: 'hst.gate.create',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<LogVisitorOut>(req, 'logVisitorOut').execute(params)),
      }),
      defineRoute({
        method: 'get',
        path: '/visitors',
        summary: 'Visitor log',
        permission: 'hst.gate.view',
        schema: {
          query: z.object({
            hostelId: zx.uuid().optional(),
            studentId: zx.uuid().optional(),
            date: zx.date().optional(),
            limit: z.coerce.number().int().min(1).max(500).default(100),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListVisitors>(req, 'listVisitors').execute(query)),
      }),
    ];
  }
}
