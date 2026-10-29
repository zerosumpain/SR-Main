// src/lib/daydream/think/correlate.ts
//
// A correlation the model ASKS for, instead of one a sweep found.
//
// The nightly sweep tested every pair of every metric — 39,759 of them — and
// its top survivors were identities (rain against precipitation). The think
// loop inverts that: a cycle that has a reason to want a relationship asks for
// that one, gets a number, and has to cite the card. The instruments are the
// sweep's own (`stats/tests.ts`): Spearman on pairwise-complete days, a p-value
// on the serial-correlation-adjusted n, and Benjamini-Hochberg — here across
// the tests THIS cycle has run, which is the honest m for a model that may ask
// three or four times before it writes anything.
//
// Owner series only: `daydream_day_features` for `john`. The day store is the
// one place every unit has already been normalised (`features/normalise.ts`),
// so nothing here re-derives a Whoop millisecond or an Apple ×100.

import { SWEEP_METRICS, column, isEntangled, loadSeries } from '../stats/series';
import { benjaminiHochberg, compareGroups, correlate as testPair, partialCorrelate, MIN_GROUP, MIN_PAIRS, type TestResult } from '../stats/tests';
import { EXTRA_HEADINGS, EXTRA_METRICS, isExtraMetric, joinExtras, loadExtraSeries, type ExtraMetric } from './extra-series.server';
import { metricHeading } from '../features/metrics';
import { DEFAULT_SUBJECT } from '../types';
import { freshness, staleLine, type Ledger, type LedgerEntry } from './ledger';

export const CORRELATE_DEFAULT_DAYS = 90;
export const CORRELATE_MIN_DAYS = 21;
export const CORRELATE_MAX_DAYS = 365;

/** Every key `correlate` and `compare_days` accept: the feature store's
 *  columns and the extra series (`extra-series.server.ts`). */
export const CORRELATE_METRICS: readonly string[] = [...SWEEP_METRICS, ...EXTRA_METRICS];
export type CorrelateMetric = (typeof SWEEP_METRICS)[number] | ExtraMetric;

export function isCorrelateMetric(key: string): key is CorrelateMetric {
  return CORRELATE_METRICS.includes(key);
}

function heading(key: string): string {
  return isExtraMetric(key) ? EXTRA_HEADINGS[key] : metricHeading(key);
}

/** Feature rows with any extras the keys name joined on. */
async function loadRows(keys: string[], days: number, subject: string, now?: Date): Promise<Array<Record<string, unknown>>> {
  const rows = await loadSeries({ windowDays: days, subject, now });
  const extras = new Map<string, Map<string, number>>();
  // Extras are the owner's; another subject gets the feature store alone.
  if (subject === DEFAULT_SUBJECT) {
    for (const k of new Set(keys.filter(isExtraMetric))) extras.set(k, await loadExtraSeries(k, days, now));
  }
  return joinExtras(rows, extras);
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
  /** Tested recently with no new data since (`ledger.ts`): a note on it would
   *  repeat itself, and the audit refuses a correlate note resting on it. */
  stale?: boolean;
}

/** The cycle's view of the ledger: read once at the start, and the fresh tests
 *  it ran, which the cycle writes back at the end (`ledger.server.ts`). */
