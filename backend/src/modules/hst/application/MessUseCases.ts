import type { TransactionRunner } from '../../../shared/application/ports.js';
import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { ScopePolicy } from '../../../shared/application/ScopePolicy.js';
import { Query, UseCase } from '../../../shared/application/UseCase.js';
import type { Clock } from '../../../shared/domain/Clock.js';
import { InvariantError, NotFoundError } from '../../../shared/domain/errors.js';
import { LocalDate } from '../../../shared/domain/LocalDate.js';
import type { CoreModuleApi } from '../../core/public-api/CoreModuleApi.js';
import type { SisModuleApi } from '../../sis/public-api/SisModuleApi.js';
import {
  assertOptOutOpen,
  headcount,
  mealTime,
  MEALS,
  type Diet,
  type Headcount,
  type Meal,
  type MealResident,
} from '../domain/mess.js';
import type { HostelRow, HstRepository } from './ports.js';

export interface MenuEntry {
  dayOfWeek: number;
  meal: Meal;
  items: string;
  itemsBn: string | null;
}

export interface OptOutRow {
  studentId: string;
  date: string;
  meal: Meal;
  reason: string | null;
  requestedBy: string | null;
  requestedAt: Date;
}

export interface ServiceRow {
  date: string;
  meal: Meal;
  expected: number;
  served: number;
  note: string | null;
}

export interface MessRepository {
  menu(hostelId: string): Promise<MenuEntry[]>;
  replaceMenu(v: { orgId: string; campusId: string; hostelId: string }, entries: MenuEntry[]): Promise<void>;
  mealResidents(hostelId: string, onDate: string): Promise<MealResident[]>;
  setDiet(allocationId: string, diet: Diet, dietNote: string | null): Promise<boolean>;
  /** residents out on a pass at that instant */
  awayAt(hostelId: string, at: Date): Promise<Set<string>>;
  optOuts(f: { hostelId?: string; studentId?: string; from: string; to: string }): Promise<OptOutRow[]>;
  addOptOuts(rows: Array<Record<string, unknown>>): Promise<number>;
  removeOptOut(studentId: string, date: string, meal: Meal): Promise<boolean>;
  services(hostelId: string, from: string, to: string): Promise<ServiceRow[]>;
  upsertService(values: {
    orgId: string;
    campusId: string;
    hostelId: string;
    mealDate: string;
    meal: Meal;
    expected: number;
    served: number;
    note: string | null;
    recordedBy: string | null;
  }): Promise<void>;
}

interface Deps {
  uow: TransactionRunner;
  ctx: RequestContext;
  clock: Clock;
  hstRepo: HstRepository;
  messRepo: MessRepository;
  scopePolicy: ScopePolicy;
  sisApi: SisModuleApi;
  coreApi: CoreModuleApi;
}

async function visibleHostel(d: Deps, id: string): Promise<HostelRow> {
  const h = await d.hstRepo.hostel(id);
  if (!h) throw new NotFoundError('Hostel not found', 'HOSTEL_NOT_FOUND');
  d.scopePolicy.requireCampus(h.campusId);
  return h;
}

async function mealTimes(d: Deps, campusId: string): Promise<Partial<Record<Meal, string>>> {
  return (await d.coreApi.getSetting<Partial<Record<Meal, string>>>('hostel.meal_times', campusId)) ?? {};
}

/** Warden (hst.mess.create on the campus), or the resident / their guardian for their own meals. */
async function mealAccess(d: Deps, studentId: string, campusId: string): Promise<'staff' | 'family'> {
  if (d.scopePolicy.has('hst.mess.create')) {
    d.scopePolicy.requireCampus(campusId);
    return 'staff';
  }
  if (d.ctx.studentId === studentId) return 'family';
  if (d.ctx.guardianId && (await d.sisApi.isGuardianOf(d.ctx.guardianId, studentId))) return 'family';
  throw new NotFoundError();
}

export class GetMessMenu extends Query<{ hostelId: string }, { hostelId: string; menu: MenuEntry[] }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ hostelId }: { hostelId: string }) {
    const h = await visibleHostel(this.d, hostelId);
    return { hostelId: h.id, menu: await this.d.messRepo.menu(h.id) };
  }
}

