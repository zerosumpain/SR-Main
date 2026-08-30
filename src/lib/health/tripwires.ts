// The nine numbers worth being told about.
//
// A dashboard that shows everything every day trains you to look at none of it.
// These are the watched numbers: each one has a trigger, and the only thing the
// page has to say about it is whether it has been crossed.
//
// Three rules, and they are the whole module:
//
//  1. THE TRIGGERS ARE THE REPO'S OWN. Where a threshold already exists as an
//     exported constant it is imported, never retyped — `SLEEP_DEBT_FLAG_MIN`,
//     `STRAIN_BALANCE_FLAG`, `ACWR_BANDS`, `GETTABLE_GAP_PCT`. Where no constant
//     existed, one is declared HERE and nowhere else.
//  2. A NUMBER NOBODY CAN READ HAS NOT TRIPPED, AND SAYS SO. An `insufficient`
//     MetricResult carries a fully-populated ZERO struct — a confident
//     `sleepDebtMin: 0` — so every reader checks sufficiency first and an
//     unreadable wire renders `readable: false` with an em dash, never as good
//     news.
//  3. CLOSE IS A REAL STATE, NOT A NEAR MISS. Each wire declares where "close"
//     starts, and the reason is in the comment beside it.
//
// All copy here is DERIVED. No LLM, same as ledes.ts.

import type { MetricResult } from './analytics/types';
import type { DayPoint } from './analytics/rolling';
import { ACWR_BANDS, type ACWRResult } from './analytics/acwr';
import {
  SLEEP_DEBT_FLAG_MIN,
  STRAIN_BALANCE_FLAG,
  type RecoveryDebtResult,
} from './analytics/recovery-debt';
import type { VO2Result } from './analytics/vo2max-percentile';
import { GETTABLE_GAP_PCT } from '$lib/trails/segments/form';

export type TripwireState = 'TRIPPED' | 'CLOSE' | 'ARMED';

export const TRIPWIRE_IDS = [
  'sleep-debt',
  'weekly-volume',
  'acwr',
  'hrv-crossing',
  'resting-hr',
  'recovery-reds',
  'strain-balance',
  'vo2-slope',
  'segment-pb',
] as const;

export type TripwireId = (typeof TRIPWIRE_IDS)[number];

export interface Tripwire {
  id: TripwireId;
  state: TripwireState;
  /** Column 2, line 1 — what is being watched. */
  signal: string;
  /** Column 2, line 2 — the window it is watched over. */
  window: string;
  /** Column 3 — the threshold, in the words a human would use. */
  trigger: string;
  /** Column 4 — where the number is now, formatted. `—` when unreadable. */
  now: string;
  /** Column 5 — what it means and what to do. */
  meaning: string;
  /** False when the window behind the wire is too thin to read at all. */
  readable: boolean;
}

/** Structurally a `TrendSeries` (`$lib/trails/physio-service`), restated so
 *  this module needs nothing from the database layer. */
export interface TripwireTrend {
  daily: DayPoint[];
  rolling7: DayPoint[];
  latest7: number | null;
  baseline28: number | null;
}

export interface GettableSummary {
  /** Segments improving AND inside the gettable gap. */
  gettable: number;
  /** Segments whose form direction reads improving. */
  improving: number;
  /** Segments with enough efforts for a form read at all. */
  withForm: number;
  /** The closest one, for the row's copy. */
  nearest: { name: string; gapPct: number } | null;
}

export interface TripwireInput {
  /** YYYY-MM-DD. Injected so every row is testable against a fixed clock. */
  today: string;
  recoveryDebt?: MetricResult<RecoveryDebtResult> | null;
  acwr?: MetricResult<ACWRResult> | null;
  vo2?: MetricResult<VO2Result> | null;
  hrv?: TripwireTrend | null;
  rhr?: TripwireTrend | null;
  /** Daily recovery score 0–100, ascending. */
  recovery?: DayPoint[] | null;
  /** Twelve weeks oldest first, the last being the week in progress. */
  weeks?: Array<{ weekStart: string; totalDistanceM: number }> | null;
  segments?: GettableSummary | null;
}

// ——— triggers that had no home before this file ————————————————————

