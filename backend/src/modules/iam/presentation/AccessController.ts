import { z } from 'zod';
import { BaseController } from '../../../shared/http/BaseController.js';
import { zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  AssignRole,
  CheckAccess,
  CreateRole,
  DeleteRole,
  GetRole,
  GetUserAccess,
  ListPermissions,
  ListRoles,
  ListUsers,
  RevokeAssignment,
  RoleMatrix,
  SetRolePermissions,
  SetUserStatus,
  UpdateRole,
} from '../application/AccessControlUseCases.js';

const Id = z.object({ id: zx.uuid() });
const Scope = z.enum(['org', 'campus', 'section', 'own_classes', 'own_subjects', 'own_children', 'self']);
const PermissionCode = z.string().regex(/^[a-z]+\.[a-z_]+\.(view|create|edit|approve|export|delete)$/);

/** Role-based access control administration: roles, permission matrix (module x action x scope), assignments per campus. */
export class AccessController extends BaseController {
  readonly basePath = '/iam';
  readonly tag = 'Access control';

  routes(): RouteDefinition[] {
    return [
      defineRoute({
        method: 'get',
        path: '/permissions',
        summary:
          'Permission catalogue grouped by module and resource (actions: view/create/edit/approve/export/delete)',
        permission: 'iam.role.view',
        handler: async (_i, req) => this.ok(await this.resolve<ListPermissions>(req, 'listPermissions').execute({})),
      }),
      defineRoute({
        method: 'get',
        path: '/roles',
        summary: 'Roles with number of permissions and users',
        permission: 'iam.role.view',
        handler: async (_i, req) => this.ok(await this.resolve<ListRoles>(req, 'listRoles').execute({})),
      }),
      defineRoute({
        method: 'get',
        path: '/role-matrix',
        summary: 'Roles x permissions grid with the data scope of every grant (optionally one module)',
        permission: 'iam.role.view',
        schema: {
          query: z.object({
            module: z
              .string()
              .regex(/^[a-z]+$/)
              .optional(),
          }),
        },
        handler: async ({ query }, req) => this.ok(await this.resolve<RoleMatrix>(req, 'roleMatrix').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/roles/:id',
        summary: 'Role with its permissions',
        permission: 'iam.role.view',
        schema: { params: Id },
        handler: async ({ params }, req) => this.ok(await this.resolve<GetRole>(req, 'getRole').execute(params)),
      }),
      defineRoute({
        method: 'post',
        path: '/roles',
        summary: 'Create a custom role (optionally copying the permissions of another)',
        permission: 'iam.role.create',
        schema: {
          body: z
            .object({
              code: z.string().max(40),
              nameEn: zx.name(),
              nameBn: z.string().max(200).optional(),
              requiresMfa: z.boolean().optional(),
              copyFromRoleId: zx.uuid().optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) => this.created(await this.resolve<CreateRole>(req, 'createRole').execute(body)),
      }),
      defineRoute({
        method: 'patch',
        path: '/roles/:id',
        summary: 'Rename a role or require MFA for it',
        permission: 'iam.role.edit',
        schema: {
          params: Id,
          body: z
            .object({
              nameEn: zx.name().optional(),
              nameBn: z.string().max(200).nullable().optional(),
              requiresMfa: z.boolean().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(await this.resolve<UpdateRole>(req, 'updateRole').execute({ id: params.id, ...body })),
      }),
      defineRoute({
        method: 'put',
        path: '/roles/:id/permissions',
        summary:
          'Replace the permissions of a role (each with a data scope); holders get the change on their next request',
        permission: 'iam.role.edit',
        schema: {
          params: Id,
          body: z
            .object({ permissions: z.array(z.object({ code: PermissionCode, scope: Scope }).strict()).max(500) })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SetRolePermissions>(req, 'setRolePermissions').execute({
              id: params.id,
              permissions: body.permissions,
            }),
          ),
      }),
      defineRoute({
        method: 'delete',
        path: '/roles/:id',
        summary: 'Delete a custom role nobody holds',
        permission: 'iam.role.delete',
        schema: { params: Id },
        handler: async ({ params }, req) => {
          await this.resolve<DeleteRole>(req, 'deleteRole').execute(params);
          return this.noContent();
        },
      }),

      // ---------------- users ----------------
      defineRoute({
        method: 'get',
        path: '/users',
        summary: 'Accounts with their roles (search by username / e-mail / phone)',
        permission: 'iam.user.view',
        schema: {
          query: z.object({
            q: z.string().max(100).optional(),
            userType: z.enum(['staff', 'guardian', 'student']).optional(),
            roleId: zx.uuid().optional(),
            campusId: zx.uuid().optional(),
            status: z.enum(['invited', 'active', 'locked', 'disabled']).optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            offset: z.coerce.number().int().min(0).default(0),
          }),
        },
        handler: async ({ query }, req) => this.ok(await this.resolve<ListUsers>(req, 'listUsers').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/users/:id/access',
        summary: 'Role assignments and effective permissions of an account',
        permission: 'iam.user.view',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetUserAccess>(req, 'getUserAccess').execute({ userId: params.id })),
      }),
      defineRoute({
        method: 'get',
        path: '/users/:id/check',
        summary: 'Can this account do X (on this campus)? Answers with the roles that grant it',
        permission: 'iam.user.view',
        schema: { params: Id, query: z.object({ permission: PermissionCode, campusId: zx.uuid().optional() }) },
        handler: async ({ params, query }, req) =>
          this.ok(await this.resolve<CheckAccess>(req, 'checkAccess').execute({ userId: params.id, ...query })),
      }),
      defineRoute({
        method: 'post',
        path: '/users/:id/roles',
        summary: 'Assign a role, organisation-wide (campusId null) or for one campus, optionally time-limited',
        permission: 'iam.user.edit',
        schema: {
          params: Id,
          body: z
            .object({
              roleId: zx.uuid(),
              campusId: zx.uuid().nullable().optional(),
              validFrom: zx.date().optional(),
              validTo: zx.date().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(await this.resolve<AssignRole>(req, 'assignRoleToUser').execute({ userId: params.id, ...body })),
      }),
      defineRoute({
        method: 'delete',
        path: '/role-assignments/:id',
        summary: 'Revoke a role assignment',
        permission: 'iam.user.edit',
        schema: { params: Id },
        handler: async ({ params }, req) => {
          await this.resolve<RevokeAssignment>(req, 'revokeAssignment').execute(params);
          return this.noContent();
        },
      }),
      defineRoute({
        method: 'post',
        path: '/users/:id/status',
        summary: 'Disable or re-enable an account (takes effect on its next request)',
        permission: 'iam.user.edit',
        successStatus: 200,
        schema: { params: Id, body: z.object({ status: z.enum(['active', 'disabled']) }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SetUserStatus>(req, 'setUserStatus').execute({ userId: params.id, status: body.status }),
          ),
      }),
    ];
  }
}
