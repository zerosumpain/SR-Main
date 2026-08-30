// The last word on the page.
//
// Nine sections of instruments earn one paragraph that says what it all comes
// to, and — the part that matters — what to do if only one thing changes. Same
// discipline as ledes.ts: every clause below is traceable to a number that was
// passed in, an `insufficient` MetricResult is never read for its value, and
// when there is nothing to say the module returns null rather than a
// confident-sounding nothing.
//
// The headline is two lines because the design renders the second at 22%
// opacity: line one is what is going right, line two is what is not. If
// nothing is wrong, line two says so rather than inventing a fault.

import type { MetricResult } from './analytics/types';
import { ACWR_BANDS, type ACWRResult } from './analytics/acwr';
import type { MonotonyResult } from './analytics/monotony';
import type { PolarisedResult } from './analytics/polarised';
import { SRI_TARGET } from './analytics/sri';
import type { CircadianResult } from './analytics/circadian';
import type { AutonomicResult } from './analytics/autonomic-balance';
import {
  SLEEP_DEBT_FLAG_MIN,
  STRAIN_BALANCE_FLAG,
  type RecoveryDebtResult,
} from './analytics/recovery-debt';
import type { VO2Result } from './analytics/vo2max-percentile';
import type { Move, MoveId } from './moves';
import type { Experiment } from './experiments';

export interface ReviewRow {
  label: string;
  /** "15 SEP 2026" — the design sets these in mono caps. */
  date: string;
  /** The same day as YYYY-MM-DD, for sorting and for a `datetime` attribute. */
  iso: string;
}

export interface Verdict {
  /** Two lines. The page renders the second at 22% opacity. */
  headline: [string, string];
  body: string[];
  pullQuoteLabel: string;
  pullQuote: string;
  pullQuoteFollow: string;
  reviews: ReviewRow[];
}

export interface VerdictInput {
  today: string;
  moves: Move[];
  experiments: Experiment[];
  readiness: { score: number; label: string } | null;
  acwr: MetricResult<ACWRResult> | null;
  monotony: MetricResult<MonotonyResult> | null;
  polarised: MetricResult<PolarisedResult> | null;
  sri: MetricResult<number> | null;
  circadian: MetricResult<CircadianResult> | null;
  autonomic: MetricResult<AutonomicResult> | null;
  recoveryDebt: MetricResult<RecoveryDebtResult> | null;
  vo2: MetricResult<VO2Result> | null;
  efficiency: { latest7: number | null; baseline28: number | null } | null;
  volume: { weekKm: number; medianKm: number } | null;
  rhr: { latest7: number | null; baseline28: number | null } | null;
  /** `StatsResponse.personalRecords` — the capability already on the clock. */
  records: Array<{ label: string; value: number; unit: string; date: string }> | null;
}

/** How many panels the instrument deck carries. The pull quote counts against it. */
export const INSTRUMENT_COUNT = 8;
/** The VO₂max slope is a 90-day regression, so it is checked a window out. */
const VO2_REVIEW_DAYS = 90;
/** A big day needs booking far enough ahead to train for. Five months, month-end. */
const BIG_DAY_MONTHS = 5;
const CIRCADIAN_FLAG_HOURS = 1;
const VOLUME_LOW_PCT = 0.8;

/** What each move sounds like as an instruction rather than a title. */
const IMPERATIVE: Record<MoveId, string> = {
  'sleep-window': 'Go to bed at the same time',
  'long-easy-day': 'Put one long, dull walk in the diary every week',
  'polarised-mix': 'Add one genuinely hard effort a week',
  'book-big-day': 'Put a named objective in the diary with a date on it',
  'hold-and-watch': 'Change nothing, and watch the tripwires',
};

export function computeVerdict(i: VerdictInput): Verdict | null {
  const good = goodClauses(i);
  const bad = badClauses(i);
  if (!good.length && !bad.length && !i.moves.length) return null;

  const headline: [string, string] = [openingWord(i), problemWord(i)];

  const body: string[] = [];
  if (good.length) {
    body.push(`The engine is in good order. ${upper(sentence(good))}.`);
  }
  if (bad.length) {
    body.push(`${bad.length > 1 ? 'The inputs are the problem' : 'There is one thing in the way'}. ${upper(sentence(bad))}.`);
  }

  return {
    headline,
    body,
    pullQuoteLabel: 'IF ONLY ONE THING CHANGES',
    ...pullQuote(i),
    reviews: reviews(i),
  };
}