/** Below this share of the twelve-week median, the week is a hole. */
export const VOLUME_FLOOR_PCT = 50;
/** Between here and the floor, it is worth saying out loud. */
const VOLUME_CLOSE_PCT = 65;
/** A 7-day HRV mean this far under its 28-day baseline is a real crossing
 *  rather than the day-to-day swing HRV always has. */
const HRV_NOISE_PCT = 5;
/** Consecutive days below the baseline before the crossing counts. */
const HRV_CROSSING_DAYS = 2;
/** Resting heart rate this far over its own baseline is the signal. */
const RHR_TRIGGER_BPM = 4;
/** Held for this many days — three, not one: one is a Tuesday. */
const RHR_TRIGGER_DAYS = 3;
/** Whoop's own red band tops out here. */
const RECOVERY_RED_MAX = 33;
/** Reds in a row before it is a pattern. */
const RECOVERY_RED_DAYS = 3;
/** Monthly VO₂max slope past which the direction is real, not noise. */
const VO2_SLOPE_TRIGGER = -0.2;
/** Fractions of a trigger at which a wire reads CLOSE. */
const DEBT_CLOSE_FRACTION = 0.8;
const BALANCE_CLOSE_FRACTION = 0.8;
const VO2_CLOSE_FRACTION = 0.9;

// ——— the table ————————————————————————————————————————————————————

export function computeTripwires(input: TripwireInput): Tripwire[] {
  return [
    sleepDebt(input),
    weeklyVolume(input),
    acwrWire(input),
    hrvCrossing(input),
    restingHr(input),
    recoveryReds(input),
    strainBalance(input),
    vo2Slope(input),
    segmentPb(input),
  ];
}

function unread(
  id: TripwireId,
  signal: string,
  window: string,
  trigger: string,
  meaning: string,
): Tripwire {
  return { id, signal, window, trigger, state: 'ARMED', now: '—', meaning, readable: false };
}

// 1 —————————————————————————————————————————————————————————————————
function sleepDebt(i: TripwireInput): Tripwire {
  const base = ['sleep-debt', 'Sleep debt', '14d cumulative', `> ${SLEEP_DEBT_FLAG_MIN} min`] as const;
  if (!usable(i.recoveryDebt)) {
    return unread(...base, 'Needs a fortnight of nights with a sleep-need reading behind them.');
  }
  const minutes = Math.round(i.recoveryDebt.value.sleepDebtMin);
  const over = minutes / SLEEP_DEBT_FLAG_MIN;
  const state: TripwireState =
    minutes > SLEEP_DEBT_FLAG_MIN
      ? 'TRIPPED'
      : minutes >= SLEEP_DEBT_FLAG_MIN * DEBT_CLOSE_FRACTION
        ? 'CLOSE'
        : 'ARMED';
  const meaning =
    state === 'TRIPPED'
      ? `${over.toFixed(1)} times over the site's own flag. Nightly shortfall against Whoop's sleep need, summed — the fix is a bedtime, not a lie-in.`
      : state === 'CLOSE'
        ? `Inside ${SLEEP_DEBT_FLAG_MIN - minutes} minutes of the flag. Two short nights would cross it.`
        : `${SLEEP_DEBT_FLAG_MIN - minutes} minutes of headroom against the flag.`;
  return { id: base[0], signal: base[1], window: base[2], trigger: base[3], state, now: `${minutes} min`, meaning, readable: true };
}

// 2 —————————————————————————————————————————————————————————————————

export interface WeeklyVolume {
  /** The last COMPLETE week, in kilometres. */
  weekKm: number;
  /** Median of the complete weeks in the window, in kilometres. */
  medianKm: number;
  /** Monday of the week `weekKm` measures. */
  weekStart: string;
}

/** Complete weeks need at least this many before a median means anything. */
export const MIN_COMPLETE_WEEKS = 4;

/**
 * The last complete week against its own twelve-week median.
 *
 * Exported because the tripwire, the ranked moves, the experiments and the
 * verdict all quote this comparison and must quote the same one. The LAST
 * bucket `weeklyVolume` ships is the week in PROGRESS — comparing a Tuesday
 * against eleven whole weeks reads as a 70% collapse every Tuesday — so it is
 * dropped. Strictly before today, because on a Sunday the current week ends
 * today and is still being lived.
 */
