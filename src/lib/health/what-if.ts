// "What happens to the numbers if I go and do this?"
//
// The hub already answers where the body is and what to do about it. It cannot
// answer the question a reader actually asks next — what a session on Thursday
// would DO to the ratio — because every analytic runs once, on the server, over
// what has already happened.
//
// It turns out nothing was stopping it. Every module under `analytics/` is
// pure: measured 2026-09-07, none of the sixteen imports `$lib/server` or the
// database. So a simulation here is not a model of the analytic, it IS the
// analytic — `computeACWR` and `computeMonotony`, the same functions the loader
// called, run again in the browser over a load series with one day added.
//
// Three rules keep it honest, and they are the reason this is not a slider that
// draws a plausible line:
//
//  1. THE BASELINE IS RECOMPUTED, NOT READ OFF THE PAGE. The panel's headline
//     ACWR may be the WHOOP-STRAIN ratio: `preferredACWR` falls back to it
//     whenever the TRIMP one is insufficient, and the two are different series.
//     Comparing a TRIMP-based simulation against a strain-based headline would
//     print a "change" that is mostly the difference between two instruments.
//     So `before` is computed from the same array `after` is, and the caller is
//     told which series that was.
//
//  2. AN UNREADABLE BASELINE SIMULATES NOTHING. `computeACWR` returns a fully
//     populated ZERO struct under fourteen days. Simulating on top of that
//     yields a confident ratio built on nothing, which is the exact failure the
//     whole page is written to avoid. `simulate` returns null instead.
//
//  3. THE SESSION IS THE UNIT, NOT THE TRIMP. Nobody knows what "adding 120
//     TRIMP" means. The presets below are sessions with a duration and an
//     intensity, and the load is derived from them — so the control reads "the
//     long easy day" and the arithmetic (105 min × easy = 105 load) stays
//     visible underneath it.
import { computeACWR, type ACWRResult, type LoadDay } from './analytics/acwr';
import { computeMonotony, type MonotonyResult } from './analytics/monotony';
import type { MetricResult } from './analytics/types';

/**
 * TRIMP for one session, from its duration and how hard it was.
 *
 * Banister's TRIMP is minutes × a heart-rate factor, and the factor is roughly
 * 1 at easy aerobic through to ~3.5 at threshold. These are the multipliers the
 * site's own zone weighting implies, rounded to one decimal — enough to make a
 * preset comparable with a real day's load, and stated rather than hidden so a
 * reader can see the simulation is arithmetic, not a prediction.
 */
export const INTENSITY_LOAD_PER_MIN = {
  easy: 1,
  steady: 1.7,
  hard: 3.2,
} as const;

export type SessionIntensity = keyof typeof INTENSITY_LOAD_PER_MIN;

export interface SessionPreset {
  id: string;
  label: string;
  minutes: number;
  intensity: SessionIntensity;
  /** What this session is, in the page's own vocabulary. */
  note: string;
}

/**
 * The four sessions the ranked moves actually argue for, plus a rest day.
 *
 * Deliberately short. A dozen presets is a configuration screen; four is a
 * question with four answers, which is what a what-if should be.
 */
export const SESSION_PRESETS: SessionPreset[] = [
  {
    id: 'rest',
    label: 'Nothing',
    minutes: 0,
    intensity: 'easy',
    note: 'A rest day. The ratio still moves, because the chronic base keeps decaying.',
  },
  {
    id: 'easy-hour',
    label: 'An easy hour',
    minutes: 60,
    intensity: 'easy',
    note: 'A short, genuinely easy outing — the kind that adds volume without cost.',
  },
  {
    id: 'long-easy',
    label: 'The long easy day',
    minutes: 105,
    intensity: 'easy',
    note: '12–15 km at hike heart rate. The session the ranked moves put first.',
  },
  {
    id: 'hard-effort',
    label: 'One hard effort',
    minutes: 50,
    intensity: 'hard',
    note: 'A targeted segment attempt with a warm-up round it. The highest cost on the list.',
  },
];

/** The load one preset puts on the day, rounded the way a daily TRIMP is. */
export function sessionLoad(preset: Pick<SessionPreset, 'minutes' | 'intensity'>): number {
  return Math.round(preset.minutes * INTENSITY_LOAD_PER_MIN[preset.intensity]);
}

export interface SimulatedMetric<T> {
  before: T;
  after: T;
}

export interface WhatIfResult {
  /** The load the simulated session added on the day after the last real one. */
  addedLoad: number;
  /** The day the simulated session was placed on, `YYYY-MM-DD`. */
  day: string;
  acwr: SimulatedMetric<ACWRResult> | null;
  monotony: SimulatedMetric<MonotonyResult> | null;
  /**
   * Which series this ran over, said out loud. The headline ACWR on the page
   * may be the Whoop-strain fallback, in which case these numbers are a
   * different instrument and the UI must say so rather than imply the headline
   * moved.
   */
  basis: 'trimp-load-days';
}

/** The day after the last one in the series, in the series' own `YYYY-MM-DD`. */
function nextDay(last: string): string {
  const parsed = new Date(`${last}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return last;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/** Monotony reads the last seven days of load. */
const MONOTONY_WINDOW = 7;

/**
 * Run the real analytics over the real series with one day added.
 *
 * Returns null when there is nothing honest to say: no series at all, or a
 * baseline the analytic itself refuses to report on. A `null` here is what
 * keeps the panel showing "needs 28 days" instead of a simulated band.
 */
export function simulate(
  loadDays: readonly LoadDay[] | null | undefined,
  preset: Pick<SessionPreset, 'minutes' | 'intensity'>,
): WhatIfResult | null {
  if (!loadDays?.length) return null;

  const sorted = [...loadDays].sort((a, b) => a.date.localeCompare(b.date));
  const addedLoad = sessionLoad(preset);
  const day = nextDay(sorted[sorted.length - 1].date);
  const withSession: LoadDay[] = [...sorted, { date: day, load: addedLoad }];

  // Rule 1: `before` comes from the SAME array `after` does, so the delta is
  // the session and nothing else.
  const acwrBefore = computeACWR(sorted);
  const acwrAfter = computeACWR(withSession);
  const acwr = readable(acwrBefore) && readable(acwrAfter)
    ? { before: acwrBefore.value, after: acwrAfter.value }
    : null;

  const window = (days: LoadDay[]) => days.slice(-MONOTONY_WINDOW).map((d) => d.load);
  const monoBefore = computeMonotony(window(sorted));
  const monoAfter = computeMonotony(window(withSession));
  const monotony = readable(monoBefore) && readable(monoAfter)
    ? { before: monoBefore.value, after: monoAfter.value }
    : null;

  // Nothing readable on either instrument is nothing worth showing.
  if (!acwr && !monotony) return null;

  return { addedLoad, day, acwr, monotony, basis: 'trimp-load-days' };
}

/** Rule 2 in one predicate: a zero struct is not a reading. */
function readable<T>(result: MetricResult<T> | null | undefined): result is MetricResult<T> {
  return !!result && result.sufficiency !== 'insufficient';
}
