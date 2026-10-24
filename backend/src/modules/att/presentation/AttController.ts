import { z } from 'zod';
import { BaseController } from '../../../shared/http/BaseController.js';
import { zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  ApplyStudentLeave,
  DecideStudentLeave,
  GetRegisterSheet,
  GetStudentAttendanceSummary,
  ListStudentLeaves,
  MarkDailyAttendance,
} from '../application/AttendanceUseCases.js';
import type {
  CancelAttendanceCorrection,
  DecideAttendanceCorrection,
  GetMarkHistory,
  GetMyRegisters,
  GetPeriodRegister,
  GetSectionDay,
  ListAttendanceCorrections,
  MarkPeriodAttendance,
  RequestAttendanceCorrection,
} from '../application/PeriodAttendanceUseCases.js';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
const Id = z.object({ id: zx.uuid() });
const Status = z.enum(['present', 'absent', 'late', 'leave', 'half_day', 'excused']);
const PeriodStatus = z.enum(['present', 'absent', 'late', 'excused']);
const DateQuery = z.object({ date: zx.date().optional() });
const GroupPeriod = z.object({ id: zx.uuid(), periodId: zx.uuid() });

/** ATT: daily and period-wise registers, corrections with audit, summaries, student leave (ATT-01, 03, 04, 05). */
export class AttController extends BaseController {
  readonly basePath = '/att';
  readonly tag = 'Attendance';