export function weeklyVolumeSummary(
  weeks: Array<{ weekStart: string; totalDistanceM: number }> | null | undefined,
  today: string,
): WeeklyVolume | null {
  const complete = (weeks ?? []).filter((w) => weekEnd(w.weekStart) < today);
  if (complete.length < MIN_COMPLETE_WEEKS) return null;
  const last = complete[complete.length - 1];
  const medianKm = median(complete.map((w) => w.totalDistanceM / 1000)) ?? 0;
  if (medianKm <= 0) return null;
  return { weekKm: last.totalDistanceM / 1000, medianKm, weekStart: last.weekStart };
}

function weeklyVolume(i: TripwireInput): Tripwire {
  const base = ['weekly-volume', 'Weekly volume', 'vs 12wk median', `< ${VOLUME_FLOOR_PCT}%`] as const;
  const summary = weeklyVolumeSummary(i.weeks, i.today);
  if (!summary) {
    return unread(...base, `Needs ${MIN_COMPLETE_WEEKS} completed weeks with distance on them before a median means anything.`);
  }
  const { weekKm: km, medianKm, weekStart } = summary;
  const pct = Math.round((km / medianKm) * 100);
  const state: TripwireState =
    pct < VOLUME_FLOOR_PCT ? 'TRIPPED' : pct < VOLUME_CLOSE_PCT ? 'CLOSE' : 'ARMED';
  const meaning =
    state === 'ARMED'
      ? `Week to ${short(weekStart)} at ${pct}% of the ${medianKm.toFixed(1)} km median. Nothing to do.`
      : `Week to ${short(weekStart)} ran ${pct}% of the ${medianKm.toFixed(1)} km twelve-week median. One long easy day clears it; nothing else needs to change.`;
  return { id: base[0], signal: base[1], window: base[2], trigger: base[3], state, now: `${km.toFixed(1)} km · ${pct}%`, meaning, readable: true };
}

// 3 —————————————————————————————————————————————————————————————————
function acwrWire(i: TripwireInput): Tripwire {
  const base = ['acwr', 'ACWR', 'EWMA 7:28', `< ${ACWR_BANDS.detraining.toFixed(2)}`] as const;
  if (!usable(i.acwr)) {
    return unread(...base, 'Needs fourteen days of load before an acute-to-chronic ratio exists.');
  }
  const { ratio } = i.acwr.value;
  // CLOSE is the undertraining edge, not an arbitrary margin: it is the band
  // boundary the planner already reads as licence to add distance.
  const state: TripwireState =
    ratio < ACWR_BANDS.detraining
      ? 'TRIPPED'
      : ratio < ACWR_BANDS.undertraining
        ? 'CLOSE'
        : 'ARMED';
  const meaning =
    state === 'TRIPPED'
      ? 'Under the detraining edge. The base is going backwards, and the only fix is calendar.'
      : state === 'CLOSE'
        ? `Below the ${ACWR_BANDS.undertraining.toFixed(2)} undertraining edge and heading for ${ACWR_BANDS.detraining.toFixed(2)}. The alert worth having is the forecast, not the value.`
        : 'Inside the band where fitness builds. Nothing to watch here today.';
  return { id: base[0], signal: base[1], window: base[2], trigger: base[3], state, now: ratio.toFixed(2), meaning, readable: true };
}

// 4 —————————————————————————————————————————————————————————————————
function hrvCrossing(i: TripwireInput): Tripwire {
  const base = ['hrv-crossing', 'HRV 7d mean', 'vs 28d baseline', `below ${HRV_CROSSING_DAYS} days`] as const;
  const t = i.hrv;
  if (!t || t.latest7 == null || t.baseline28 == null || t.baseline28 <= 0) {
    return unread(...base, 'Needs a 28-day baseline before a crossing exists to read.');
  }
  const latest = t.latest7;
  const baseline = t.baseline28;
  const belowPct = ((baseline - latest) / baseline) * 100;
  // Consecutive trailing days where the SMOOTHED line sits meaningfully under
  // the baseline. Reading the morning value instead is how a single 30 ms
  // night becomes a fortnight of alarm.
  const streak = trailingStreak(t.rolling7, (v) => (baseline - v) / baseline > HRV_NOISE_PCT / 100);
  const state: TripwireState =
    streak >= HRV_CROSSING_DAYS ? 'TRIPPED' : belowPct > 0 ? 'CLOSE' : 'ARMED';
  const meaning =
    state === 'TRIPPED'
      ? `${streak} days running more than ${HRV_NOISE_PCT}% under the baseline. Read the crossing, never the morning.`
      : state === 'CLOSE'
        ? `Under the baseline but inside the ${HRV_NOISE_PCT}% noise band. Read the crossing, never the morning.`
        : 'At or above its own baseline.';
  return {
    id: base[0], signal: base[1], window: base[2], trigger: base[3], state,
    now: `${Math.round(latest)} vs ${Math.round(baseline)}`, meaning, readable: true,
  };
}