/** Replaces the weekly cycle (day 0 = Sunday ... 6 = Saturday; one entry per day and meal). */
export class SetMessMenu extends UseCase<{ hostelId: string; entries: MenuEntry[] }, { entries: number }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { hostelId: string; entries: MenuEntry[] }) {
    const h = await visibleHostel(this.d, i.hostelId);
    const keys = new Set(i.entries.map((e) => `${e.dayOfWeek}|${e.meal}`));
    if (keys.size !== i.entries.length) throw new InvariantError('DUPLICATE_ENTRY', 'A day and meal appear twice');
    await this.d.messRepo.replaceMenu({ orgId: this.d.ctx.orgId, campusId: h.campusId, hostelId: h.id }, i.entries);
    return { entries: i.entries.length };
  }
}

export class SetResidentDiet extends UseCase<
  { allocationId: string; diet: Diet; dietNote?: string | null },
  { allocationId: string; diet: Diet; dietNote: string | null }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { allocationId: string; diet: Diet; dietNote?: string | null }) {
    const a = await this.d.hstRepo.allocation(i.allocationId, true);
    if (!a) throw new NotFoundError('Allocation not found', 'ALLOCATION_NOT_FOUND');
    this.d.scopePolicy.requireCampus(a.campusId);
    await this.d.messRepo.setDiet(a.id, i.diet, i.dietNote ?? null);
    return { allocationId: a.id, diet: i.diet, dietNote: i.dietNote ?? null };
  }
}

/** Kitchen sheet of a day: expected plates per meal (with diets), what was served, and the menu of the day. */
export class GetMealHeadcount extends Query<
  { hostelId: string; date: string },
  { date: string; menu: MenuEntry[]; meals: Array<Headcount & { served: number | null }> }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ hostelId, date }: { hostelId: string; date: string }) {
    const h = await visibleHostel(this.d, hostelId);
    const times = await mealTimes(this.d, h.campusId);
    const residents = await this.d.messRepo.mealResidents(h.id, date);
    const optOuts = await this.d.messRepo.optOuts({ hostelId: h.id, from: date, to: date });
    const served = new Map((await this.d.messRepo.services(h.id, date, date)).map((s) => [s.meal, s.served]));
    const meals = [];
    for (const meal of MEALS) {
      const at = mealTime(date, meal, times);
      const out = new Set(optOuts.filter((o) => o.meal === meal).map((o) => o.studentId));
      meals.push({
        ...headcount(meal, at, residents, await this.d.messRepo.awayAt(h.id, at), out),
        served: served.get(meal) ?? null,
      });
    }
    const dow = LocalDate.parse(date).dayOfWeek();
    return { date, menu: (await this.d.messRepo.menu(h.id)).filter((m) => m.dayOfWeek === dow), meals };
  }
}

/** The kitchen records what it served; the expected count is frozen alongside for the waste report. */
export class RecordMealService extends UseCase<
  { hostelId: string; date: string; meal: Meal; served: number; note?: string },
  { expected: number; served: number; difference: number }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { hostelId: string; date: string; meal: Meal; served: number; note?: string }) {
    const h = await visibleHostel(this.d, i.hostelId);
    const at = mealTime(i.date, i.meal, await mealTimes(this.d, h.campusId));
    if (at.getTime() > this.d.clock.now().getTime() + 3_600_000)
      throw new InvariantError('MEAL_NOT_SERVED_YET', 'Record servings after the meal');
    const optOuts = await this.d.messRepo.optOuts({ hostelId: h.id, from: i.date, to: i.date });
    const count = headcount(
      i.meal,
      at,
      await this.d.messRepo.mealResidents(h.id, i.date),
      await this.d.messRepo.awayAt(h.id, at),
      new Set(optOuts.filter((o) => o.meal === i.meal).map((o) => o.studentId)),
    );
    await this.d.messRepo.upsertService({
      orgId: this.d.ctx.orgId,
      campusId: h.campusId,
      hostelId: h.id,
      mealDate: i.date,
      meal: i.meal,
      expected: count.expected,
      served: i.served,
      note: i.note ?? null,
      recordedBy: this.d.ctx.userId,
    });
    return { expected: count.expected, served: i.served, difference: i.served - count.expected };
  }
}