export interface LedgerSession {
  ledger: Ledger;
  recorded: LedgerEntry[];
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
    return `Refused: ${bad.map((k) => `"${k}"`).join(', ')} is not a day metric. The metrics are: ${CORRELATE_METRICS.join(', ')}.`;
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
  const lines = [`${heading(a)} against ${heading(b)}, owner's last ${days} days, Spearman:`];
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

/** Why a control cannot be used, or null. */
export function controlRefusal(a: string, b: string, control: string): string | null {
  if (!isCorrelateMetric(control)) return `Refused: control "${control}" is not a day metric. The metrics are: ${CORRELATE_METRICS.join(', ')}.`;
  if (control === a || control === b) return 'Refused: the control must be a third metric, not one of the pair.';
  return null;
}

/**
 * The pair again with a third metric held fixed (partial Spearman, same day).
 * The partial test joins the cycle's tally like any other. PURE.
 */
export function withControl(out: CorrelateOutcome, rows: Array<Record<string, unknown>>, a: string, b: string, control: string): CorrelateOutcome {
  const res = partialCorrelate(column(rows, a), column(rows, b), column(rows, control));
  if (res.n < MIN_PAIRS) {
    return { ...out, text: `${out.text}\nHolding ${heading(control)} fixed: only ${res.n} days with all three — no result.` };
  }
  const moved = Math.abs(res.r) < Math.abs(res.rawR) * 0.5 ? 'most of the link goes away — the third factor explains it' : Math.abs(res.r) >= Math.abs(res.rawR) * 0.8 ? 'the link holds — the third factor does not explain it' : 'the link weakens';
  const label = `same day, holding ${control} fixed`;
  return {
    ...out,
    tests: [...out.tests, { label, result: { r: res.r, p: res.p, n: res.n } }],
    text: `${out.text}\nHolding ${heading(control)} fixed (partial Spearman over ${res.n} days with all three): r ${fmt(res.r)} against ${fmt(res.rawR)} without, p ${fmt(res.p, 3)} — ${moved}.`,
  };
}

/**
 * The tool, with per-cycle state for the correction.
 *
 * One correlator per cycle. Every call adds its tests to the tally and the card
 * reports q across ALL of them, so the fourth pair a model tries does not read
 * as though it were the only one.
 */
export function createCorrelator(opts: { subject?: string; now?: Date; ledger?: LedgerSession } = {}) {
  const tally: Array<{ item: string; p: number }> = [];
  return async function correlateTool(args: Record<string, unknown>): Promise<CorrelateOutcome> {
    const a = typeof args.a === 'string' ? args.a.trim() : '';
    const b = typeof args.b === 'string' ? args.b.trim() : '';
    const rawDays = Number(args.days);
    const days = Number.isFinite(rawDays)
      ? Math.min(CORRELATE_MAX_DAYS, Math.max(CORRELATE_MIN_DAYS, Math.round(rawDays)))
      : CORRELATE_DEFAULT_DAYS;
    // Guards before the query: a refused pair costs nothing.
    const control = typeof args.control === 'string' && args.control.trim() ? args.control.trim() : null;
    const refused = refusal(a, b) ?? (control ? controlRefusal(a, b, control) : null);
    if (refused) return { ok: false, tests: [], text: refused };

    const rows = await loadRows(control ? [a, b, control] : [a, b], days, opts.subject ?? DEFAULT_SUBJECT, opts.now);
    let out = correlateRows(rows, a, b, days);
    if (!out.ok) return out;
    if (control) out = withControl(out, rows, a, b, control);

    // BH hands results back in input order, so this call's tests are the tail.
    const first = tally.length;
    for (const t of out.tests) tally.push({ item: t.label, p: t.result.p });
    const mine = benjaminiHochberg(tally).slice(first);
    const qLine = mine.map((c) => `${c.item} q ${fmt(c.qValue, 3)}`).join(', ');
    const text = `${out.text}\nCorrected across the ${tally.length} test(s) this cycle has run (Benjamini-Hochberg): ${qLine}. Treat q above 0.1 as not established.`;
    if (!opts.ledger) return { ...out, text };

    // Has this been asked before, with no more to learn since?
    const n = Math.max(...out.tests.map((t) => t.result.n));
    const now = opts.now ?? new Date();
    const f = freshness(opts.ledger.ledger, a, b, days, n, now);
    if (!f.fresh) return { ...out, stale: true, text: `${text}\n${staleLine(f)}` };
    const entry: LedgerEntry = {
      a,
      b,
      days,
      n,
      tests: out.tests.map((t) => ({ label: t.label, r: t.result.r, n: t.result.n, p: t.result.p })),
      at: now.toISOString(),
    };
    opts.ledger.recorded.push(entry);
    const before = f.prior ? `\nLast tested ${f.prior.at.slice(0, 10)} over ${f.prior.n} paired days — say what moved, if anything.` : '';
    return { ...out, text: `${text}${before}` };
  };
}

/** The tool's description, with the vocabulary in it — the lesson the leads
 *  frontier paid for: a model told to "pick a metric" without the list names
 *  the labels it read off the cards. */
export function correlateDescription(): string {
  return (
    "Test whether two of the owner's daily series move together, over his day-feature store (Spearman, same day and one day lagged, corrected across this cycle). " +
    `Needs ${MIN_PAIRS}+ paired days. Metric keys, copied exactly: ${CORRELATE_METRICS.join(', ')}. ` +
    'Pairs related by definition (e.g. recoveryScore and hrvMs) are refused. ' +
    'Give "control" to hold a third metric fixed (partial correlation) — use it whenever a third thing could drive both, e.g. calendarBusyMinutes behind sleep and mood.'
  );
}

// ── compare_days ────────────────────────────────────────────────────────────
//
// One metric on two kinds of day: with family or not, away or home, a busy
// diary or a clear one, a red recovery or not. The question a correlation
// cannot ask well, because "with family" is mostly yes-or-no.

export interface CompareArgs {
  metric: string;
  when: string;
  /** Condition holds when `when` is above this; else below `below`; else above its median. */
  above: number | null;
  below: number | null;
  /** Compare the metric the day AFTER the condition. */
  nextDay: boolean;
  days: number;
}

export function parseCompareArgs(args: Record<string, unknown>): CompareArgs | string {
  const metric = typeof args.metric === 'string' ? args.metric.trim() : '';
  const when = typeof args.when === 'string' ? args.when.trim() : '';
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  const bad = [metric, when].filter((k) => !isCorrelateMetric(k));
  if (bad.length) return `Refused: ${bad.map((k) => `"${k}"`).join(', ')} is not a day metric. The metrics are: ${CORRELATE_METRICS.join(', ')}.`;
  if (metric === when) return 'Refused: compare a metric across days split by a DIFFERENT metric.';
  if (isEntangled(metric, when)) return `Refused: ${metric} and ${when} are related by definition.`;
  const rawDays = Number(args.days);
  const days = Number.isFinite(rawDays) ? Math.min(CORRELATE_MAX_DAYS, Math.max(CORRELATE_MIN_DAYS, Math.round(rawDays))) : CORRELATE_DEFAULT_DAYS;
  return { metric, when, above: num(args.above), below: num(args.below), nextDay: args.nextDay === true, days };
}

/** Run one comparison over loaded rows. PURE. */
export function compareRows(rows: Array<Record<string, unknown>>, a: CompareArgs): { ok: boolean; p: number | null; text: string } {
  const split = column(rows, a.when);
  let values = column(rows, a.metric);
  let threshold: number;
  let words: string;
  if (a.above != null) {
    threshold = a.above;
    words = `${heading(a.when)} above ${threshold}`;
  } else if (a.below != null) {
    threshold = a.below;
    words = `${heading(a.when)} below ${threshold}`;
  } else {
    const known = split.filter((v): v is number => v != null).sort((x, y) => x - y);
    if (known.length < MIN_GROUP * 2) return { ok: false, p: null, text: `Too few days with ${heading(a.when)} recorded (${known.length}) to split.` };
    threshold = known[Math.floor(known.length / 2)];
    words = `${heading(a.when)} above its median (${fmt(threshold, 1)})`;
  }
  const cond = split.map((v) => (v == null ? null : a.below != null && a.above == null ? v < threshold : v > threshold));
  if (a.nextDay) values = [...values.slice(1), null];
  const res = compareGroups(values, cond);
  const head = `${heading(a.metric)}${a.nextDay ? ' the next day' : ''} on days with ${words} against the other days, owner's last ${a.days} days:`;
  if (!res) {
    const yes = cond.filter((c) => c === true).length;
    const no = cond.filter((c) => c === false).length;
    return { ok: false, p: null, text: `${head}\n  Too few days on one side (${yes} with, ${no} without; ${MIN_GROUP} needed each) — no result.` };
  }
  const pct = Math.round(res.probabilityHigher * 100);
  return {
    ok: true,
    p: res.p,
    text: [
      head,
      `  median ${fmt(res.medianIn, 1)} on ${res.nIn} such days against ${fmt(res.medianOut, 1)} on ${res.nOut} others; such a day reads higher ${pct}% of the time; Mann–Whitney p ${fmt(res.p, 3)}.`,
      'A difference between kinds of day, not a cause: the days differ in other ways too.',
    ].join('\n'),
  };
}

/** The tool. Shares nothing with the correlator but the vocabulary. */
export function createDayComparer(opts: { subject?: string; now?: Date } = {}) {
  const tally: Array<{ item: string; p: number }> = [];
  return async function compareDaysTool(args: Record<string, unknown>): Promise<string> {
    const parsed = parseCompareArgs(args);
    if (typeof parsed === 'string') return parsed;
    const rows = await loadRows([parsed.metric, parsed.when], parsed.days, opts.subject ?? DEFAULT_SUBJECT, opts.now);
    const out = compareRows(rows, parsed);
    if (!out.ok || out.p == null) return out.text;
    tally.push({ item: `${parsed.metric} by ${parsed.when}`, p: out.p });
    const q = benjaminiHochberg(tally).at(-1)!.qValue;
    return `${out.text}\nCorrected across the ${tally.length} comparison(s) this cycle (Benjamini-Hochberg): q ${fmt(q, 3)}. Treat q above 0.1 as not established.`;
  };
}

export function compareDaysDescription(): string {
  return (
    'Compare one daily metric on two kinds of day: days when another metric is above (or below) a threshold against the rest — e.g. recoveryScore on days with familyMinutes above 120, mood on days with calendarBusyMinutes above 300, sleepMinutes after awayOvernight above 0.5. ' +
    `Median on each side and a Mann–Whitney p, ${MIN_GROUP}+ days each side. Metric keys: ${CORRELATE_METRICS.join(', ')}. ` +
    'Omit above/below to split at the median. nextDay:true reads the metric the day after.'
  );
}