// 5 —————————————————————————————————————————————————————————————————
function restingHr(i: TripwireInput): Tripwire {
  const base = ['resting-hr', 'Resting HR', 'vs 28d baseline', `+${RHR_TRIGGER_BPM} bpm, ${RHR_TRIGGER_DAYS} days`] as const;
  const t = i.rhr;
  const latest = t?.daily?.at(-1)?.value ?? null;
  if (!t || latest == null || t.baseline28 == null || t.baseline28 <= 0) {
    return unread(...base, 'Needs a 28-day baseline before an elevation means anything.');
  }
  const baseline = t.baseline28;
  const delta = Math.round(latest - baseline);
  const streak = trailingStreak(t.daily, (v) => v - baseline >= RHR_TRIGGER_BPM);
  const state: TripwireState =
    streak >= RHR_TRIGGER_DAYS ? 'TRIPPED' : streak >= 1 ? 'CLOSE' : 'ARMED';
  const now = delta === 0 ? `${Math.round(latest)} · on base` : `${Math.round(latest)} · ${signed(delta)} bpm`;
  const meaning =
    state === 'TRIPPED'
      ? `${streak} days at or over +${RHR_TRIGGER_BPM} bpm. The earliest illness and overreach signal there is.`
      : state === 'CLOSE'
        ? `Over the +${RHR_TRIGGER_BPM} bpm mark for ${streak} day${streak === 1 ? '' : 's'}. ${RHR_TRIGGER_DAYS} days, not one — a single morning corrects itself.`
        : `The earliest illness and overreach signal you have, and it is quiet. ${RHR_TRIGGER_DAYS} days, not one.`;
  return { id: base[0], signal: base[1], window: base[2], trigger: base[3], state, now, meaning, readable: true };
}

// 6 —————————————————————————————————————————————————————————————————
function recoveryReds(i: TripwireInput): Tripwire {
  const base = ['recovery-reds', 'Recovery reds', 'consecutive', `${RECOVERY_RED_DAYS} in a row`] as const;
  const series = i.recovery ?? [];
  const today = series.at(-1)?.value ?? null;
  if (today == null) return unread(...base, 'No recovery score has landed to count against.');
  const streak = trailingStreak(series, (v) => v > 0 && v <= RECOVERY_RED_MAX);
  const state: TripwireState =
    streak >= RECOVERY_RED_DAYS ? 'TRIPPED' : streak >= RECOVERY_RED_DAYS - 1 ? 'CLOSE' : 'ARMED';
  const meaning =
    state === 'TRIPPED'
      ? `${streak} reds in a row is a pattern, not a Tuesday. Below readiness 40 the planner already substitutes a walk.`
      : state === 'CLOSE'
        ? `${streak} in a row. One more and it is a pattern rather than a Tuesday.`
        : 'Three reds is a pattern; one is a Tuesday. Nothing running.';
  return {
    id: base[0], signal: base[1], window: base[2], trigger: base[3], state,
    now: `${streak} · ${Math.round(today)}% today`, meaning, readable: true,
  };
}

// 7 —————————————————————————————————————————————————————————————————
function strainBalance(i: TripwireInput): Tripwire {
  const base = ['strain-balance', 'Strain vs recovery', '7d balance', `> ${STRAIN_BALANCE_FLAG.toFixed(1)}`] as const;
  if (!usable(i.recoveryDebt)) {
    return unread(...base, 'Needs seven days of strain and recovery side by side.');
  }
  const balance = i.recoveryDebt.value.strainRecoveryBalance;
  const state: TripwireState =
    balance > STRAIN_BALANCE_FLAG
      ? 'TRIPPED'
      : balance >= STRAIN_BALANCE_FLAG * BALANCE_CLOSE_FRACTION
        ? 'CLOSE'
        : 'ARMED';
  const meaning =
    state === 'TRIPPED'
      ? 'Strain is running ahead of what recovery is paying for. This is the number that says "too fast".'
      : state === 'CLOSE'
        ? 'Approaching the point where strain outruns recovery. Expect it to climb as volume lands.'
        : 'Comfortable. Expect this to climb as volume lands — it is the number that says "too fast".';
  return { id: base[0], signal: base[1], window: base[2], trigger: base[3], state, now: balance.toFixed(1), meaning, readable: true };
}

