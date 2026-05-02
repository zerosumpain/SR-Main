import { db } from '$lib/db';
import { whoopRecovery, whoopSleep, whoopCycles, appleHealthMetrics } from '$lib/db/schema';
import { gte, eq, and } from 'drizzle-orm';
import type { Correlation } from './series-30d-service';

const WINDOW_DAYS = 90;
const MIN_PAIRS = 10;
const MIN_R = 0.3;
const STRONG_N = 30;
const STRONG_R = 0.5;
const MAX_RESULTS = 4;

type MetricKey = 'rec' | 'hrv' | 'rhr' | 'slept' | 'strain' | 'steps' | 'sleepScore';

type DayRow = {
  date: string;
  rec: number | null;
  hrv: number | null;
  rhr: number | null;
  slept: number | null;
  strain: number | null;
  steps: number | null;
  sleepScore: number | null;
};

function isoDate(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

const METRIC_KEYS: MetricKey[] = ['rec', 'hrv', 'rhr', 'slept', 'strain', 'steps', 'sleepScore'];

// Definitionally entangled pairs (canonicalised, sorted, joined). Same key
// blocks both same-day {A,B} and lagged (A,B)/(B,A).
const DENYLIST: ReadonlySet<string> = new Set([
  ['rec', 'hrv'].sort().join('|'),
  ['rec', 'rhr'].sort().join('|'),
  ['sleepScore', 'slept'].sort().join('|'),
]);

function denyKey(a: MetricKey, b: MetricKey): string {
  return [a, b].sort().join('|');
}

// "Lower is better" — used to phrase the effect direction. RHR is the only
// one in this set today.
const LOWER_IS_BETTER: ReadonlySet<MetricKey> = new Set(['rhr']);

const NOUN: Record<MetricKey, { cause: string; effect: string; level: string }> = {
  rec: { cause: 'recovery', effect: 'recovery', level: 'high-recovery' },
  hrv: { cause: 'HRV', effect: 'HRV', level: 'high-HRV' },
  rhr: { cause: 'resting HR', effect: 'resting HR', level: 'high-RHR' },
  slept: { cause: 'sleep', effect: 'sleep duration', level: 'long-sleep' },
  strain: { cause: 'strain', effect: 'strain', level: 'high-strain' },
  steps: { cause: 'steps', effect: 'steps', level: 'high-step' },
  sleepScore: { cause: 'sleep score', effect: 'sleep score', level: 'high-sleep-score' },
};

function rawValueFor(d: DayRow, key: MetricKey): number | null {
  return d[key];
}

function bucket(n: number, r: number): 'STRONG' | 'MAYBE' | 'NOISE' {
  const a = Math.abs(r);
  if (n >= STRONG_N && a >= STRONG_R) return 'STRONG';
  if (n >= MIN_PAIRS && a >= MIN_R) return 'MAYBE';
  return 'NOISE';
}

function fmtR(r: number): string {
  const sign = r >= 0 ? '+' : '−';
  return `r = ${sign}${Math.abs(r).toFixed(2)}`;
}

type PairResult = {
  cor: Correlation;
  rank: number;
};

function sameDayPair(ordered: DayRow[], a: MetricKey, b: MetricKey): PairResult | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const d of ordered) {
    const va = rawValueFor(d, a);
    const vb = rawValueFor(d, b);
    if (va == null || vb == null || va <= 0 || vb <= 0) continue;
    xs.push(va);
    ys.push(vb);
  }
  if (xs.length < MIN_PAIRS) return null;
  const r = pearson(xs, ys);
  if (Math.abs(r) < MIN_R) return null;
  const direction = r >= 0 ? 'tracks with' : 'inverts with';
  const cor: Correlation = {
    cause: NOUN[a].cause.toUpperCase(),
    effect: `${direction} ${NOUN[b].effect}`,
    num: fmtR(r),
    conf: `same-day · n=${xs.length}`,
    confidence: bucket(xs.length, r),
  };
  return { cor, rank: Math.abs(r) * Math.sqrt(xs.length) };
}