// ——— the headline ————————————————————————————————————————————————

function openingWord(i: VerdictInput): string {
  if (usable(i.vo2) && (i.vo2.value.band === 'excellent' || i.vo2.value.band === 'superior')) {
    return 'CAPABLE.';
  }
  if (usable(i.acwr) && i.acwr.value.zone === 'optimal') return 'BUILDING.';
  if (i.readiness && i.readiness.score >= 70) return 'READY.';
  return 'STEADY.';
}

function problemWord(i: VerdictInput): string {
  const sleepShort =
    (usable(i.recoveryDebt) && i.recoveryDebt.value.sleepDebtMin > SLEEP_DEBT_FLAG_MIN) ||
    (usable(i.sri) && i.sri.value < SRI_TARGET) ||
    (usable(i.circadian) && Math.abs(i.circadian.value.driftHours) >= CIRCADIAN_FLAG_HOURS);
  if (sleepShort) return 'UNDER-SLEPT.';
  if (usable(i.recoveryDebt) && i.recoveryDebt.value.strainRecoveryBalance > STRAIN_BALANCE_FLAG) {
    return 'OVERREACHED.';
  }
  if (usable(i.acwr) && i.acwr.value.ratio < ACWR_BANDS.detraining) return 'DETRAINING.';
  if (volumeThin(i)) return 'UNDER-DONE.';
  if (usable(i.monotony) && i.monotony.value.band === 'high') return 'TOO ALIKE.';
  if (usable(i.acwr) && i.acwr.value.ratio < ACWR_BANDS.undertraining) return 'UNDER-LOADED.';
  return 'AND HOLDING.';
}

// ——— the body ————————————————————————————————————————————————————

function goodClauses(i: VerdictInput): string[] {
  const out: string[] = [];
  if (i.rhr?.baseline28 != null && i.rhr.baseline28 > 0) {
    out.push(`resting heart rate is on a ${Math.round(i.rhr.baseline28)} bpm baseline`);
  }
  if (usable(i.vo2) && i.vo2.value.percentile > 0) {
    out.push(`cardio fitness reads ${i.vo2.value.band} at the ${ordinal(Math.round(i.vo2.value.percentile))} percentile`);
  }
  if (usable(i.monotony) && i.monotony.value.band !== 'high' && i.monotony.value.sd > 0) {
    out.push(`the week has genuine hard/easy shape at a monotony of ${i.monotony.value.monotony.toFixed(1)}`);
  }
  const big = bigDay(i);
  if (big) out.push(big);
  return out;
}

function badClauses(i: VerdictInput): string[] {
  const out: string[] = [];
  if (usable(i.recoveryDebt) && i.recoveryDebt.value.sleepDebtMin > SLEEP_DEBT_FLAG_MIN) {
    out.push(
      `sleep is ${Math.round(i.recoveryDebt.value.sleepDebtMin)} minutes down on its own need over the fortnight`,
    );
  }
  if (usable(i.sri) && i.sri.value < SRI_TARGET) {
    out.push(`irregular with it at an SRI of ${Math.round(i.sri.value)} against a target of ${SRI_TARGET}`);
  }
  if (usable(i.circadian) && Math.abs(i.circadian.value.driftHours) >= CIRCADIAN_FLAG_HOURS) {
    const mins = Math.round(Math.abs(i.circadian.value.driftHours) * 60);
    out.push(
      `the sleep midpoint has slid ${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m ${i.circadian.value.driftHours > 0 ? 'later' : 'earlier'}`,
    );
  }
  if (volumeThin(i)) {
    out.push(
      `weekly volume is ${trim(i.volume!.weekKm)} km against a ${trim(i.volume!.medianKm)} km median`,
    );
  }
  if (usable(i.acwr) && i.acwr.value.ratio < ACWR_BANDS.undertraining) {
    out.push(`acute load sits at ${i.acwr.value.ratio.toFixed(2)} of its own chronic base`);
  }
  if (usable(i.autonomic) && i.autonomic.value.score < 50) {
    out.push(`the nervous system reads ${Math.round(i.autonomic.value.score)} out of 100`);
  }
  return out;
}

