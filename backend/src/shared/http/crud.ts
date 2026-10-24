/* eslint-disable @typescript-eslint/no-explicit-any -- generic over Drizzle tables; typed at the definition site */
import { and, asc, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z, type ZodObject, type ZodType } from 'zod';
import type { PermissionCode, RequestContext } from '../application/RequestContext.js';
import type { ScopePolicy } from '../application/ScopePolicy.js';
import { NotFoundError, StaleWriteError } from '../domain/errors.js';
import type { UnitOfWork } from '../infrastructure/db/UnitOfWork.js';
import { ifMatchVersion } from './BaseController.js';
import { defineRoute, type RouteDefinition } from './RouteDefinition.js';

/**
 * Declarative CRUD for configuration / master-data tables (campuses, rooms, subjects, fee heads, ...).
 * Business processes (enrolment, attendance, payments) use explicit use-case classes instead.
 * Every call runs in the request UnitOfWork, so RLS applies; writes check permissions and campus scope.
 */
export interface CrudDef {
  /** path under the controller basePath, e.g. '/rooms' */
  path: string;
  /** singular name for OpenAPI summaries */
  entity: string;
  table: PgTable;
  permissions: { view: PermissionCode; create?: PermissionCode; edit?: PermissionCode; delete?: PermissionCode };
  createSchema?: ZodObject;
  updateSchema?: ZodObject;
  /** query param -> column (equality) */
  filters?: Record<string, PgColumn>;
  /** columns searched by ?q= (ILIKE) */
  search?: PgColumn[];
  orderBy?: PgColumn[];
  /** table has org_id (filled from ctx) */
  orgScoped?: boolean;
  /** table has campus_id: on create it comes from body.campusId or X-Campus-Id and must be in scope */
  campusScoped?: boolean | 'optional';
  /** response fields never returned (secrets / hashes), by property name */
  omit?: string[];
  /** extra fields/derivations on insert */
  prepareInsert?: (
    values: Record<string, unknown>,
    ctx: RequestContext,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

const IdParams = z.object({ id: z.string().uuid() });
const ListQuery = z.object({
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

function col(table: PgTable, name: string): PgColumn | undefined {
  return (table as any)[name] as PgColumn | undefined;
}

export function crudRoutes(def: CrudDef): RouteDefinition[] {
  const idCol = col(def.table, 'id')!;
  const versionCol = col(def.table, 'rowVersion');
  const filterKeys = Object.keys(def.filters ?? {});
  const listQuery = ListQuery.extend(Object.fromEntries(filterKeys.map((k) => [k, z.string().max(100).optional()])));
  const uowOf = (req: any) => req.scope.resolve('uow') as UnitOfWork;
  const policyOf = (req: any) => req.scope.resolve('scopePolicy') as ScopePolicy;

  const clean = (row: Record<string, unknown>): Record<string, unknown> =>
    def.omit?.length ? Object.fromEntries(Object.entries(row).filter(([k]) => !def.omit!.includes(k))) : row;

  const findById = async (uow: UnitOfWork, id: string) => {
    const [row] = await uow.tx().select().from(def.table).where(eq(idCol, id));
    return row as Record<string, unknown> | undefined;
  };

  const routes: RouteDefinition[] = [
    defineRoute({
      method: 'get',
      path: def.path,
      summary: `List ${def.entity}s`,
      permission: def.permissions.view,
      schema: { query: listQuery },
      handler: async ({ query }, req) => {
        const q = query as z.infer<typeof ListQuery> & Record<string, string | undefined>;
        const where: SQL[] = [];
        for (const key of filterKeys) {
          const value = q[key];
          if (value !== undefined)
            where.push(eq(def.filters![key]!, value === 'true' ? true : value === 'false' ? false : value));
        }
        if (q.q && def.search?.length) where.push(or(...def.search.map((c) => ilike(c, `%${q.q}%`)))!);
        const uow = uowOf(req);
        const rows = await uow.run(
          () =>
            uow
              .tx()
              .select()
              .from(def.table)
              .where(where.length ? and(...where) : undefined)
              .orderBy(...(def.orderBy ?? []).map((c) => asc(c)), asc(idCol))
              .limit(q.pageSize + 1)
              .offset((q.page - 1) * q.pageSize),
          { readOnly: true },
        );
        const hasMore = rows.length > q.pageSize;
        return {
          status: 200,
          data: rows.slice(0, q.pageSize).map((r) => clean(r as Record<string, unknown>)),
          meta: { page: q.page, pageSize: q.pageSize, hasMore },
        };
      },
    }),
    defineRoute({
      method: 'get',
      path: `${def.path}/:id`,
      summary: `Get a ${def.entity}`,
      permission: def.permissions.view,
      schema: { params: IdParams },
      handler: async ({ params }, req) => {
        const uow = uowOf(req);
        const row = await uow.run(() => findById(uow, params.id), { readOnly: true });
        if (!row) throw new NotFoundError();
        return {
          status: 200,
          data: clean(row),
          headers: row.rowVersion !== undefined ? { ETag: `"${String(row.rowVersion)}"` } : undefined,
        };
      },
    }),
  ];

  if (def.createSchema && def.permissions.create) {
    routes.push(
      defineRoute({
        method: 'post',
        path: def.path,
        summary: `Create a ${def.entity}`,
        permission: def.permissions.create,
        schema: { body: def.createSchema.strict() },
        handler: async ({ body }, req) => {
          const ctx = req.ctx;
          let values: Record<string, unknown> = { ...(body as Record<string, unknown>) };
          if (def.orgScoped) values.orgId = ctx.orgId;
          if (def.campusScoped) {
            const requested = (values.campusId as string | undefined) ?? ctx.activeCampusId;
            if (def.campusScoped === true || requested) values.campusId = policyOf(req).requireCampus(requested);
          }
          if (def.prepareInsert) values = await def.prepareInsert(values, ctx);
          const uow = uowOf(req);
          const [row] = await uow.run(() =>
            uow
              .tx()
              .insert(def.table)
              .values(values as any)
              .returning(),
          );
          return {
            status: 201,
            data: clean(row as Record<string, unknown>),
            headers: { Location: `${req.originalUrl.split('?')[0]}/${String((row as any).id)}` },
          };
        },
      }),
    );
  }

  if (def.updateSchema && def.permissions.edit) {
    routes.push(
      defineRoute({
        method: 'patch',
        path: `${def.path}/:id`,
        summary: `Update a ${def.entity} (send If-Match: "<rowVersion>" to avoid lost updates)`,
        permission: def.permissions.edit,
        schema: { params: IdParams, body: def.updateSchema.partial().strict() },
        handler: async ({ params, body }, req) => {
          const expected = ifMatchVersion(req);
          const uow = uowOf(req);
          const row = await uow.run(async () => {
            const conditions = [eq(idCol, params.id)];
            if (expected !== undefined && versionCol) conditions.push(eq(versionCol, expected));
            const [updated] = await uow
              .tx()
              .update(def.table)
              .set(body as any)
              .where(and(...conditions))
              .returning();
            if (updated) return updated as Record<string, unknown>;
            if (await findById(uow, params.id)) throw new StaleWriteError();
            throw new NotFoundError();
          });
          return {
            status: 200,
            data: clean(row),
            headers: row.rowVersion !== undefined ? { ETag: `"${String(row.rowVersion)}"` } : undefined,
          };
        },
      }),
    );
  }

  if (def.permissions.delete) {
    routes.push(
      defineRoute({
        method: 'delete',
        path: `${def.path}/:id`,
        summary: `Delete a ${def.entity}`,
        permission: def.permissions.delete,
        schema: { params: IdParams },
        handler: async ({ params }, req) => {
          const uow = uowOf(req);
          const deleted = await uow.run(() =>
            uow.tx().delete(def.table).where(eq(idCol, params.id)).returning({ id: idCol }),
          );
          if (!deleted.length) throw new NotFoundError();
          return { status: 204 };
        },
      }),
    );
  }
  return routes;
}

/** Common Zod building blocks for master data. */
export const zx = {
  uuid: () => z.string().uuid(),
  code: () =>
    z
      .string()
      .trim()
      .min(1)
      .max(30)
      .regex(/^[A-Za-z0-9_.-]+$/, 'letters, digits, _ . - only'),
  name: () => z.string().trim().min(1).max(200),
  date: () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  time: () => z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'HH:MM'),
  phone: () => z.string().regex(/^\+[1-9]\d{7,14}$/, 'E.164 e.g. +8801712345678'),
  paisa: () => z.number().int().min(0),
  responseOf: (s: ZodType) => s,
};
