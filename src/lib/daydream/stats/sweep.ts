// src/lib/daydream/stats/sweep.ts
//
// Running every pair, and keeping a record of having run them.
//
// The ledger is not bookkeeping. A false-discovery correction is only honest if
// it knows how many tests were actually performed, and the classic way to cheat
// it — without meaning to — is to run a sweep, look at the winners, run a
// slightly different sweep tomorrow, and correct each one in isolation. Thirty
// days of that is thirty independent corrections over the same hypotheses, and
// the "one in ten" guarantee quietly becomes meaningless.
//
// So every sweep is recorded whole: how many pairs were tested, at what FDR,
// over what window, and what survived. A finding that cannot point at the sweep
// that produced it does not get quoted.

import { and, gte, lte } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamDayFeatures } from '$lib/db/schema';
import { DEFAULT_SUBJECT, errMsg } from '../types';
import { benjaminiHochberg, correlate, DEFAULT_FDR, MIN_PAIRS, type Corrected } from './tests';

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
const ENTANGLED: ReadonlySet<string> = new Set(
  [
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
  ].map((p) => p.slice().sort().join('|')),
);

export function isEntangled(a: string, b: string): boolean {
  return ENTANGLED.has([a, b].sort().join('|'));
}

export interface Finding {
  a: SweepMetric;
  b: SweepMetric;
  /** 0 for same-day; 1 means a predicts b one day later. */
  lagDays: number;
  r: number;
  p: number;
  qValue: number;
  n: number;
}

export interface SweepResult {
  windowDays: number;
  from: string;
  to: string;
  /** m — the number of tests the correction was applied over. */
  testsRun: number;
  fdr: number;
  /** How many would have been reported by an uncorrected p < 0.05 sweep. This
   *  is recorded precisely so the correction's effect is visible rather than
   *  asserted. */
  naiveHits: number;
  findings: Finding[];
  errors: string[];
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

  return db
    .select()
    .from(daydreamDayFeatures)
    .where(
      and(
        gte(daydreamDayFeatures.day, iso(from)),
        lte(daydreamDayFeatures.day, iso(now)),
      ),
    )
    .orderBy(daydreamDayFeatures.day) as unknown as Promise<Row[]>;
}

function column(rows: Row[], key: string): Array<number | null> {
  return rows.map((r) => {
    const v = r[key];
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  });
}

/**
 * Test every eligible pair, same-day and one-day-lagged, and correct once
 * across the whole set.
 *
 * ONE correction over ALL tests, including the lagged ones — correcting
 * same-day and lagged separately would be two families and would understate m
 * by half. The lag direction is asymmetric on purpose: a predicts b tomorrow is
 * a different claim from b predicts a tomorrow, and both are tested.
 */
export async function runSweep(
  opts: { windowDays?: number; subject?: string; fdr?: number; now?: Date } = {},
): Promise<SweepResult> {
  const windowDays = opts.windowDays ?? 120;
  const fdr = opts.fdr ?? DEFAULT_FDR;
  const now = opts.now ?? new Date();
  const errors: string[] = [];

  const rows = await loadSeries({ windowDays, subject: opts.subject ?? DEFAULT_SUBJECT, now });
  const result: SweepResult = {
    windowDays,
    from: rows.length ? String(rows[0].day) : '',
    to: rows.length ? String(rows[rows.length - 1].day) : '',
    testsRun: 0,
    fdr,
    naiveHits: 0,
    findings: [],
    errors,
  };

  if (rows.length < MIN_PAIRS) {
    errors.push(`only ${rows.length} days of features; needs ${MIN_PAIRS}`);
    return result;
  }

  const cols = new Map<string, Array<number | null>>();
  for (const m of SWEEP_METRICS) cols.set(m, column(rows, m));

  const candidates: Array<{ item: Finding; p: number }> = [];

  for (let i = 0; i < SWEEP_METRICS.length; i++) {
    for (let j = i + 1; j < SWEEP_METRICS.length; j++) {
      const a = SWEEP_METRICS[i];
      const b = SWEEP_METRICS[j];
      if (isEntangled(a, b)) continue;

      const xs = cols.get(a)!;
      const ys = cols.get(b)!;

      const same = correlate(xs, ys);
      if (same.n >= MIN_PAIRS) {
        candidates.push({
          item: { a, b, lagDays: 0, r: same.r, p: same.p, qValue: 1, n: same.n },
          p: same.p,
        });
      }

      // a today against b tomorrow, and the reverse. Two distinct claims.
      const aLead = correlate(xs.slice(0, -1), ys.slice(1));
      if (aLead.n >= MIN_PAIRS) {
        candidates.push({
          item: { a, b, lagDays: 1, r: aLead.r, p: aLead.p, qValue: 1, n: aLead.n },
          p: aLead.p,
        });
      }
      const bLead = correlate(ys.slice(0, -1), xs.slice(1));
      if (bLead.n >= MIN_PAIRS) {
        candidates.push({
          item: { a: b, b: a, lagDays: 1, r: bLead.r, p: bLead.p, qValue: 1, n: bLead.n },
          p: bLead.p,
        });
      }
    }
  }

  result.testsRun = candidates.length;
  result.naiveHits = candidates.filter((c) => c.p < 0.05).length;

  const corrected: Array<Corrected<Finding>> = benjaminiHochberg(candidates, fdr);
  result.findings = corrected
    .filter((c) => c.significant)
    .map((c) => ({ ...c.item, qValue: c.qValue }))
    .sort((x, y) => x.qValue - y.qValue);

  return result;
}

/** A one-line, honest description of what a sweep did. */
export function describeSweep(s: SweepResult): string {
  if (s.errors.length && s.findings.length === 0) return s.errors[0];
  return (
    `${s.testsRun} tests over ${s.from}..${s.to}; ` +
    `${s.naiveHits} would pass an uncorrected p<0.05, ` +
    `${s.findings.length} survive FDR ${s.fdr}`
  );
}
