// src/lib/daydream/think/correlate.ts
//
// A correlation the model ASKS for, instead of one a sweep found.
//
// The nightly sweep tested every pair of every metric — 39,759 of them — and
// its top survivors were identities (rain against precipitation). The think
// loop inverts that: a cycle that has a reason to want a relationship asks for
// that one, gets a number, and has to cite the card. The instruments are the
// sweep's own (`think/stats.ts`): Spearman on pairwise-complete days, a p-value
// on the serial-correlation-adjusted n, and Benjamini-Hochberg — here across
// the tests THIS cycle has run, which is the honest m for a model that may ask
// three or four times before it writes anything.
//
// Owner series only: `daydream_day_features` for `john`. The day store is the
// one place every unit has already been normalised (`features/normalise.ts`),
// so nothing here re-derives a Whoop millisecond or an Apple ×100.

import { SWEEP_METRICS, column, isEntangled, loadSeries } from './series';
import { benjaminiHochberg, correlate as testPair, MIN_PAIRS, type TestResult } from './stats';
import { metricHeading } from '../features/metrics';
import { DEFAULT_SUBJECT } from '../types';

export const CORRELATE_DEFAULT_DAYS = 90;
export const CORRELATE_MIN_DAYS = 21;
export const CORRELATE_MAX_DAYS = 365;

export type CorrelateMetric = (typeof SWEEP_METRICS)[number];

export function isCorrelateMetric(key: string): key is CorrelateMetric {
  return (SWEEP_METRICS as readonly string[]).includes(key);
}

export interface PairTest {
  label: string;
  result: TestResult;
}

export interface CorrelateOutcome {
  ok: boolean;
  /** The card text: what was asked, what came back, what it cannot say. */
  text: string;
  /** The raw tests, for BH across the cycle. Empty when refused. */
  tests: PairTest[];
}

/**
 * The pure half: two aligned daily columns in, same-day and next-day tests out.
 *
 * Next-day is `a` today against `b` tomorrow — the direction a model usually
 * means by "does X affect Y". Both are always run, so a question asked one way
 * round cannot quietly hide the other.
 */
export function testColumns(a: Array<number | null>, b: Array<number | null>): PairTest[] {
  return [
    { label: 'same day', result: testPair(a, b, 'spearman') },
    { label: 'a leads b by one day', result: testPair(a.slice(0, -1), b.slice(1), 'spearman') },
  ];
}

/** "moves with", "moves against", or nothing worth a verb. */
function direction(r: number): string {
  if (Math.abs(r) < 0.1) return 'no visible association';
  return r > 0 ? 'moves with' : 'moves against';
}

function fmt(n: number, dp = 2): string {
  return Number.isFinite(n) ? n.toFixed(dp) : 'n/a';
}

/** Why a pair cannot be tested at all, or null. Checked before any query. */
export function refusal(a: string, b: string): string | null {
  if (!isCorrelateMetric(a) || !isCorrelateMetric(b)) {
    const bad = [a, b].filter((k) => !isCorrelateMetric(k));
    return `Refused: ${bad.map((k) => `"${k}"`).join(', ')} is not a day-feature metric. The metrics are: ${SWEEP_METRICS.join(', ')}.`;
  }
  if (a === b) return 'Refused: a metric correlates perfectly with itself.';
  if (isEntangled(a, b)) {
    return `Refused: ${a} and ${b} are related by definition (one is computed from the other), so a correlation between them says nothing.`;
  }
  return null;
}

/**
 * Refuse, or run, one requested pair over already-loaded rows. Pure, so every
 * guard is testable without a database.
 */
export function correlateRows(
  rows: Array<Record<string, unknown>>,
  a: string,
  b: string,
  days: number,
): CorrelateOutcome {
  const refused = refusal(a, b);
  if (refused) return { ok: false, tests: [], text: refused };
  const tests = testColumns(column(rows, a), column(rows, b));
  const lines = [`${metricHeading(a)} against ${metricHeading(b)}, owner's last ${days} days, Spearman:`];
  let usable = false;
  for (const t of tests) {
    if (t.result.n < MIN_PAIRS) {
      lines.push(`  ${t.label}: only ${t.result.n} paired days — below the ${MIN_PAIRS} needed, no result.`);
      continue;
    }
    usable = true;
    lines.push(
      `  ${t.label}: r ${fmt(t.result.r)} over ${t.result.n} paired days, p ${fmt(t.result.p, 3)} — ${direction(t.result.r)}.`,
    );
  }
  if (!usable) {
    return { ok: false, tests: [], text: [...lines, 'Too few days where both were recorded to say anything.'].join('\n') };
  }
  lines.push('An association on observational days, not a cause.');
  return { ok: true, tests: tests.filter((t) => t.result.n >= MIN_PAIRS), text: lines.join('\n') };
}

/**
 * The tool, with per-cycle state for the correction.
 *
 * One correlator per cycle. Every call adds its tests to the tally and the card
 * reports q across ALL of them, so the fourth pair a model tries does not read
 * as though it were the only one.
 */
export function createCorrelator(opts: { subject?: string; now?: Date } = {}) {
  const tally: Array<{ item: string; p: number }> = [];
  return async function correlateTool(args: Record<string, unknown>): Promise<CorrelateOutcome> {
    const a = typeof args.a === 'string' ? args.a.trim() : '';
    const b = typeof args.b === 'string' ? args.b.trim() : '';
    const rawDays = Number(args.days);
    const days = Number.isFinite(rawDays)
      ? Math.min(CORRELATE_MAX_DAYS, Math.max(CORRELATE_MIN_DAYS, Math.round(rawDays)))
      : CORRELATE_DEFAULT_DAYS;
    // Guards before the query: a refused pair costs nothing.
    const refused = refusal(a, b);
    if (refused) return { ok: false, tests: [], text: refused };

    const rows = await loadSeries({ windowDays: days, subject: opts.subject ?? DEFAULT_SUBJECT, now: opts.now });
    const out = correlateRows(rows, a, b, days);
    if (!out.ok) return out;

    // BH hands results back in input order, so this call's tests are the tail.
    const first = tally.length;
    for (const t of out.tests) tally.push({ item: t.label, p: t.result.p });
    const mine = benjaminiHochberg(tally).slice(first);
    const qLine = mine.map((c) => `${c.item} q ${fmt(c.qValue, 3)}`).join(', ');
    return {
      ...out,
      text: `${out.text}\nCorrected across the ${tally.length} test(s) this cycle has run (Benjamini-Hochberg): ${qLine}. Treat q above 0.1 as not established.`,
    };
  };
}

/** The tool's description, with the vocabulary in it — the lesson the leads
 *  frontier paid for: a model told to "pick a metric" without the list names
 *  the labels it read off the cards. */
export function correlateDescription(): string {
  return (
    "Test whether two of the owner's daily series move together, over his day-feature store (Spearman, same day and one day lagged, corrected across this cycle). " +
    `Needs ${MIN_PAIRS}+ paired days. Metric keys, copied exactly: ${SWEEP_METRICS.join(', ')}. ` +
    'Pairs related by definition (e.g. recoveryScore and hrvMs) are refused.'
  );
}
