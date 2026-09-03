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

import { and, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamDayFeatures, daydreamObservations } from '$lib/db/schema';
import { DEFAULT_SUBJECT, errMsg } from '../types';
import { listSweepableSignals } from '../signals/registry';
import { benjaminiHochberg, correlate, DEFAULT_FDR, MIN_PAIRS, type Corrected } from './tests';

/**
 * How many signals one sweep may test.
 *
 * The registry is open by design, so this number has to exist: 400 signals is
 * roughly 240,000 tests once both lag directions are counted, and while that is
 * computationally fine it makes the correction so severe that a real finding
 * would need to be enormous to survive. Ranked by observed days, so the
 * best-attested signals are the ones that get tested.
 *
 * Whatever is dropped is REPORTED on the pulse. A cap that silently bounds
 * coverage reads afterwards as "we looked at everything", which is the failure
 * this whole statistics layer exists to avoid.
 */
export const MAX_SWEEP_SIGNALS = 120;

/**
 * Above this, two series are the same instrument twice.
 *
 * The hand-written ENTANGLED list below cannot survive an open registry — you
 * cannot enumerate pairs among signals nobody has discovered yet. There are
 * already two entities reporting the same room: `sensor.john_s_echo_temperature`
 * and `sensor.john_s_echo_temperature_2`, both 21.8 °C. Correlated, they would
 * return r = 1.0 and sit at the top of every ranking forever.
 *
 * So the list keeps the cases that need domain knowledge — recovery against
 * resting heart rate is tautological at r ≈ 0.6, and no threshold catches that
 * — and this catches the mechanical duplicates the list cannot know about.
 */
export const NEAR_DUPLICATE_R = 0.99;

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

/** The list is written in feature-store column names; the registry namespaces
 *  them as `feature:*`. Strip the namespace so one list serves both callers. */
const bare = (k: string) => (k.startsWith('feature:') ? k.slice('feature:'.length) : k);

export function isEntangled(a: string, b: string): boolean {
  return ENTANGLED.has([bare(a), bare(b)].sort().join('|'));
}

