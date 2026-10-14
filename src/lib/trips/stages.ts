// src/lib/trips/stages.ts
//
// A day in four stages (v4): breakfast & morning, lunch, afternoon, dinner &
// evening. The solver sets `PlannedStop.stage`; until a plan carries it (an
// older stored version), the stage is derived here from the stop's kind and
// time — a fallback only. PURE: the studio and its tests share it.

import { DAY_STAGES, type DayStage, type PlannedDay, type PlannedLeg, type PlannedStop } from './model';

/** Lunch begins the lunch stage, dinner (or 18:00) the evening, when a plan has no stages. */
const AFTERNOON_FROM = 14 * 60 + 30;
const EVENING_FROM = 18 * 60;

function mealTimes(day: PlannedDay): { lunch: number | null; dinner: number | null } {
  const at = (kind: string) => day.stops.find((s) => s.kind === 'meal' && s.id.endsWith(`:${kind}`))?.arriveMin ?? null;
  return { lunch: at('lunch'), dinner: at('dinner') };
}

/** The stage a stop belongs to: the solver's, else derived from its kind and time. */
export function stageOf(stop: PlannedStop, day: PlannedDay): DayStage {
  if (stop.stage) return stop.stage;
  if (stop.kind === 'meal') {
    if (stop.id.endsWith(':breakfast')) return 'morning';
    if (stop.id.endsWith(':lunch')) return 'lunch';
    if (stop.id.endsWith(':dinner')) return 'evening';
  }
  const { lunch, dinner } = mealTimes(day);
  const t = stop.arriveMin;
  if (dinner !== null ? t >= dinner : t >= EVENING_FROM) return 'evening';
  if (lunch !== null) {
    const lunchStop = day.stops.find((s) => s.kind === 'meal' && s.id.endsWith(':lunch'))!;
    if (t < lunch) return 'morning';
    if (t < lunchStop.departMin) return 'lunch';
    return 'afternoon';
  }
  return t < 12 * 60 ? 'morning' : t < AFTERNOON_FROM ? 'lunch' : 'afternoon';
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
  day.stops.forEach((stop, index) => {
    const raw = DAY_STAGES.indexOf(stageOf(stop, day));
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