  routes(): RouteDefinition[] {
    return [
      defineRoute({
        method: 'get',
        path: '/sections/:id/daily',
        summary: 'Register sheet for a section and date (pre-filled with approved leave)',
        permission: 'att.daily.view',
        schema: { params: Id, query: z.object({ date: zx.date().optional() }) },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<GetRegisterSheet>(req, 'getRegisterSheet').execute({
              sectionId: params.id,
              date: query.date ?? today(),
            }),
          ),
      }),
      defineRoute({
        method: 'put',
        path: '/sections/:id/daily',
        summary:
          'Mark the section; with markRest only exceptions are sent and the rest are present (absent/late alert the guardian)',
        permission: 'att.daily.edit',
        idempotent: true,
        successStatus: 200,
        schema: {
          params: Id,
          query: z.object({ date: zx.date().optional() }),
          body: z
            .object({
              entries: z
                .array(
                  z
                    .object({
                      studentId: zx.uuid(),
                      status: Status,
                      arrivedAt: z.string().datetime({ offset: true }).optional(),
                      remarks: z.string().max(200).optional(),
                    })
                    .strict(),
                )
                .max(120)
                .default([]),
              markRest: z.boolean().default(false),
            })
            .strict(),
        },
        handler: async ({ params, query, body }, req) =>
          this.ok(
            await this.resolve<MarkDailyAttendance>(req, 'markDailyAttendance').execute({
              sectionId: params.id,
              date: query.date ?? today(),
              entries: body.entries,
              markRest: body.markRest,
            }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/sections/:id/day',
        summary: 'Class teacher view of a day: daily mark and every lesson mark per student, missed lessons counted',
        permission: 'att.daily.view',
        schema: { params: Id, query: DateQuery },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<GetSectionDay>(req, 'getSectionDay').execute({
              sectionId: params.id,
              date: query.date ?? today(),
            }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/my-registers',
        summary: "Teacher's day: registration classes and the lessons to mark (with progress and edit window)",
        schema: { query: DateQuery },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<GetMyRegisters>(req, 'getMyRegisters').execute({ date: query.date ?? today() })),
      }),
      defineRoute({
        method: 'get',
        path: '/teaching-groups/:id/periods/:periodId',
        summary: 'Period register of a lesson (timetabled or cover teacher), pre-filled from the daily register',
        permission: 'att.period.view',
        schema: { params: GroupPeriod, query: DateQuery },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<GetPeriodRegister>(req, 'getPeriodRegister').execute({
              groupId: params.id,
              periodId: params.periodId,
              date: query.date ?? today(),
            }),
          ),
      }),
      defineRoute({
        method: 'put',
        path: '/teaching-groups/:id/periods/:periodId',
        summary:
          'Mark a lesson (senior years); with markRest only exceptions are sent. Absent from a lesson while at school alerts the guardian',
        permission: 'att.period.edit',
        idempotent: true,
        successStatus: 200,
        schema: {
          params: GroupPeriod,
          query: DateQuery,
          body: z
            .object({
              entries: z
                .array(z.object({ studentId: zx.uuid(), status: PeriodStatus }).strict())
                .max(120)
                .default([]),
              markRest: z.boolean().default(false),
            })
            .strict(),
        },
        handler: async ({ params, query, body }, req) =>
          this.ok(
            await this.resolve<MarkPeriodAttendance>(req, 'markPeriodAttendance').execute({
              groupId: params.id,
              periodId: params.periodId,
              date: query.date ?? today(),
              entries: body.entries,
              markRest: body.markRest,
            }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/corrections',
        summary: 'Ask to change a daily or lesson mark after the edit window (applied when someone else approves)',
        permission: 'att.correction.create',
        schema: {
          body: z
            .object({
              kind: z.enum(['daily', 'period']),
              studentId: zx.uuid(),
              date: zx.date(),
              periodDefinitionId: zx.uuid().optional(),
              newStatus: Status,
              reason: z.string().trim().min(5).max(500),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(
            await this.resolve<RequestAttendanceCorrection>(req, 'requestAttendanceCorrection').execute(body),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/corrections',
        summary: 'Correction queue (approvers) or own requests',
        schema: {
          query: z.object({
            status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
            studentId: zx.uuid().optional(),
            date: zx.date().optional(),
            mine: z
              .enum(['true', 'false'])
              .transform((v) => v === 'true')
              .optional(),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListAttendanceCorrections>(req, 'listAttendanceCorrections').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/corrections/:id/decide',
        summary: 'Approve (applies the change, audited) or reject; never by the requester',
        permission: 'att.correction.approve',
        successStatus: 200,
        schema: {
          params: Id,
          body: z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(500).optional() }).strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<DecideAttendanceCorrection>(req, 'decideAttendanceCorrection').execute({
              id: params.id,
              ...body,
            }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/corrections/:id/cancel',
        summary: 'Withdraw own pending correction',
        successStatus: 200,
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<CancelAttendanceCorrection>(req, 'cancelAttendanceCorrection').execute(params)),
      }),
      defineRoute({
        method: 'get',
        path: '/students/:id/history',
        summary: "Audit trail of a student's marks on a date (who changed what, when) with corrections",
        schema: { params: Id, query: z.object({ date: zx.date() }) },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<GetMarkHistory>(req, 'getMarkHistory').execute({
              studentId: params.id,
              date: query.date,
            }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/students/:id/summary',
        summary: 'Attendance % for a student (default: academic year to date)',
        schema: { params: Id, query: z.object({ from: zx.date().optional(), to: zx.date().optional() }) },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<GetStudentAttendanceSummary>(req, 'getStudentAttendanceSummary').execute({
              studentId: params.id,
              ...query,
            }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/student-leaves',
        summary: 'Apply for student leave (guardians: own children)',
        permission: 'att.student_leave.create',
        schema: {
          body: z
            .object({
              studentId: zx.uuid(),
              fromDate: zx.date(),
              toDate: zx.date(),
              reasonCode: z.string().min(2).max(30),
              reasonNote: z.string().max(500).optional(),
              attachmentFileId: zx.uuid().optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) =>
          this.created(await this.resolve<ApplyStudentLeave>(req, 'applyStudentLeave').execute(body)),
      }),
      defineRoute({
        method: 'get',
        path: '/student-leaves',
        summary: 'List leave requests (guardians see their children)',
        schema: {
          query: z.object({
            studentId: zx.uuid().optional(),
            status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
          }),
        },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<ListStudentLeaves>(req, 'listStudentLeaves').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/student-leaves/:id/decide',
        summary: 'Approve or reject (approval marks the school days as leave)',
        permission: 'att.student_leave.approve',
        successStatus: 200,
        schema: { params: Id, body: z.object({ decision: z.enum(['approved', 'rejected']) }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<DecideStudentLeave>(req, 'decideStudentLeave').execute({
              leaveId: params.id,
              decision: body.decision,
            }),
          ),
      }),
    ];
  }
}