/** A resident (or guardian, or warden) skips meals; residents and guardians only until the cutoff. */
export class OptOutOfMeals extends UseCase<
  { studentId: string; entries: Array<{ date: string; meal: Meal }>; reason?: string },
  { added: number; optOuts: OptOutRow[] }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { studentId: string; entries: Array<{ date: string; meal: Meal }>; reason?: string }) {
    const { d } = this;
    const today = LocalDate.today(d.clock).iso;
    const dates = [...new Set(i.entries.map((e) => e.date))].sort();
    const first = await d.hstRepo.activeAllocationOf(i.studentId, dates[0] ?? today);
    if (!first) throw new InvariantError('NOT_A_RESIDENT', 'The student has no hostel bed on that date');
    const who = await mealAccess(d, i.studentId, first.campusId);
    const cutoff = (await d.coreApi.getSetting<number>('hostel.meal_optout_cutoff_hours', first.campusId)) ?? 4;
    const times = await mealTimes(d, first.campusId);
    const rows = [];
    for (const e of i.entries) {
      const a = await d.hstRepo.activeAllocationOf(i.studentId, e.date);
      if (!a || a.mealPlan !== 'full') throw new InvariantError('NO_MEAL_PLAN', `No hostel meal plan on ${e.date}`);
      assertOptOutOpen(mealTime(e.date, e.meal, times), d.clock.now(), cutoff, who === 'staff');
      rows.push({
        orgId: d.ctx.orgId,
        campusId: a.campusId,
        hostelId: a.hostelId,
        studentId: i.studentId,
        mealDate: e.date,
        meal: e.meal,
        reason: i.reason ?? null,
        requestedBy: d.ctx.userId,
      });
    }
    const added = await d.messRepo.addOptOuts(rows);
    return {
      added,
      optOuts: await d.messRepo.optOuts({ studentId: i.studentId, from: dates[0]!, to: dates.at(-1)! }),
    };
  }
}

export class CancelMealOptOut extends UseCase<{ studentId: string; date: string; meal: Meal }, { removed: boolean }> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle(i: { studentId: string; date: string; meal: Meal }) {
    const a = await this.d.hstRepo.activeAllocationOf(i.studentId, i.date);
    if (!a) throw new InvariantError('NOT_A_RESIDENT', 'The student has no hostel bed on that date');
    const who = await mealAccess(this.d, i.studentId, a.campusId);
    const cutoff = (await this.d.coreApi.getSetting<number>('hostel.meal_optout_cutoff_hours', a.campusId)) ?? 4;
    assertOptOutOpen(
      mealTime(i.date, i.meal, await mealTimes(this.d, a.campusId)),
      this.d.clock.now(),
      cutoff,
      who === 'staff',
    );
    return { removed: await this.d.messRepo.removeOptOut(i.studentId, i.date, i.meal) };
  }
}

/** Resident / parent view: this week's menu of their hostel and their meals skipped in the next 7 days. */
export class GetStudentMeals extends Query<
  { studentId: string },
  { hostelId: string | null; mealPlan: 'full' | 'none' | null; menu: MenuEntry[]; optOuts: OptOutRow[] }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ studentId }: { studentId: string }) {
    const today = LocalDate.today(this.d.clock);
    const a = await this.d.hstRepo.activeAllocationOf(studentId, today.iso);
    if (!a) {
      await mealAccess(this.d, studentId, this.d.ctx.activeCampusId ?? '');
      return { hostelId: null, mealPlan: null, menu: [], optOuts: [] };
    }
    await mealAccess(this.d, studentId, a.campusId);
    return {
      hostelId: a.hostelId,
      mealPlan: a.mealPlan,
      menu: await this.d.messRepo.menu(a.hostelId),
      optOuts: await this.d.messRepo.optOuts({ studentId, from: today.iso, to: today.addDays(7).iso }),
    };
  }
}

/** Month summary: meals skipped per resident (for meal-fee adjustments) and expected vs served per day. */
export class MessMonthReport extends Query<
  { hostelId: string; month: string },
  {
    month: string;
    skippedByStudent: Array<{ studentId: string; studentName: string; skipped: number }>;
    services: ServiceRow[];
    totals: { expected: number; served: number };
  }
> {
  constructor(private readonly d: Deps) {
    super(d.uow);
  }
  protected async handle({ hostelId, month }: { hostelId: string; month: string }) {
    const h = await visibleHostel(this.d, hostelId);
    const from = `${month}-01`;
    const [y, m] = month.split('-').map(Number) as [number, number];
    const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const optOuts = await this.d.messRepo.optOuts({ hostelId: h.id, from, to });
    const counts = new Map<string, number>();
    for (const o of optOuts) counts.set(o.studentId, (counts.get(o.studentId) ?? 0) + 1);
    const names = await this.d.sisApi.studentBriefs([...counts.keys()]);
    const services = await this.d.messRepo.services(h.id, from, to);
    return {
      month,
      skippedByStudent: [...counts]
        .map(([studentId, skipped]) => ({ studentId, studentName: names.get(studentId)?.fullNameEn ?? '', skipped }))
        .sort((a, b) => b.skipped - a.skipped),
      services,
      totals: {
        expected: services.reduce((s, r) => s + r.expected, 0),
        served: services.reduce((s, r) => s + r.served, 0),
      },
    };
  }
}
