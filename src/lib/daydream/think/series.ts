// src/lib/daydream/think/series.ts
//
// The owner's daily series, as `correlate` reads them.
//
// Moved here from the retired nightly sweep (`stats/sweep.ts`, deleted in P4a)
// when the think loop became the only thing that asks for a correlation. What
// survived is exactly what `correlate` uses: the explicit metric list, the
// pairs that are true by definition, the day-feature read and the column pick.

import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamDayFeatures } from '$lib/db/schema';
import { DEFAULT_SUBJECT } from '../types';

/**
 * The columns a correlation is allowed to look at.
 *
 * An explicit list rather than "every numeric column", because a feature store
 * gains columns and an automatic read would silently start testing identifiers,
 * counts of counts and anything else that happens to be a number.
 *
 * The movement columns (time at home, time out, distinct places, first out,
 * last home) left this list in P4a (2026-09-25) with the trail that fed them.
 */
export const SWEEP_METRICS = [
  'steps',
  'activeEnergyKj',
  'meanHeartRate',
  'hrvMs',
  'restingHeartRate',
  'recoveryScore',
  'strain',
  'sleepMinutes',
  'sleepPerformance',
  'sleepEfficiency',
  'disturbanceCount',
  'workouts',
  'activeMinutes',
  'activityDistanceM',
  'calendarEvents',
  'calendarBusyMinutes',
  'verifiedSpendMinor',
] as const;
export type SweepMetric = (typeof SWEEP_METRICS)[number];

/**
 * Pairs that are true by definition and therefore worth nothing.
 *
 * "Your resting heart rate tracks your recovery score" is not a discovery, it
 * is a restatement of how Whoop computes recovery. Listed as PAIRS so the
 * refusal can be explained; `ENTANGLED` below is the lookup form.
 */
export const ENTANGLED_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ['recoveryScore', 'restingHeartRate'],
    ['recoveryScore', 'hrvMs'],
    ['recoveryScore', 'sleepPerformance'],
    ['sleepMinutes', 'sleepPerformance'],
    ['sleepMinutes', 'sleepEfficiency'],
    ['sleepPerformance', 'sleepEfficiency'],
    ['activeMinutes', 'workouts'],
    ['calendarEvents', 'calendarBusyMinutes'],
    ['activeMinutes', 'activityDistanceM'],
    ['activeMinutes', 'steps'],
    ['steps', 'activeEnergyKj'],
    ['steps', 'activityDistanceM'],
    ['strain', 'activeEnergyKj'],
    ['strain', 'meanHeartRate'],
    ['meanHeartRate', 'activeEnergyKj'],
    // The pair that proved the list was incomplete. The first real sweep
    // returned four "findings" and all four were this one — same-day, lagged
    // each way — because HRV and resting heart rate are two readings of one
    // overnight autonomic measurement, not two facts that happen to move
    // together. Left in, it would have been the system's first ever discovery,
    // stated four times, and completely empty.
    ['hrvMs', 'restingHeartRate'],
] as const;

const ENTANGLED: ReadonlySet<string> = new Set(
  ENTANGLED_PAIRS.map((p) => p.slice().sort().join('|')),
);

/** The list is written in feature-store column names; a `feature:` prefix is
 *  tolerated so a namespaced key reads the same. */
const bare = (k: string) => (k.startsWith('feature:') ? k.slice('feature:'.length) : k);

export function isEntangled(a: string, b: string): boolean {
  return ENTANGLED.has([bare(a), bare(b)].sort().join('|'));
}

type Row = Record<string, unknown>;

/** Pull the aligned daily series, oldest first. */
export async function loadSeries(
  opts: { windowDays?: number; subject?: string; now?: Date } = {},
): Promise<Row[]> {
  const windowDays = opts.windowDays ?? 120;
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - windowDays * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // The subject filter was ACCEPTED AND DROPPED. It never bit, because the
  // feature builder only ever wrote `john` — but the day-feature table is
  // keyed (subject, day), so the moment a second person had rows this would
  // have correlated a pooled series carrying two values for every date, with
  // no error and a plausible-looking r. Latent, and load-bearing the instant
  // hypotheses became per-person.
  const subject = opts.subject ?? DEFAULT_SUBJECT;

  return db
    .select()
    .from(daydreamDayFeatures)
    .where(
      and(
        eq(daydreamDayFeatures.subject, subject),
        gte(daydreamDayFeatures.day, iso(from)),
        lte(daydreamDayFeatures.day, iso(now)),
      ),
    )
    .orderBy(daydreamDayFeatures.day) as unknown as Promise<Row[]>;
}

/** Exported so the drill-through can show the SAME numbers the test used,
 *  rather than a second reading of the table that might disagree with it. */
export function column(rows: Row[], key: string): Array<number | null> {
  return rows.map((r) => {
    const v = r[key];
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  });
}
