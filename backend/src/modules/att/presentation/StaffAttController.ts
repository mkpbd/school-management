import { z } from 'zod';
import { BaseController } from '../../../shared/http/BaseController.js';
import { zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  ApplyStaffLeave,
  CancelStaffLeave,
  DecideStaffLeave,
  GetLeaveBalances,
  GetStaffDailySheet,
  GetStaffMonth,
  ListLeaveTypes,
  ListStaffLeaves,
  MarkStaffDaily,
  StaffCheckIn,
  StaffCheckOut,
} from '../application/StaffAttendanceUseCases.js';

const Id = z.object({ id: zx.uuid() });
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
const Location = z
  .object({ lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() })
  .strict();
const StaffStatus = z.enum(['present', 'absent', 'late', 'leave', 'half_day', 'holiday', 'weekly_off', 'on_duty']);

/** Staff attendance (register, check-in / out) and leave with balances; feeds payroll (HRM-04). */
export class StaffAttController extends BaseController {
  readonly basePath = '/att';
  readonly tag = 'Attendance · Staff';

  routes(): RouteDefinition[] {
    return [
      // ---------------- leave ----------------
      defineRoute({
        method: 'get',
        path: '/staff-leave-types',
        summary: 'Leave types (quota, carry-forward, paid / unpaid)',
        handler: async (_i, req) => this.ok(await this.resolve<ListLeaveTypes>(req, 'listLeaveTypes').execute({})),
      }),
      defineRoute({
        method: 'get',
        path: '/staff-leave-balances',
        summary: 'Leave balances of a year (own, or staffId with att.staff_leave.view)',
        schema: {
          query: z.object({
            staffId: zx.uuid().optional(),
            year: z.coerce.number().int().min(2000).max(2100),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<GetLeaveBalances>(req, 'getLeaveBalances').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/staff-leaves',
        summary: 'Apply for leave (own; HR may apply for others); days counted on school days',
        idempotent: true,
        schema: {
          body: z
            .object({
              staffId: zx.uuid().optional(),
              leaveTypeId: zx.uuid(),
              fromDate: zx.date(),
              toDate: zx.date(),
              halfDay: z.boolean().optional(),
              reason: z.string().max(500).optional(),
              attachmentFileId: zx.uuid().optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<ApplyStaffLeave>(req, 'applyStaffLeave').execute(body)),
      }),
      defineRoute({
        method: 'get',
        path: '/staff-leaves',
        summary: 'Leave requests (own, or all with att.staff_leave.view)',
        schema: {
          query: z.object({
            staffId: zx.uuid().optional(),
            campusId: zx.uuid().optional(),
            status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
            from: zx.date().optional(),
            to: zx.date().optional(),
            limit: z.coerce.number().int().min(1).max(500).default(100),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListStaffLeaves>(req, 'listStaffLeaves').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/staff-leaves/:id/decide',
        summary: 'Approve (marks attendance "leave") or reject; never your own',
        permission: 'att.staff_leave.approve',
        successStatus: 200,
        schema: {
          params: Id,
          body: z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(300).optional() }).strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<DecideStaffLeave>(req, 'decideStaffLeave').execute({ id: params.id, ...body })),
      }),
      defineRoute({
        method: 'post',
        path: '/staff-leaves/:id/cancel',
        summary: 'Cancel (applicant before the leave starts, or the approver); days are returned',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<CancelStaffLeave>(req, 'cancelStaffLeave').execute(params)),
      }),

      // ---------------- daily attendance ----------------
      defineRoute({
        method: 'get',
        path: '/staff-daily',
        summary: 'Staff register of a campus and date',
        permission: 'att.staff.view',
        schema: { query: z.object({ campusId: zx.uuid().optional(), date: zx.date() }) },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<GetStaffDailySheet>(req, 'getStaffDailySheet').execute(query)),
      }),
      defineRoute({
        method: 'put',
        path: '/staff-daily',
        summary: 'Mark the staff register (late / early / overtime computed from times)',
        permission: 'att.staff.edit',
        idempotent: true,
        schema: {
          query: z.object({ campusId: zx.uuid().optional(), date: zx.date() }),
          body: z
            .object({
              entries: z
                .array(
                  z
                    .object({
                      staffId: zx.uuid(),
                      status: StaffStatus,
                      checkInAt: z.iso.datetime({ offset: true }).optional(),
                      checkOutAt: z.iso.datetime({ offset: true }).optional(),
                      overtimeMinutes: z.number().int().min(0).max(1440).optional(),
                    })
                    .strict(),
                )
                .min(1)
                .max(1000),
            })
            .strict(),
        },
        handler: async ({ query, body }, req) =>
          this.ok(
            await this.resolve<MarkStaffDaily>(req, 'markStaffDaily').execute({ ...query, entries: body.entries }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/staff/me/check-in',
        summary: 'Check in from the staff app (location checked against the campus geofence when set)',
        successStatus: 200,
        schema: { body: Location },
        handler: async ({ body }, req) => this.ok(await this.resolve<StaffCheckIn>(req, 'staffCheckIn').execute(body)),
      }),
      defineRoute({
        method: 'post',
        path: '/staff/me/check-out',
        summary: 'Check out (overtime / early leave computed)',
        successStatus: 200,
        schema: { body: Location },
        handler: async ({ body }, req) =>
          this.ok(await this.resolve<StaffCheckOut>(req, 'staffCheckOut').execute(body)),
      }),
      defineRoute({
        method: 'get',
        path: '/staff-month',
        summary: 'Month of a staff member: days and payroll summary (unpaid days, overtime)',
        schema: { query: z.object({ staffId: zx.uuid().optional(), month: Month }) },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<GetStaffMonth>(req, 'getStaffMonth').execute(query)),
      }),
    ];
  }
}