/** "a 40.8 km day with 1,723 m of climb already in the legs from May" */
function bigDay(i: VerdictInput): string | null {
  const rows = i.records ?? [];
  const longest = rows.find((r) => r.label === 'Longest Run' && r.value > 0);
  if (!longest) return null;
  const climb = rows.find((r) => r.label === 'Most Elevation' && r.value > 0);
  const when = monthName(longest.date);
  const climbPart = climb ? ` with ${group(Math.round(climb.value))} m of climb` : '';
  return `there is a ${longest.value} ${longest.unit} day${climbPart} already in the legs${when ? ` from ${when}` : ''}`;
}

// ——— the pull quote ——————————————————————————————————————————————

function pullQuote(i: VerdictInput): { pullQuote: string; pullQuoteFollow: string } {
  const top = i.moves.filter((m) => m.id !== 'hold-and-watch').slice(0, 2);
  if (!top.length) {
    return {
      pullQuote: 'Change nothing. Nothing on this page is asking to be fixed.',
      pullQuoteFollow: 'The tripwires are the whole system until one of them trips.',
    };
  }
  const quote = top.map((m, k) => (k === 0 ? IMPERATIVE[m.id] : `Then ${lower(IMPERATIVE[m.id])}`)).join('. ') + '.';
  const touched = new Set(top.flatMap((m) => m.instruments));
  const n = touched.size;
  const follow = n
    ? `${top.length === 1 ? 'That move touches' : 'Those two moves touch'} ${words(n)} of the ${words(INSTRUMENT_COUNT)} instruments. Everything else on this page is either downstream of them or already good enough to leave alone.`
    : 'Everything else on this page is either downstream of that or already good enough to leave alone.';
  return { pullQuote: quote, pullQuoteFollow: follow };
}

// ——— the review rows —————————————————————————————————————————————

function reviews(i: VerdictInput): ReviewRow[] {
  const rows: ReviewRow[] = [];

  // One row per experiment, dated on the last day of its own window.
  const labels = new Map<string, string>();
  for (const x of i.experiments) {
    labels.set(x.code, `Review ${x.code}`);
  }
  // A queued experiment starts when its LAST gate finishes, so that gate's
  // review row carries the handover rather than inventing a date of its own.
  for (const x of i.experiments) {
    const lastGate = x.gatedBy[x.gatedBy.length - 1];
    if (!lastGate || !labels.has(lastGate)) continue;
    labels.set(lastGate, `${labels.get(lastGate)} · start ${x.code}`);
  }
  for (const x of i.experiments) {
    if (x.gatedBy.length) continue; // dated by its gate, not by itself
    const iso = addDays(i.today, x.durationDays - x.dayCount);
    rows.push({ label: labels.get(x.code) as string, date: caps(iso), iso });
  }

  if (usable(i.vo2)) {
    const iso = addDays(i.today, VO2_REVIEW_DAYS);
    rows.push({ label: 'VO₂max slope check', date: caps(iso), iso });
  }

  if (i.moves.some((m) => m.id === 'book-big-day')) {
    const iso = monthEnd(i.today, BIG_DAY_MONTHS);
    rows.push({ label: 'Big day, booked by', date: caps(iso), iso });
  }

  return rows.sort((a, b) => a.iso.localeCompare(b.iso));
}

// ——— helpers ————————————————————————————————————————————————————

function usable<T>(m: MetricResult<T> | null | undefined): m is MetricResult<T> {
  return !!m && m.sufficiency !== 'insufficient';
}

function volumeThin(i: VerdictInput): boolean {
  return !!i.volume && i.volume.medianKm > 0 && i.volume.weekKm < i.volume.medianKm * VOLUME_LOW_PCT;
}

function sentence(parts: string[]): string {
  const kept = parts.filter(Boolean);
  if (kept.length <= 1) return kept[0] ?? '';
  return `${kept.slice(0, -1).join(', ')} and ${kept[kept.length - 1]}`;
}

function upper(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function lower(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function trim(km: number): string {
  const s = km.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

function group(n: number): string {
  return n.toLocaleString('en-GB');
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function words(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "15 SEP 2026" — the mono caps the review rows are set in. */
function caps(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function monthName(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  return MONTHS_LONG[Number(iso.slice(5, 7)) - 1] ?? null;
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
}

/** The last day of the month `months` ahead of `day`. */
function monthEnd(day: string, months: number): string {
  const d = new Date(day + 'T00:00:00Z');
  // Day 0 of the following month IS the last day of the target month.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0)).toISOString().slice(0, 10);
}
