// src/lib/daydream/stats/series.ts
//
// The owner's aligned daily series, and which metric pairs are worth testing.
// What survives of the nightly correlation sweep (retired in P4 of the
// 2026-09-25 simplification): the think loop's `correlate()` tool reads the
// same feature-store columns, skips the same tautologies, and corrects over
// the pairs it actually ran.

import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamDayFeatures } from '$lib/db/schema';
import { DEFAULT_SUBJECT } from '../types';

/**
 * The columns a sweep is allowed to look at, and how each should be read.
 *
 * An explicit list rather than "every numeric column", because a feature store
 * gains columns and an automatic sweep would silently start testing identifiers,
 * counts of counts and anything else that happens to be a number. It also keeps
 * the pair count knowable: this list is the m in the correction.
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
  'minutesAtHome',
  'minutesOut',
  'distinctPlaces',
  'firstOutAtMins',
  'lastHomeAtMins',
  'calendarEvents',
  'calendarBusyMinutes',
  'verifiedSpendMinor',
] as const;
export type SweepMetric = (typeof SWEEP_METRICS)[number];

/**
 * Pairs that are true by definition and therefore worth nothing.
 *
 * Reporting "your resting heart rate tracks your recovery score" is not a
 * discovery, it is a restatement of how Whoop computes recovery. The existing
 * health correlations service keeps the same kind of list for the same reason;
 * without one, the top of every ranking is occupied by tautologies and the real
 * findings never surface.
 */
/**
 * Pairs that are true by definition, as PAIRS.
 *
 * `ENTANGLED` below is a lookup set of joined keys, which answers "is this pair
 * worthless?" and cannot be read back out as a list. The ponder prompt needs
 * the list: told only the vocabulary, the model spent two of the four metric
 * slots on its very first lead pairing `sleepMinutes` with `sleepEfficiency`
 * and `recoveryScore` with `restingHeartRate` — both skipped at test time, so
 * two of its six pairs were dead before they were run.
 *
 * One source, two shapes, so the prompt and the sweep can never disagree about
 * what counts as a tautology.
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
    ['minutesAtHome', 'minutesOut'],
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

/** The list is written in feature-store column names; a `feature:*` key is
 *  the same column namespaced. Strip the namespace so either spelling works. */
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
