// src/lib/trips/solver/rules.ts
//
// v4: the pace rules the solver works with. Every pace now plans three meals
// so each stage of the day has substance:
//   breakfast  07:30–10:00, 30 min — at the stay just before setting off,
//              unless a café wish replaces it
//   lunch      the pace's own window
//   dinner     19:00–21:30 (relaxed 19:30–21:30), 75 min (relaxed 90);
//              packed keeps its own
// The "back at the stay by" time (dayEndMin) moves to after dinner (22:30),
// while sightseeing still has to finish by the pace's old day end
// (activeEndMin), so days don't get busier.

import { PACE_RULES, type Pace, type PaceRules } from '../model';

export interface MealWindow {
  fromMin: number;
  toMin: number;
  durationSec: number;
}

export interface SolverRules extends PaceRules {
  breakfast: MealWindow;
  dinner: MealWindow;
  /** Sightseeing (non-meal, non-evening wishes) should end by this minute. */
  activeEndMin: number;
}

export const BREAKFAST: MealWindow = { fromMin: 7 * 60 + 30, toMin: 10 * 60, durationSec: 30 * 60 };
const DINNER: Record<Pace, MealWindow | null> = {
  relaxed: { fromMin: 19 * 60 + 30, toMin: 21 * 60 + 30, durationSec: 90 * 60 },
  normal: { fromMin: 19 * 60, toMin: 21 * 60 + 30, durationSec: 75 * 60 },
  packed: null, // keeps its own
};
/** Back at the stay this long after the dinner window closes. */
const HOME_AFTER_DINNER_MIN = 60;

export function solverRules(pace: Pace): SolverRules {
  const base = PACE_RULES[pace] ?? PACE_RULES.normal;
  const dinner = DINNER[pace] ?? base.dinner ?? (DINNER.normal as MealWindow);
  return {
    ...base,
    breakfast: BREAKFAST,
    dinner,
    activeEndMin: base.dayEndMin,
    dayEndMin: Math.max(base.dayEndMin, base.dinner ? base.dayEndMin : dinner.toMin + HOME_AFTER_DINNER_MIN),
  };
}

/** Meal minutes inside the active day (lunch, and dinner when it falls before the active end). */
export function activeMealMin(rules: SolverRules): number {
  const lunch = Math.round(rules.lunch.durationSec / 60);
  const dinner = rules.dinner.fromMin < rules.activeEndMin ? Math.round(rules.dinner.durationSec / 60) : 0;
  return lunch + dinner;
}