export interface Finding {
  /** Signal keys — `feature:hrvMs`, `ha:sensor.john_s_echo_temperature`. */
  a: string;
  b: string;
  /** Human labels, resolved at sweep time so a finding reads without a lookup. */
  aLabel?: string;
  bLabel?: string;
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
  /** Signals that cleared the observed-day gate. */
  signalsConsidered: number;
  /** Signals actually tested, after the cap. */
  signalsSwept: number;
  /** Pairs suppressed as the same instrument read twice. Reported, because a
   *  suppression is a decision and an unexplained absence is not. */
  nearDuplicates: number;
  /** Eligible signals dropped for never moving over the window. */
  constantSignals: number;
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

/**
 * Daily values for named SIGNAL keys, for a hypothesis that names a signal
 * rather than a day-feature column. Keyed day → value; the caller aligns them
 * to the feature store's days so the two kinds of metric pair up.
 */
export async function loadSignalColumns(
  keys: string[],
  opts: { windowDays?: number; subject?: string; now?: Date } = {},
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (keys.length === 0) return out;
  const windowDays = opts.windowDays ?? 120;
  const subject = opts.subject ?? DEFAULT_SUBJECT;
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - windowDays * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const rows = await db
    .select({ day: daydreamObservations.day, signalKey: daydreamObservations.signalKey, value: daydreamObservations.valueMean })
    .from(daydreamObservations)
    .where(
      and(
        gte(daydreamObservations.day, iso(from)),
        lte(daydreamObservations.day, iso(now)),
        inArray(daydreamObservations.signalKey, keys),
        or(eq(daydreamObservations.subject, subject), eq(daydreamObservations.subject, 'household')),
      ),
    );
  for (const r of rows) {
    if (r.value == null) continue;
    let m = out.get(r.signalKey);
    if (!m) out.set(r.signalKey, (m = new Map()));
    m.set(String(r.day), r.value);
  }
  return out;
}

/** Whether a column carries any variation at all. Two distinct values is the
 *  minimum that can produce a correlation of any kind. */
function isConstant(column: Array<number | null>): boolean {
  let seen: number | null = null;
  for (const v of column) {
    if (v == null) continue;
    if (seen == null) seen = v;
    else if (v !== seen) return false;
  }
  return true;
}

/**
 * The aligned daily matrix, one column per registered signal.
 *
 * Household signals ride alongside the subject's own. Indoor temperature
 * belongs to the house, not to anybody in it, so correlating John's HRV against
 * it means joining a `household` row to a `john` row on the day — which is the
 * whole reason `subject` is on the observation and not implied by the signal.
 *
 * A day with no reading has no row, and stays null here. Absent is never zero.
 */
export async function loadSignalMatrix(
  opts: { windowDays?: number; subject?: string; now?: Date; minDays?: number; maxSignals?: number } = {},
): Promise<{
  days: string[];
  series: Map<string, Array<number | null>>;
  labels: Map<string, string>;
  considered: number;
  /** Eligible signals dropped for never moving. Reported, not hidden. */
  constant: number;
}> {
  const windowDays = opts.windowDays ?? 120;
  const subject = opts.subject ?? DEFAULT_SUBJECT;
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - windowDays * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const eligible = await listSweepableSignals(opts.minDays ?? MIN_PAIRS);
  const labels = new Map(eligible.map((sig) => [sig.key, sig.label]));

  // Best-attested first, then capped — see MAX_SWEEP_SIGNALS.
  const chosen = [...eligible]
    .sort((a, b) => b.observedDays - a.observedDays || a.key.localeCompare(b.key))
    .slice(0, Math.max(1, opts.maxSignals ?? MAX_SWEEP_SIGNALS));

  if (chosen.length === 0) {
    return { days: [], series: new Map(), labels, considered: eligible.length, constant: 0 };
  }

  const rows = await db
    .select({
      day: daydreamObservations.day,
      signalKey: daydreamObservations.signalKey,
      value: daydreamObservations.valueMean,
    })
    .from(daydreamObservations)
    .where(
      and(
        gte(daydreamObservations.day, iso(from)),
        lte(daydreamObservations.day, iso(now)),
        inArray(daydreamObservations.signalKey, chosen.map((c) => c.key)),
        or(eq(daydreamObservations.subject, subject), eq(daydreamObservations.subject, 'household')),
      ),
    );

  const dayset = new Set<string>();
  const byKeyDay = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const day = String(r.day);
    dayset.add(day);
    let m = byKeyDay.get(r.signalKey);
    if (!m) byKeyDay.set(r.signalKey, (m = new Map()));
    if (r.value != null) m.set(day, r.value);
  }

  const days = [...dayset].sort();
  const series = new Map<string, Array<number | null>>();
  let constant = 0;
  for (const c of chosen) {
    const m = byKeyDay.get(c.key);
    const column = days.map((d) => m?.get(d) ?? null);
    // A series that never moves cannot correlate with anything: `pearson`
    // returns 0 for zero variance, so it produces no finding — but it still
    // costs a test against every other signal, and m is the denominator the
    // false-discovery correction divides by. The first live discovery run
    // registered fourteen connectivity sensors all sitting at 1.0; left in,
    // they would have made every real finding harder to detect while being
    // incapable of producing one.
    if (isConstant(column)) {
      constant++;
      continue;
    }
    series.set(c.key, column);
  }

  return { days, series, labels, considered: eligible.length, constant };
}

/**
 * Test every eligible pair, same-day and one-day-lagged, and correct once
 * across the whole set.
 *
 * ONE correction over ALL tests, including the lagged ones — correcting
 * same-day and lagged separately would be two families and would understate m
 * by half. The lag direction is asymmetric on purpose: a predicts b tomorrow is
 * a different claim from b predicts a tomorrow, and both are tested.
 *
 * Since 2026-08-27 the columns come from the SIGNAL REGISTRY rather than a
 * hand-written list, so a sensor discovered this morning is swept the moment it
 * has enough observed days — with no edit here. The list used to be justified as
 * "this list is the m in the correction"; m is now the number of pairs actually
 * tested, which is recorded on every result and is the honest version of the
 * same guarantee.
 */
