// src/lib/trips/stages.ts
//
// A day in four stages (v4): breakfast & morning, lunch, afternoon, dinner &
// evening. The solver sets `PlannedStop.stage` on every stop. A plan STORED
// before it did (older versions) has none; for those the solver's own rule
// (`withStages` + `mealOfStop`) assigns them here, so the studio and the
// solver never disagree. PURE.

import { mealOfStop, withStages } from '$lib/trips/solver';
import { DAY_STAGES, type DayStage, type PlannedDay, type PlannedLeg, type PlannedStop } from './model';

/** The day's stops, each with a stage: the solver's, or (old plans) the solver's rule applied now. */
export function stagedStops(day: PlannedDay): PlannedStop[] {
  return day.stops.every((s) => s.stage) ? day.stops : withStages(day.stops, (s) => mealOfStop(s));
}

/** The stage a stop belongs to within its day. */
export function stageOf(stop: PlannedStop, day: PlannedDay): DayStage {
  if (stop.stage) return stop.stage;
  return stagedStops(day).find((s) => s.id === stop.id)?.stage ?? 'morning';
}

export interface StageItem {
  stop: PlannedStop;
  /** The leg that arrives at this stop (legs[i-1] joins stops[i-1] → stops[i]). */
  legIn: PlannedLeg | null;
  index: number;
}

export interface StageGroup {
  stage: DayStage;
  items: StageItem[];
}

/**
 * The day's stops in their four stages, always all four (an empty stage is
 * shown as free). Stage order never runs backwards: a stop placed earlier in
 * the day cannot belong to a later stage than the stop after it.
 */
export function groupDay(day: PlannedDay): StageGroup[] {
  const groups = new Map<DayStage, StageItem[]>(DAY_STAGES.map((s) => [s, []]));
  let floor = 0;
  stagedStops(day).forEach((stop, index) => {
    const raw = DAY_STAGES.indexOf(stop.stage ?? 'morning');
    // The day's closing stay belongs to the stage it closes, not before it.
    const at = Math.max(raw, stop.kind === 'stay' && index === day.stops.length - 1 ? floor : 0, floor);
    floor = at;
    groups.get(DAY_STAGES[at])!.push({ stop, legIn: index > 0 ? (day.legs[index - 1] ?? null) : null, index });
  });
  return DAY_STAGES.map((stage) => ({ stage, items: groups.get(stage)! }));
}

/** The day in brief: the titles in each stage (stays, travel and empties left out). */
export function dayBrief(day: PlannedDay): Record<DayStage, string[]> {
  const out = Object.fromEntries(DAY_STAGES.map((s) => [s, [] as string[]])) as Record<DayStage, string[]>;
  for (const g of groupDay(day)) out[g.stage] = g.items.filter((i) => i.stop.kind === 'wish' || i.stop.kind === 'meal').map((i) => i.stop.title);
  return out;
}

/**
 * Stops whose time or day changed between two plans — for the studio's brief
 * highlight after a reply. Keyed by stop id (a wish keeps its id across days).
 */
export function changedStops(before: { days: PlannedDay[] } | null, after: { days: PlannedDay[] }): Set<string> {
  const was = new Map<string, string>();
  for (const d of before?.days ?? []) for (const s of d.stops) was.set(s.id, `${d.date}|${s.arriveMin}|${s.departMin}`);
  const out = new Set<string>();
  if (!before) return out;
  for (const d of after.days) for (const s of d.stops) if (s.kind !== 'stay' && was.get(s.id) !== `${d.date}|${s.arriveMin}|${s.departMin}`) out.add(s.id);
  return out;
}
