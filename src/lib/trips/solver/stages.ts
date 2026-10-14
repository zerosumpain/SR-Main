// src/lib/trips/solver/stages.ts
//
// v4: the four stages of a day — morning (breakfast and everything before
// lunch), lunch (the lunch meal, or the wish that replaces it), afternoon
// (after lunch until dinner, or 18:00 when there is no dinner) and evening
// (dinner and after). Travel stops (stay, transport, transfers) belong to
// the stage they fall in. Stages never go backwards through a day.
//
// Pure and small so the phone can port it as is.

import type { DayStage, PlannedStop } from '../model';

export type MealOf = (stop: PlannedStop) => 'breakfast' | 'lunch' | 'dinner' | null;

/** A stop's meal: meal stops by id suffix, and wishes that replace a meal via `replaces`. */
export function mealOfStop(
  stop: PlannedStop,
  replaces: ReadonlyMap<string, 'breakfast' | 'lunch' | 'dinner'> = new Map(),
): 'breakfast' | 'lunch' | 'dinner' | null {
  if (stop.kind === 'meal') {
    if (stop.id.endsWith(':breakfast')) return 'breakfast';
    if (stop.id.endsWith(':lunch')) return 'lunch';
    if (stop.id.endsWith(':dinner')) return 'dinner';
    return null;
  }
  return stop.kind === 'wish' && stop.wishId ? (replaces.get(stop.wishId) ?? null) : null;
}

/** Without a lunch or dinner stop, these times split the day. */
export const STAGE_TIMES = { lunchFromMin: 12 * 60, eveningFromMin: 18 * 60 };

const ORDER: Record<DayStage, number> = { morning: 0, lunch: 1, afternoon: 2, evening: 3 };

/** The stage of every stop, in order. */
export function stageOf(stops: PlannedStop[], mealOf: MealOf): DayStage[] {
  const lunch = stops.findIndex((s) => mealOf(s) === 'lunch');
  const dinner = stops.findIndex((s) => mealOf(s) === 'dinner');
  let current: DayStage = 'morning';
  return stops.map((s, i) => {
    const meal = mealOf(s);
    let stage: DayStage;
    if (meal === 'lunch') stage = 'lunch';
    else if (meal === 'dinner') stage = 'evening';
    else if (meal === 'breakfast') stage = 'morning';
    else if (dinner >= 0 && i > dinner) stage = 'evening';
    else if (lunch >= 0 && i > lunch) {
      stage = dinner < 0 && s.arriveMin >= STAGE_TIMES.eveningFromMin ? 'evening' : 'afternoon';
    } else if (lunch >= 0) stage = 'morning';
    else if (dinner < 0 && s.arriveMin >= STAGE_TIMES.eveningFromMin) stage = 'evening';
    else if (s.arriveMin >= STAGE_TIMES.lunchFromMin) stage = 'afternoon';
    else stage = 'morning';
    if (ORDER[stage] < ORDER[current]) stage = current;
    current = stage;
    return stage;
  });
}

/** The same stops with `stage` set. */
export function withStages(stops: PlannedStop[], mealOf: MealOf): PlannedStop[] {
  const stages = stageOf(stops, mealOf);
  return stops.map((s, i) => ({ ...s, stage: stages[i] }));
}