export async function runSweep(
  opts: { windowDays?: number; subject?: string; fdr?: number; now?: Date; maxSignals?: number } = {},
): Promise<SweepResult> {
  const windowDays = opts.windowDays ?? 120;
  const fdr = opts.fdr ?? DEFAULT_FDR;
  const now = opts.now ?? new Date();
  const maxSignals = Math.max(1, opts.maxSignals ?? MAX_SWEEP_SIGNALS);
  const errors: string[] = [];

  const { days, series, labels, considered, constant } = await loadSignalMatrix({
    windowDays,
    subject: opts.subject ?? DEFAULT_SUBJECT,
    now,
    maxSignals,
  });

  const result: SweepResult = {
    windowDays,
    from: days[0] ?? '',
    to: days[days.length - 1] ?? '',
    testsRun: 0,
    fdr,
    naiveHits: 0,
    signalsConsidered: considered,
    signalsSwept: series.size,
    nearDuplicates: 0,
    constantSignals: constant,
    findings: [],
    errors,
  };

  const capped = Math.max(0, considered - series.size - constant);
  if (capped > 0) {
    errors.push(`capped at ${maxSignals} signals; ${capped} eligible were not tested`);
  }

  if (days.length < MIN_PAIRS) {
    errors.push(`only ${days.length} days of observations; needs ${MIN_PAIRS}`);
    return result;
  }
  if (series.size < 2) {
    errors.push(`only ${series.size} signal(s) have ${MIN_PAIRS}+ observed days`);
    return result;
  }

  const keys = [...series.keys()];
  const candidates: Array<{ item: Finding; p: number }> = [];

  const consider = (a: string, b: string, lagDays: number, xs: Array<number | null>, ys: Array<number | null>) => {
    const res = correlate(xs, ys);
    if (res.n < MIN_PAIRS) return;
    // The same instrument twice is not a discovery. Suppressed here rather than
    // filtered from the findings afterwards, so it never enters m either —
    // counting a test we always intended to discard would inflate the
    // correction against the findings that are real.
    if (Math.abs(res.r) >= NEAR_DUPLICATE_R) {
      result.nearDuplicates++;
      return;
    }
    candidates.push({
      item: {
        a,
        b,
        aLabel: labels.get(a),
        bLabel: labels.get(b),
        lagDays,
        r: res.r,
        p: res.p,
        qValue: 1,
        n: res.n,
      },
      p: res.p,
    });
  };

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i];
      const b = keys[j];
      if (isEntangled(a, b)) continue;

      const xs = series.get(a)!;
      const ys = series.get(b)!;

      consider(a, b, 0, xs, ys);
      // a today against b tomorrow, and the reverse. Two distinct claims.
      consider(a, b, 1, xs.slice(0, -1), ys.slice(1));
      consider(b, a, 1, ys.slice(0, -1), xs.slice(1));
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
    `${s.signalsSwept} signals, ${s.testsRun} tests over ${s.from}..${s.to}; ` +
    `${s.naiveHits} would pass an uncorrected p<0.05, ` +
    `${s.findings.length} survive FDR ${s.fdr}` +
    // Said out loud rather than left as an absence: a suppressed pair is a
    // decision the sweep made, and the count is how anyone would notice it
    // making that decision too often.
    (s.nearDuplicates ? `; ${s.nearDuplicates} suppressed as duplicate instruments` : '') +
    (s.constantSignals ? `; ${s.constantSignals} never moved` : '') +
    (s.signalsConsidered - s.signalsSwept - s.constantSignals > 0
      ? `; ${s.signalsConsidered - s.signalsSwept - s.constantSignals} eligible signals not tested (cap ${MAX_SWEEP_SIGNALS})`
      : '')
  );
}