function laggedPair(ordered: DayRow[], a: MetricKey, b: MetricKey): PairResult | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const va = rawValueFor(ordered[i], a);
    const vb = rawValueFor(ordered[i + 1], b);
    if (va == null || vb == null || va <= 0 || vb <= 0) continue;
    xs.push(va);
    ys.push(vb);
  }
  if (xs.length < MIN_PAIRS) return null;
  const r = pearson(xs, ys);
  if (Math.abs(r) < MIN_R) return null;
  const goodForB = LOWER_IS_BETTER.has(b) ? r <= 0 : r >= 0;
  const direction = goodForB ? 'lifts' : 'tanks';
  const cor: Correlation = {
    cause: `After a ${NOUN[a].level} day`,
    effect: `Next-day ${NOUN[b].effect} ${direction}`,
    num: fmtR(r),
    conf: `lagged · n=${xs.length}`,
    confidence: bucket(xs.length, r),
  };
  return { cor, rank: Math.abs(r) * Math.sqrt(xs.length) };
}

export function discoverCorrelations(ordered: DayRow[]): Correlation[] {
  const results: PairResult[] = [];

  // Same-day: unordered pairs, each evaluated once.
  for (let i = 0; i < METRIC_KEYS.length; i++) {
    for (let j = i + 1; j < METRIC_KEYS.length; j++) {
      const a = METRIC_KEYS[i];
      const b = METRIC_KEYS[j];
      if (DENYLIST.has(denyKey(a, b))) continue;
      const r = sameDayPair(ordered, a, b);
      if (r) results.push(r);
    }
  }

  // Lagged: ordered pairs, both directions.
  for (const a of METRIC_KEYS) {
    for (const b of METRIC_KEYS) {
      if (a === b) continue;
      if (DENYLIST.has(denyKey(a, b))) continue;
      const r = laggedPair(ordered, a, b);
      if (r) results.push(r);
    }
  }

  results.sort((x, y) => y.rank - x.rank);
  return results.slice(0, MAX_RESULTS).map((p) => p.cor);
}

export async function getCorrelations(): Promise<Correlation[]> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - WINDOW_DAYS * 86400;

  const [recoveryRows, sleepRows, cycleRows, stepRows] = await Promise.all([
    db
      .select()
      .from(whoopRecovery)
      .where(gte(whoopRecovery.createdDate, windowStart))
      .orderBy(whoopRecovery.createdDate),
    db
      .select()
      .from(whoopSleep)
      .where(and(gte(whoopSleep.startDate, windowStart - 86400), eq(whoopSleep.nap, false)))
      .orderBy(whoopSleep.startDate),
    db
      .select()
      .from(whoopCycles)
      .where(gte(whoopCycles.startDate, windowStart))
      .orderBy(whoopCycles.startDate),
    db
      .select({ date: appleHealthMetrics.date, value: appleHealthMetrics.value })
      .from(appleHealthMetrics)
      .where(
        and(
          gte(appleHealthMetrics.date, windowStart),
          eq(appleHealthMetrics.metricName, 'step_count'),
        ),
      ),
  ]);

  const days = new Map<string, DayRow>();
  function ensure(date: string): DayRow {
    let d = days.get(date);
    if (!d) {
      d = {
        date,
        rec: null,
        hrv: null,
        rhr: null,
        slept: null,
        strain: null,
        steps: null,
        sleepScore: null,
      };
      days.set(date, d);
    }
    return d;
  }

  for (const r of recoveryRows) {
    const d = ensure(isoDate(r.createdDate));
    d.rec = r.recoveryScore;
    d.hrv = r.hrvRmssd;
    d.rhr = r.restingHeartRate;
  }
  for (const s of sleepRows) {
    const d = ensure(isoDate(s.endDate));
    d.slept = (s.totalLight + s.totalSlowWave + s.totalRem) / 3600000;
    d.sleepScore = s.sleepPerformance;
  }
  for (const c of cycleRows) {
    const d = ensure(isoDate(c.startDate));
    // Same scale fix as the 30d series: legacy rows landed at strain*100.
    d.strain = c.strain > 22 ? c.strain / 100 : c.strain;
  }
  // Sum per-bucket step deltas, then unscale (ingest stores value ×100).
  const stepsByDate = new Map<string, number>();
  for (const r of stepRows) {
    if (r.date == null || r.value == null) continue;
    const k = isoDate(r.date);
    stepsByDate.set(k, (stepsByDate.get(k) ?? 0) + r.value);
  }
  for (const [k, v] of stepsByDate) ensure(k).steps = Math.round(v / 100);

  const ordered = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  return discoverCorrelations(ordered);
}
