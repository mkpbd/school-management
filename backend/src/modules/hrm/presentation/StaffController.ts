import { z } from 'zod';
import { department, designation } from '../../../shared/infrastructure/db/schema/hrm.js';
import { BaseController, ifMatchVersion } from '../../../shared/http/BaseController.js';
import { crudRoutes, zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  CreateStaff,
  CreateStaffAccount,
  GetStaff,
  SearchStaff,
  UpdateStaff,
} from '../application/StaffUseCases.js';

const StaffBody = z.object({
  campusId: zx.uuid().optional(),
  staffNo: zx.code(),
  fullNameEn: zx.name(),
  fullNameBn: z.string().max(200).optional(),
  gender: z.enum(['male', 'female']),
  dateOfBirth: zx.date().optional(),
  nid: z.string().min(10).max(17).optional(),
  phone: zx.phone(),
  email: z.string().email().optional(),
  staffType: z.enum(['teaching', 'non_teaching', 'admin', 'support']),
  departmentId: zx.uuid().optional(),
  designationId: zx.uuid().optional(),
  reportingToId: zx.uuid().optional(),
  joinedOn: zx.date(),
  status: z.enum(['onboarding', 'probation', 'active']).optional(),
});

/** HRM-01 staff master + departments/designations (HRM-lite; payroll arrives with the HRM feature batch). */
export class StaffController extends BaseController {
  readonly basePath = '/hrm';
  readonly tag = 'HRM · Staff';

  routes(): RouteDefinition[] {
    return [
      defineRoute({
        method: 'get',
        path: '/staff',
        summary: 'Search staff (name/staff no/phone, exact NID via blind index)',
        permission: 'hrm.staff.view',
        schema: {
          query: z.object({
            campusId: zx.uuid().optional(),
            q: z.string().max(100).optional(),
            staffType: z.enum(['teaching', 'non_teaching', 'admin', 'support']).optional(),
            status: z.string().max(20).optional(),
            nid: z.string().max(17).optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            cursor: z.string().optional(),
          }),
        },
        handler: async ({ query }, req) =>
          this.page(await this.resolve<SearchStaff>(req, 'searchStaff').execute(query)),
      }),
      defineRoute({
        method: 'post',
        path: '/staff',
        summary: 'Create a staff member',
        permission: 'hrm.staff.create',
        schema: { body: StaffBody.strict() },
        handler: async ({ body }, req) => {
          const s = await this.resolve<CreateStaff>(req, 'createStaff').execute(body);
          return this.withEtag(this.created(s, `/api/v1/hrm/staff/${s.id}`), s.rowVersion);
        },
      }),
      defineRoute({
        method: 'get',
        path: '/staff/:id',
        summary: 'Get a staff member',
        permission: 'hrm.staff.view',
        schema: { params: z.object({ id: zx.uuid() }) },
        handler: async ({ params }, req) => {
          const s = await this.resolve<GetStaff>(req, 'getStaff').execute(params);
          return this.withEtag(this.ok(s), s.rowVersion);
        },
      }),
      defineRoute({
        method: 'patch',
        path: '/staff/:id',
        summary: 'Update a staff member (If-Match: "<rowVersion>")',
        permission: 'hrm.staff.edit',
        schema: {
          params: z.object({ id: zx.uuid() }),
          body: StaffBody.omit({ campusId: true, staffNo: true })
            .extend({
              leftOn: zx.date().nullable(),
              status: z.enum(['onboarding', 'probation', 'active', 'on_leave', 'resigned', 'terminated', 'retired']),
            })
            .partial()
            .strict(),
        },
        handler: async ({ params, body }, req) => {
          const s = await this.resolve<UpdateStaff>(req, 'updateStaff').execute({
            id: params.id,
            patch: body,
            expectedVersion: ifMatchVersion(req),
          });
          return this.withEtag(this.ok(s), s.rowVersion);
        },
      }),
      defineRoute({
        method: 'post',
        path: '/staff/:id/account',
        summary: 'Create the staff login with a role (campus-scoped unless campusId is null)',
        permission: 'iam.user.create',
        schema: {
          params: z.object({ id: zx.uuid() }),
          body: z
            .object({
              username: z.string().regex(/^[a-z0-9._-]{3,50}$/),
              password: z.string().min(10).max(128),
              roleCode: z.string().regex(/^[A-Z_]{2,40}$/),
              campusId: zx.uuid().nullable().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<CreateStaffAccount>(req, 'createStaffAccount').execute({ staffId: params.id, ...body }),
          ),
      }),
      ...crudRoutes({
        path: '/departments',
        entity: 'department',
        table: department,
        orgScoped: true,
        permissions: { view: 'hrm.staff.view', create: 'hrm.staff.create', edit: 'hrm.staff.edit' },
        createSchema: z.object({ code: zx.code(), nameEn: zx.name(), headStaffId: zx.uuid().optional() }),
        updateSchema: z.object({ nameEn: zx.name(), headStaffId: zx.uuid().nullable() }),
      }),
      ...crudRoutes({
        path: '/designations',
        entity: 'designation',
        table: designation,
        orgScoped: true,
        permissions: { view: 'hrm.staff.view', create: 'hrm.staff.create', edit: 'hrm.staff.edit' },
        createSchema: z.object({
          code: zx.code(),
          nameEn: zx.name(),
          nameBn: z.string().optional(),
          grade: z.string().max(20).optional(),
        }),
        updateSchema: z.object({
          nameEn: zx.name(),
          nameBn: z.string().nullable(),
          grade: z.string().max(20).nullable(),
        }),
      }),
    ];
  }
}
