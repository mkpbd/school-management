import { and, asc, between, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  allocation,
  mealOptOut,
  mealService,
  messMenu,
  outpass,
} from '../../../shared/infrastructure/db/schema/hst.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import type { MenuEntry, MessRepository, OptOutRow, ServiceRow } from '../application/MessUseCases.js';
import type { Diet, Meal, MealResident } from '../domain/mess.js';

/** Mess menu, diets, opt-outs, out-pass absences at meal time and servings. */
export class DrizzleMessRepository implements MessRepository {
  constructor(private readonly d: { uow: UnitOfWork }) {}

  private get tx() {
    return this.d.uow.tx();
  }

  async menu(hostelId: string): Promise<MenuEntry[]> {
    const rows = await this.tx
      .select({ dayOfWeek: messMenu.dayOfWeek, meal: messMenu.meal, items: messMenu.items, itemsBn: messMenu.itemsBn })
      .from(messMenu)
      .where(eq(messMenu.hostelId, hostelId))
      .orderBy(asc(messMenu.dayOfWeek));
    return rows as MenuEntry[];
  }

  async replaceMenu(v: { orgId: string; campusId: string; hostelId: string }, entries: MenuEntry[]): Promise<void> {
    await this.tx.delete(messMenu).where(eq(messMenu.hostelId, v.hostelId));
    if (entries.length) await this.tx.insert(messMenu).values(entries.map((e) => ({ ...v, ...e })));
  }

  async mealResidents(hostelId: string, onDate: string): Promise<MealResident[]> {
    const rows = await this.tx
      .select({ studentId: allocation.studentId, mealPlan: allocation.mealPlan, diet: allocation.diet })
      .from(allocation)
      .where(
        and(
          eq(allocation.hostelId, hostelId),
          lte(allocation.validFrom, onDate),
          or(isNull(allocation.validTo), gte(allocation.validTo, onDate)),
        ),
      );
    return rows.map((r) => ({ studentId: r.studentId, mealPlan: r.mealPlan, diet: r.diet as Diet }));
  }

  async setDiet(allocationId: string, diet: Diet, dietNote: string | null): Promise<boolean> {
    const rows = await this.tx
      .update(allocation)
      .set({ diet, dietNote })
      .where(eq(allocation.id, allocationId))
      .returning({ id: allocation.id });
    return rows.length > 0;
  }

  async awayAt(hostelId: string, at: Date): Promise<Set<string>> {
    const rows = await this.tx
      .select({ studentId: outpass.studentId })
      .from(outpass)
      .where(
        and(
          eq(outpass.hostelId, hostelId),
          or(
            // approved or out: planned window covers the meal
            and(
              inArray(outpass.status, ['approved', 'out']),
              lte(outpass.outFrom, at),
              sql`${outpass.returnBy} > ${at}`,
            ),
            // still out past the return time
            and(eq(outpass.status, 'out'), lte(outpass.checkedOutAt, at)),
            // already back: the actual absence covered the meal
            and(eq(outpass.status, 'returned'), lte(outpass.checkedOutAt, at), sql`${outpass.checkedInAt} > ${at}`),
          ),
        ),
      );
    return new Set(rows.map((r) => r.studentId));
  }

  async optOuts(f: { hostelId?: string; studentId?: string; from: string; to: string }): Promise<OptOutRow[]> {
    const rows = await this.tx
      .select({
        studentId: mealOptOut.studentId,
        date: mealOptOut.mealDate,
        meal: mealOptOut.meal,
        reason: mealOptOut.reason,
        requestedBy: mealOptOut.requestedBy,
        requestedAt: mealOptOut.requestedAt,
      })
      .from(mealOptOut)
      .where(
        and(
          f.hostelId ? eq(mealOptOut.hostelId, f.hostelId) : undefined,
          f.studentId ? eq(mealOptOut.studentId, f.studentId) : undefined,
          between(mealOptOut.mealDate, f.from, f.to),
        ),
      )
      .orderBy(asc(mealOptOut.mealDate));
    return rows as OptOutRow[];
  }

  async addOptOuts(rows: Array<Record<string, unknown>>): Promise<number> {
    if (!rows.length) return 0;
    const inserted = await this.tx
      .insert(mealOptOut)
      .values(rows as Array<typeof mealOptOut.$inferInsert>)
      .onConflictDoNothing()
      .returning({ studentId: mealOptOut.studentId });
    return inserted.length;
  }

  async removeOptOut(studentId: string, date: string, meal: Meal): Promise<boolean> {
    const rows = await this.tx
      .delete(mealOptOut)
      .where(and(eq(mealOptOut.studentId, studentId), eq(mealOptOut.mealDate, date), eq(mealOptOut.meal, meal)))
      .returning({ studentId: mealOptOut.studentId });
    return rows.length > 0;
  }

  async services(hostelId: string, from: string, to: string): Promise<ServiceRow[]> {
    const rows = await this.tx
      .select({
        date: mealService.mealDate,
        meal: mealService.meal,
        expected: mealService.expected,
        served: mealService.served,
        note: mealService.note,
      })
      .from(mealService)
      .where(and(eq(mealService.hostelId, hostelId), between(mealService.mealDate, from, to)))
      .orderBy(asc(mealService.mealDate));
    return rows as ServiceRow[];
  }

  async upsertService(values: {
    orgId: string;
    campusId: string;
    hostelId: string;
    mealDate: string;
    meal: Meal;
    expected: number;
    served: number;
    note: string | null;
    recordedBy: string | null;
  }): Promise<void> {
    await this.tx
      .insert(mealService)
      .values(values)
      .onConflictDoUpdate({
        target: [mealService.hostelId, mealService.mealDate, mealService.meal],
        set: {
          expected: values.expected,
          served: values.served,
          note: values.note,
          recordedBy: values.recordedBy,
          recordedAt: sql`now()`,
        },
      });
  }
}
