import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import {
  academicYear,
  calendarEvent,
  campus,
  lookupValue,
  room,
  setting,
  shift,
  term,
} from '../../../shared/infrastructure/db/schema/core.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { crudRoutes, zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import type { CoreModuleApi } from '../public-api/CoreModuleApi.js';

const YearStatus = z.enum(['planned', 'open', 'closing', 'locked', 'archived']);

/** CORE master data (docs/backend/modules.md#core): CORE-01, 02, 06, ACA-06 calendar. */
export class CoreController extends BaseController {
  readonly basePath = '/core';
  readonly tag = 'Core · Master data';

  routes(): RouteDefinition[] {
    return [
      ...crudRoutes({
        path: '/campuses',
        entity: 'campus',
        table: campus,
        orgScoped: true,
        permissions: { view: 'core.master.view', create: 'core.master.create', edit: 'core.master.edit' },
        search: [campus.nameEn, campus.code],
        orderBy: [campus.code],
        createSchema: z.object({
          code: zx.code(),
          nameEn: zx.name(),
          nameBn: z.string().max(200).optional(),
          addressEn: z.string().max(500).optional(),
          addressBn: z.string().max(500).optional(),
          phone: zx.phone().optional(),
          email: z.string().email().optional(),
          isActive: z.boolean().optional(),
        }),
        updateSchema: z.object({
          nameEn: zx.name(),
          nameBn: z.string().max(200).nullable(),
          addressEn: z.string().max(500).nullable(),
          addressBn: z.string().max(500).nullable(),
          phone: zx.phone().nullable(),
          email: z.string().email().nullable(),
          isActive: z.boolean(),
        }),
      }),
      ...crudRoutes({
        path: '/academic-years',
        entity: 'academic year',
        table: academicYear,
        orgScoped: true,
        permissions: { view: 'core.year.view', create: 'core.year.create', edit: 'core.year.edit' },
        filters: { status: academicYear.status, isCurrent: academicYear.isCurrent },
        orderBy: [academicYear.startsOn],
        createSchema: z.object({
          code: z.string().min(4).max(20),
          startsOn: zx.date(),
          endsOn: zx.date(),
          status: YearStatus.optional(),
        }),
        updateSchema: z.object({
          code: z.string().min(4).max(20),
          startsOn: zx.date(),
          endsOn: zx.date(),
          status: YearStatus,
        }),
      }),
      defineRoute({
        method: 'post',
        path: '/academic-years/:id/make-current',
        summary: 'Mark an open academic year as the current one',
        permission: 'core.year.approve',
        successStatus: 200,
        schema: { params: z.object({ id: z.string().uuid() }) },
        handler: async ({ params }, req) => {
          const uow = this.resolve<UnitOfWork>(req, 'uow');
          const year = await uow.run(async () => {
            const tx = uow.tx();
            const [target] = await tx.select().from(academicYear).where(eq(academicYear.id, params.id)).for('update');
            if (!target) throw new NotFoundError();
            if (target.status !== 'open')
              throw new InvariantError('YEAR_NOT_OPEN', 'Only an open academic year can be current');
            await tx.update(academicYear).set({ isCurrent: false }).where(eq(academicYear.isCurrent, true));
            const [updated] = await tx
              .update(academicYear)
              .set({ isCurrent: true })
              .where(eq(academicYear.id, params.id))
              .returning();
            return updated;
          });
          return this.ok(year);
        },
      }),
      ...crudRoutes({
        path: '/terms',
        entity: 'term',
        table: term,
        permissions: {
          view: 'core.year.view',
          create: 'core.year.create',
          edit: 'core.year.edit',
          delete: 'core.year.edit',
        },
        filters: { academicYearId: term.academicYearId },
        orderBy: [term.startsOn],
        createSchema: z.object({
          academicYearId: zx.uuid(),
          seq: z.number().int().min(1).max(6),
          code: zx.code(),
          nameEn: zx.name(),
          nameBn: z.string().max(200).optional(),
          startsOn: zx.date(),
          endsOn: zx.date(),
        }),
        updateSchema: z.object({
          nameEn: zx.name(),
          nameBn: z.string().max(200).nullable(),
          startsOn: zx.date(),
          endsOn: zx.date(),
        }),
      }),
      ...crudRoutes({
        path: '/shifts',
        entity: 'shift',
        table: shift,
        orgScoped: true,
        campusScoped: true,
        permissions: { view: 'core.master.view', create: 'core.master.create', edit: 'core.master.edit' },
        filters: { campusId: shift.campusId },
        createSchema: z.object({
          campusId: zx.uuid().optional(),
          code: zx.code(),
          nameEn: zx.name(),
          nameBn: z.string().optional(),
          startsAt: zx.time(),
          endsAt: zx.time(),
        }),
        updateSchema: z.object({
          nameEn: zx.name(),
          nameBn: z.string().nullable(),
          startsAt: zx.time(),
          endsAt: zx.time(),
        }),
      }),
      ...crudRoutes({
        path: '/rooms',
        entity: 'room',
        table: room,
        orgScoped: true,
        campusScoped: true,
        permissions: {
          view: 'core.master.view',
          create: 'core.master.create',
          edit: 'core.master.edit',
          delete: 'core.master.delete',
        },
        filters: { campusId: room.campusId, roomType: room.roomType },
        search: [room.code, room.name],
        orderBy: [room.code],
        createSchema: z.object({
          campusId: zx.uuid().optional(),
          code: zx.code(),
          name: zx.name(),
          roomType: z.enum(['classroom', 'lab', 'ict_lab', 'hall', 'library', 'playground', 'office', 'other']),
          capacity: z.number().int().positive().optional(),
          examCapacity: z.number().int().positive().optional(),
          isBookable: z.boolean().optional(),
        }),
        updateSchema: z.object({
          name: zx.name(),
          roomType: z.enum(['classroom', 'lab', 'ict_lab', 'hall', 'library', 'playground', 'office', 'other']),
          capacity: z.number().int().positive().nullable(),
          examCapacity: z.number().int().positive().nullable(),
          isBookable: z.boolean(),
        }),
      }),
      ...crudRoutes({
        path: '/calendar-events',
        entity: 'calendar event',
        table: calendarEvent,
        orgScoped: true,
        campusScoped: 'optional',
        permissions: {
          view: 'core.calendar.view',
          create: 'core.calendar.create',
          edit: 'core.calendar.edit',
          delete: 'core.calendar.delete',
        },
        filters: {
          academicYearId: calendarEvent.academicYearId,
          kind: calendarEvent.kind,
          campusId: calendarEvent.campusId,
        },
        orderBy: [calendarEvent.startsOn],
        createSchema: z.object({
          campusId: zx.uuid().nullable().optional(),
          academicYearId: zx.uuid(),
          kind: z.enum([
            'holiday_national',
            'holiday_islamic',
            'holiday_school',
            'exam_window',
            'ptm',
            'event',
            'term_break',
            'ramadan_routine',
          ]),
          titleEn: zx.name(),
          titleBn: z.string().max(200).optional(),
          startsOn: zx.date(),
          endsOn: zx.date(),
          isInstructional: z.boolean().optional(),
          audience: z.enum(['all', 'staff', 'students']).optional(),
          isTentative: z.boolean().optional(),
          publishToWeb: z.boolean().optional(),
        }),
        updateSchema: z.object({
          titleEn: zx.name(),
          titleBn: z.string().max(200).nullable(),
          startsOn: zx.date(),
          endsOn: zx.date(),
          isInstructional: z.boolean(),
          isTentative: z.boolean(),
          publishToWeb: z.boolean(),
        }),
      }),
      ...crudRoutes({
        path: '/lookups',
        entity: 'lookup value',
        table: lookupValue,
        orgScoped: true,
        permissions: { view: 'core.master.view', create: 'core.master.create', edit: 'core.master.edit' },
        filters: { listCode: lookupValue.listCode, isActive: lookupValue.isActive },
        orderBy: [lookupValue.listCode, lookupValue.seq],
        createSchema: z.object({
          listCode: zx.code(),
          code: zx.code(),
          labelEn: zx.name(),
          labelBn: z.string().max(200).optional(),
          seq: z.number().int().optional(),
        }),
        updateSchema: z.object({
          labelEn: zx.name(),
          labelBn: z.string().max(200).nullable(),
          seq: z.number().int(),
          isActive: z.boolean(),
        }),
      }),
      defineRoute({
        method: 'get',
        path: '/settings',
        summary: 'Settings (organisation defaults + campus overrides)',
        permission: 'core.settings.view',
        schema: { query: z.object({ campusId: z.string().uuid().optional() }) },
        handler: async ({ query }, req) => {
          const uow = this.resolve<UnitOfWork>(req, 'uow');
          const rows = await uow.run(
            () =>
              uow
                .tx()
                .select({
                  key: setting.key,
                  campusId: setting.campusId,
                  value: setting.value,
                  rowVersion: setting.rowVersion,
                })
                .from(setting)
                .where(query.campusId ? undefined : isNull(setting.campusId)),
            { readOnly: true },
          );
          const merged: Record<string, unknown> = {};
          for (const r of rows.filter((x) => x.campusId === null)) merged[r.key] = r.value;
          for (const r of rows.filter((x) => x.campusId === query.campusId)) merged[r.key] = r.value;
          return this.ok(merged);
        },
      }),
      defineRoute({
        method: 'put',
        path: '/settings/:key',
        summary: 'Set a setting (organisation default, or campus override with campusId)',
        permission: 'core.settings.edit',
        successStatus: 200,
        schema: {
          params: z.object({ key: z.string().regex(/^[a-z0-9_.]{3,80}$/) }),
          body: z.object({ value: z.unknown(), campusId: z.string().uuid().nullable().optional() }).strict(),
        },
        handler: async ({ params, body }, req) => {
          const campusId = body.campusId
            ? this.resolve<ScopePolicy>(req, 'scopePolicy').requireCampus(body.campusId)
            : null;
          const uow = this.resolve<UnitOfWork>(req, 'uow');
          const row = await uow.run(async () => {
            const tx = uow.tx();
            const where = and(
              eq(setting.key, params.key),
              campusId ? eq(setting.campusId, campusId) : isNull(setting.campusId),
            );
            const [updated] = await tx
              .update(setting)
              .set({ value: body.value ?? null })
              .where(where)
              .returning();
            if (updated) return updated;
            const [inserted] = await tx
              .insert(setting)
              .values({ orgId: req.ctx.orgId, campusId, key: params.key, value: body.value ?? null })
              .returning();
            return inserted;
          });
          return this.ok(row);
        },
      }),
      defineRoute({
        method: 'get',
        path: '/today',
        summary: 'Is today (or ?date=) a school day for a campus?',
        schema: { query: z.object({ campusId: z.string().uuid(), date: zx.date().optional() }) },
        handler: async ({ query }, req) => {
          const api = this.resolve<CoreModuleApi>(req, 'coreApi');
          const date =
            query.date ??
            new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Dhaka',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(new Date());
          return this.ok({ date, ...(await api.isSchoolDay(query.campusId, date)), year: await api.yearFor(date) });
        },
      }),
    ];
  }
}