// 8 —————————————————————————————————————————————————————————————————
function vo2Slope(i: TripwireInput): Tripwire {
  const base = ['vo2-slope', 'VO₂max slope', '90d regression', `< ${num(VO2_SLOPE_TRIGGER, 2)}/mo`] as const;
  if (!usable(i.vo2)) {
    return unread(...base, 'Needs several readings across the 90-day window to regress.');
  }
  const slope = i.vo2.value.trendSlopePerMonth;
  const state: TripwireState =
    slope < VO2_SLOPE_TRIGGER
      ? 'TRIPPED'
      : slope < VO2_SLOPE_TRIGGER * VO2_CLOSE_FRACTION
        ? 'CLOSE'
        : 'ARMED';
  const yearly = Math.abs(slope) * 12;
  const meaning =
    state === 'ARMED'
      ? `Slope, never value — the percentile is pinned to a fixed age profile, so the rank is noise and the direction is not. ${yearly.toFixed(1)} a year at this rate.`
      : `Losing ${yearly.toFixed(1)} a year at this rate. Slope, never value — the percentile is pinned to a fixed age profile, so the rank is noise and the direction is not.`;
  return { id: base[0], signal: base[1], window: base[2], trigger: base[3], state, now: `${num(slope, 2)}/mo`, meaning, readable: true };
}

// 9 —————————————————————————————————————————————————————————————————
function segmentPb(i: TripwireInput): Tripwire {
  const gapPct = Math.round(GETTABLE_GAP_PCT * 100);
  const base = ['segment-pb', 'Segment PB in range', 'gap to all-time', `gap < ${gapPct}% & improving`] as const;
  const s = i.segments;
  if (!s || s.withForm === 0) {
    return unread(
      ...base,
      `The only positive tripwire here. It fires when a record is genuinely gettable — improving form and inside ${gapPct}% of the all-time best.`,
    );
  }
  const state: TripwireState = s.gettable > 0 ? 'TRIPPED' : s.improving > 0 ? 'CLOSE' : 'ARMED';
  const nearest = s.nearest
    ? ` Closest is ${s.nearest.name}, ${(s.nearest.gapPct * 100).toFixed(1)}% off it.`
    : '';
  const meaning =
    state === 'TRIPPED'
      ? `The only positive tripwire here — a record is genuinely gettable rather than a fantasy.${nearest}`
      : state === 'CLOSE'
        ? `${s.improving} improving, none yet inside ${gapPct}%. The only positive tripwire here.${nearest}`
        : `Nothing improving across ${s.withForm} segments with a form read. The only positive tripwire here; it fires when a record is genuinely gettable.`;
  const now = state === 'TRIPPED' ? `${s.gettable} gettable` : `${s.improving} improving`;
  return { id: base[0], signal: base[1], window: base[2], trigger: base[3], state, now, meaning, readable: true };
}

// ——— helpers ————————————————————————————————————————————————————

function usable<T>(m: MetricResult<T> | null | undefined): m is MetricResult<T> {
  return !!m && m.sufficiency !== 'insufficient';
}

/** How many trailing days in a row satisfy `hit`, counting back from the end. */
function trailingStreak(series: DayPoint[], hit: (v: number) => boolean): number {
  let n = 0;
  for (let k = series.length - 1; k >= 0; k--) {
    if (!hit(series[k].value)) break;
    n++;
  }
  return n;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function weekEnd(weekStart: string): string {
  return new Date(Date.parse(weekStart + 'T00:00:00Z') + 6 * 86_400_000).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function short(day: string): string {
  const d = new Date(day + 'T00:00:00Z');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** A typographic minus, not a hyphen — these sit in a mono data column. */
function num(v: number, dp: number): string {
  return v < 0 ? `−${Math.abs(v).toFixed(dp)}` : v.toFixed(dp);
}

function signed(v: number): string {
  return v > 0 ? `+${v}` : num(v, 0);
}
