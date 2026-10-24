import { z } from 'zod';
import { BaseController } from '../../../shared/http/BaseController.js';
import { zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  CancelMealOptOut,
  GetMealHeadcount,
  GetMessMenu,
  GetStudentMeals,
  MessMonthReport,
  OptOutOfMeals,
  RecordMealService,
  SetMessMenu,
  SetResidentDiet,
} from '../application/MessUseCases.js';

const Id = z.object({ id: zx.uuid() });
const Meal = z.enum(['breakfast', 'lunch', 'snacks', 'dinner']);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());

/** Hostel mess: weekly menu, diets, meal opt-outs (cutoff), kitchen headcount, servings, month report. */
export class MessController extends BaseController {
  readonly basePath = '/hst';
  readonly tag = 'Hostel mess';

  routes(): RouteDefinition[] {
    return [
      defineRoute({
        method: 'get',
        path: '/hostels/:id/menu',
        summary: 'Weekly mess menu (day 0 = Sunday)',
        permission: 'hst.mess.view',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetMessMenu>(req, 'getMessMenu').execute({ hostelId: params.id })),
      }),
      defineRoute({
        method: 'put',
        path: '/hostels/:id/menu',
        summary: 'Replace the weekly mess menu (English / Bangla)',
        permission: 'hst.mess.create',
        successStatus: 200,
        schema: {
          params: Id,
          body: z
            .object({
              entries: z
                .array(
                  z
                    .object({
                      dayOfWeek: z.number().int().min(0).max(6),
                      meal: Meal,
                      items: z.string().trim().min(1).max(500),
                      itemsBn: z.string().trim().max(500).nullable().default(null),
                    })
                    .strict(),
                )
                .max(28),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SetMessMenu>(req, 'setMessMenu').execute({ hostelId: params.id, entries: body.entries }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/hostels/:id/meals',
        summary: 'Kitchen headcount of a day: expected plates per meal, diets, away / opted out, served',
        permission: 'hst.mess.view',
        schema: { params: Id, query: z.object({ date: zx.date().optional() }) },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<GetMealHeadcount>(req, 'getMealHeadcount').execute({
              hostelId: params.id,
              date: query.date ?? today(),
            }),
          ),
      }),
      defineRoute({
        method: 'put',
        path: '/hostels/:id/meals/service',
        summary: 'Record plates served for a meal (kept with the expected count)',
        permission: 'hst.mess.create',
        successStatus: 200,
        schema: {
          params: Id,
          body: z
            .object({
              date: zx.date(),
              meal: Meal,
              served: z.number().int().min(0).max(5000),
              note: z.string().max(500).optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<RecordMealService>(req, 'recordMealService').execute({ hostelId: params.id, ...body }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/hostels/:id/meals/report',
        summary: 'Month report: meals skipped per resident, expected vs served',
        permission: 'hst.mess.view',
        schema: {
          params: Id,
          query: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
        },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<MessMonthReport>(req, 'messMonthReport').execute({
              hostelId: params.id,
              month: query.month,
            }),
          ),
      }),
      defineRoute({
        method: 'patch',
        path: '/allocations/:id/diet',
        summary: 'Diet of a resident (vegetarian, no beef, diabetic, gluten free, other)',
        permission: 'hst.mess.create',
        schema: {
          params: Id,
          body: z
            .object({
              diet: z.enum(['regular', 'vegetarian', 'no_beef', 'diabetic', 'gluten_free', 'other']),
              dietNote: z.string().max(300).nullable().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SetResidentDiet>(req, 'setResidentDiet').execute({ allocationId: params.id, ...body }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/students/:id/meals',
        summary: 'Menu of the resident and skipped meals in the next 7 days (guardian / student / warden)',
        schema: { params: Id },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<GetStudentMeals>(req, 'getStudentMeals').execute({ studentId: params.id })),
      }),
      defineRoute({
        method: 'post',
        path: '/students/:id/meal-opt-outs',
        summary: 'Skip meals (home visit, outing, fasting); residents / guardians until the cutoff before the meal',
        schema: {
          params: Id,
          body: z
            .object({
              entries: z
                .array(z.object({ date: zx.date(), meal: Meal }).strict())
                .min(1)
                .max(60),
              reason: z.string().max(300).optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<OptOutOfMeals>(req, 'optOutOfMeals').execute({ studentId: params.id, ...body }),
          ),
      }),
      defineRoute({
        method: 'delete',
        path: '/students/:id/meal-opt-outs/:date/:meal',
        summary: 'Take a skipped meal back (until the cutoff)',
        schema: { params: z.object({ id: zx.uuid(), date: zx.date(), meal: Meal }) },
        handler: async ({ params }, req) =>
          this.ok(
            await this.resolve<CancelMealOptOut>(req, 'cancelMealOptOut').execute({
              studentId: params.id,
              date: params.date,
              meal: params.meal,
            }),
          ),
      }),
    ];
  }
}
