import { InvariantError } from '../../../shared/domain/errors.js';

export const MEALS = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;
export type Meal = (typeof MEALS)[number];
export type Diet = 'regular' | 'vegetarian' | 'no_beef' | 'diabetic' | 'gluten_free' | 'other';

export const DEFAULT_MEAL_TIMES: Record<Meal, string> = {
  breakfast: '07:30',
  lunch: '13:30',
  snacks: '17:00',
  dinner: '20:30',
};

/** The instant a meal is served on a date (Asia/Dhaka). */
export function mealTime(date: string, meal: Meal, times: Partial<Record<Meal, string>> = {}): Date {
  const hhmm = times[meal] ?? DEFAULT_MEAL_TIMES[meal];
  return new Date(`${date}T${hhmm}:00+06:00`);
}

/**
 * Residents and guardians opt out until `cutoffHours` before the meal; the warden can still change it later
 * (the kitchen has started cooking by then, so it is their call).
 */
export function assertOptOutOpen(at: Date, now: Date, cutoffHours: number, byStaff: boolean): void {
  if (now.getTime() >= at.getTime()) throw new InvariantError('MEAL_PAST', 'The meal has already been served');
  if (!byStaff && now.getTime() > at.getTime() - cutoffHours * 3_600_000)
    throw new InvariantError(
      'MEAL_CUTOFF_PASSED',
      `Changes close ${cutoffHours} hour(s) before the meal; ask the warden`,
    );
}

export interface MealResident {
  studentId: string;
  mealPlan: 'full' | 'none';
  diet: Diet;
}

export interface Headcount {
  meal: Meal;
  at: Date;
  residents: number;
  onMealPlan: number;
  away: number;
  optedOut: number;
  expected: number;
  diets: Partial<Record<Diet, number>>;
}

/** Expected plates: residents on the meal plan, minus those away on an out-pass at meal time and opt-outs. */
export function headcount(
  meal: Meal,
  at: Date,
  residents: MealResident[],
  away: Set<string>,
  optedOut: Set<string>,
): Headcount {
  const onPlan = residents.filter((r) => r.mealPlan === 'full');
  const eating = onPlan.filter((r) => !away.has(r.studentId) && !optedOut.has(r.studentId));
  const diets: Partial<Record<Diet, number>> = {};
  for (const r of eating) diets[r.diet] = (diets[r.diet] ?? 0) + 1;
  return {
    meal,
    at,
    residents: residents.length,
    onMealPlan: onPlan.length,
    away: onPlan.filter((r) => away.has(r.studentId)).length,
    optedOut: onPlan.filter((r) => !away.has(r.studentId) && optedOut.has(r.studentId)).length,
    expected: eating.length,
    diets,
  };
}
