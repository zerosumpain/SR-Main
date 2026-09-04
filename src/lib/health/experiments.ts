// Change one thing and measure it.
//
// Two at once is the limit and one is better: a third overlapping variable
// makes attribution impossible, and an experiment you cannot attribute is just
// a resolution. So exactly one card is LIVE — the first eligible experiment
// whose entry condition currently holds — and the rest queue behind it.
//
// Nothing here is stored. There is no experiments table and no owner CRUD:
// every card is DERIVED from the instrument deck the same way the tripwires
// are, which means the day counter cannot drift out of step with the numbers
// it claims to be moving, and an experiment whose trigger has gone away simply
// stops being listed. (Spec decision 2, 2026-08-30 — a table can replace the
// derivation later without changing this module's shape.)
//
// The day counter is measured from the SERIES, not from a start button: the
// day the triggering condition actually crossed its threshold. Where no dated
// series backs the trigger, the counter honestly reads day one.

import type { MetricResult } from './analytics/types';
import { ACWR_BANDS, type ACWRResult } from './analytics/acwr';
import { POLARISED_HARD_PCT, type PolarisedResult } from './analytics/polarised';
import { SRI_TARGET } from './analytics/sri';
import type { CircadianResult } from './analytics/circadian';
import {
  SLEEP_BALANCE_SHORTFALL_MIN,
  STRAIN_BALANCE_FLAG,
  type RecoveryDebtResult,
} from './analytics/recovery-debt';

export type ExperimentId = 'fixed-window' | 'dull-long-day' | 'one-hard-effort';
export type ExperimentState = 'LIVE' | 'QUEUED';

export interface Experiment {
  id: ExperimentId;
  /** E1, E2, E3 — assigned over the ELIGIBLE list, so the numbering has no holes. */
  code: string;
  state: ExperimentState;
  title: string;
  /** Days between the trigger crossing and today. 0 when nothing dates it. */
  daysSinceOnset: number;
  /** 1-based day of the experiment, capped at its length. */
  dayCount: number;
  durationDays: number;
  /** "DAY 5 OF 21" · "WEEK 1 OF 6" · "GATED ON E1+E2" */
  counter: string;
  change: string;
  holdConstant: string;
  measure: string;
  stopRule: string;
  /** A queued experiment states what would let it start, not when to stop. */
  stopRuleLabel: 'STOP RULE' | 'ENTRY CONDITION';
  /** Codes of the experiments that must run first. Empty when nothing gates it. */
  gatedBy: string[];
}

export interface ExperimentsInput {
  /** YYYY-MM-DD. Injected so the counters are testable against a fixed clock. */
  today: string;
  sri?: MetricResult<number> | null;
  circadian?: MetricResult<CircadianResult> | null;
  recoveryDebt?: MetricResult<RecoveryDebtResult> | null;
  acwr?: MetricResult<ACWRResult> | null;
  polarised?: MetricResult<PolarisedResult> | null;
  /** Last complete week against the twelve-week median, kilometres. */
  volume?: { weekKm: number; medianKm: number } | null;
  /** Twelve weeks oldest first, for dating the volume trigger's onset. */
  weeks?: Array<{ weekStart: string; totalDistanceM: number }> | null;
}

const CIRCADIAN_FLAG_HOURS = 1;
const ACWR_TARGET = ACWR_BANDS.undertraining + 0.05;
const VOLUME_LOW_PCT = 0.8;
/** The SRI move a three-week window has to produce to be worth continuing. */
const SRI_MIN_MOVE = 10;

const FIXED_WINDOW_DAYS = 21;
const LONG_DAY_WEEKS = 6;
const HARD_EFFORT_WEEKS = 8;

interface Draft extends Omit<Experiment, 'code' | 'state' | 'counter' | 'stopRuleLabel' | 'gatedBy'> {
  /** True when the experiment could START today, not merely that it is listed. */
  entryHolds: boolean;
  counterUnit: 'day' | 'week';
  /** Filled once codes exist. */
  gates: ExperimentId[];
}

export function computeExperiments(input: ExperimentsInput): Experiment[] {
  const drafts = [fixedWindow(input), dullLongDay(input), oneHardEffort(input)].filter(
    (d): d is Draft => d != null,
  );
  if (!drafts.length) return [];

  const codeOf = new Map<ExperimentId, string>(drafts.map((d, i) => [d.id, `E${i + 1}`]));

  // Exactly one live: the first eligible whose entry condition holds today.
  const liveId = drafts.find((d) => d.entryHolds)?.id ?? null;

  return drafts.map((d) => {
    const gatedBy = d.gates
      .filter((id) => codeOf.has(id))
      .map((id) => codeOf.get(id) as string);
    const weeks = Math.ceil(d.dayCount / 7);
    const counter = gatedBy.length
      ? `GATED ON ${gatedBy.join('+')}`
      : d.counterUnit === 'week'
        ? `WEEK ${weeks} OF ${Math.round(d.durationDays / 7)}`
        : `DAY ${d.dayCount} OF ${d.durationDays}`;
    return {
      id: d.id,
      code: codeOf.get(d.id) as string,
      state: d.id === liveId ? 'LIVE' : 'QUEUED',
      title: d.title,
      daysSinceOnset: d.daysSinceOnset,
      dayCount: d.dayCount,
      durationDays: d.durationDays,
      counter,
      change: d.change,
      holdConstant: d.holdConstant,
      measure: d.measure,
      stopRule: d.stopRule,
      stopRuleLabel: gatedBy.length ? 'ENTRY CONDITION' : 'STOP RULE',
      gatedBy,
    };
  });
}

// ——— E1 · the fixed window ————————————————————————————————————————

function fixedWindow(i: ExperimentsInput): Draft | null {
  const sri = usable(i.sri) && i.sri.value < SRI_TARGET ? i.sri.value : null;
  const drift =
    usable(i.circadian) && Math.abs(i.circadian.value.driftHours) >= CIRCADIAN_FLAG_HOURS
      ? i.circadian.value.driftHours
      : null;
  const sleepBalance =
    usable(i.recoveryDebt) &&
    i.recoveryDebt.value.averageBalanceMin < -SLEEP_BALANCE_SHORTFALL_MIN
      ? i.recoveryDebt.value
      : null;
  if (sri == null && drift == null && sleepBalance == null) return null;

  // The rolling balance curve is the one trigger with a dated series behind
  // it, so it is the one that can date the experiment.
  const onset = sleepBalance ? balanceCrossingDays(sleepBalance.series, i.today) : 0;
  const { dayCount, daysSinceOnset } = count(onset, FIXED_WINDOW_DAYS);

  const measures: string[] = [];
  if (sri != null) measures.push(`SRI ${Math.round(sri)} → ${SRI_TARGET}`);
  if (drift != null) {
    measures.push(`circadian drift ${signed(drift, 1)}h → under ${CIRCADIAN_FLAG_HOURS}h`);
  }
  if (sleepBalance) {
    measures.push(
      `seven-night sleep balance ${signed(sleepBalance.averageBalanceMin, 0)} min/night → within ${SLEEP_BALANCE_SHORTFALL_MIN}`,
    );
  }
  measures.push('HRV 7d mean');

  const judgeOn = addDays(i.today, FIXED_WINDOW_DAYS - dayCount);
  const stopRule =
    sri != null
      ? `Judge on ${longDate(judgeOn)}. If SRI has not moved ${SRI_MIN_MOVE} points, the window is not the constraint — look at wake time.`
      : `Judge on ${longDate(judgeOn)}. If nothing has moved, the window is not the constraint — look at wake time.`;

  return {
    id: 'fixed-window',
    title: 'THE FIXED WINDOW',
    daysSinceOnset,
    dayCount,
    durationDays: FIXED_WINDOW_DAYS,
    counterUnit: 'day',
    change: 'Lights out inside one fixed 30-minute window, five nights in seven.',
    holdConstant: `Training volume, wake time, caffeine. Nothing else moves for ${FIXED_WINDOW_DAYS} days.`,
    measure: `${sentence(measures)}.`,
    stopRule,
    entryHolds: true,
    gates: [],
  };
}

// ——— E2 · the dull long day ——————————————————————————————————————

function dullLongDay(i: ExperimentsInput): Draft | null {
  const ratio = usable(i.acwr) && i.acwr.value.ratio < ACWR_BANDS.undertraining ? i.acwr.value.ratio : null;
  const vol =
    i.volume && i.volume.medianKm > 0 && i.volume.weekKm < i.volume.medianKm * VOLUME_LOW_PCT
      ? i.volume
      : null;
  if (ratio == null && !vol) return null;

  const durationDays = LONG_DAY_WEEKS * 7;
  const onset = vol ? thinWeekDays(i.weeks ?? [], vol.medianKm, i.today) : 0;
  const { dayCount, daysSinceOnset } = count(onset, durationDays);

  const measures: string[] = [];
  if (ratio != null) measures.push(`ACWR ${ratio.toFixed(2)} → ${ACWR_TARGET.toFixed(2)}`);
  if (vol) measures.push(`weekly volume ${trim(vol.weekKm)} km → ${trim(vol.medianKm)} km`);
  measures.push('beats-per-km against the 28-day baseline');
  measures.push('monotony must stay under 2');

  return {
    id: 'dull-long-day',
    title: 'THE DULL LONG DAY',
    daysSinceOnset,
    dayCount,
    durationDays,
    counterUnit: 'week',
    change: 'One 12–15 km outing a week at hike heart rate. Nothing added to the other days.',
    holdConstant: 'Session count and intensity distribution. The variable is duration, not effort.',
    measure: `${sentence(measures)}.`,
    stopRule: `Abort if the strain-recovery balance passes ${STRAIN_BALANCE_FLAG.toFixed(1)} or three recovery reds land in a row. The sleep experiment wins ties.`,
    entryHolds: true,
    gates: [],
  };
}

// ——— E3 · one hard effort ——————————————————————————————————————

function oneHardEffort(i: ExperimentsInput): Draft | null {
  if (!usable(i.polarised)) return null;
  const p = i.polarised.value;
  if (p.verdict === 'polarised' || p.verdict === 'insufficient-volume') return null;

  // Hard work on short sleep is how this list restarts at the top, so the entry
  // condition is both gates being clear — not merely the mix being wrong.
  const balanceClear =
    !usable(i.recoveryDebt) ||
    i.recoveryDebt.value.averageBalanceMin >= -SLEEP_BALANCE_SHORTFALL_MIN;
  const loadClear = !usable(i.acwr) || i.acwr.value.ratio >= ACWR_BANDS.undertraining;

  const gates: ExperimentId[] = [];
  if (fixedWindow(i)) gates.push('fixed-window');
  if (dullLongDay(i)) gates.push('dull-long-day');

  const durationDays = HARD_EFFORT_WEEKS * 7;
  const { dayCount, daysSinceOnset } = count(0, durationDays);

  const notBefore = addDays(i.today, longestGateRemaining(i, gates));
  const entry = gates.length
    ? `Do not start before ${longDate(notBefore)}, and not at all unless the seven-night sleep balance is within ${SLEEP_BALANCE_SHORTFALL_MIN} minutes per night of fresh need.`
    : `Stop if the polarisation verdict has not moved by ${longDate(addDays(i.today, durationDays))}, or if three recovery reds land in a row.`;

  return {
    id: 'one-hard-effort',
    title: 'ONE HARD EFFORT',
    daysSinceOnset,
    dayCount,
    durationDays,
    counterUnit: 'week',
    change: `One weekly Z4–5 effort on a gettable segment. Takes the hard share ${Math.round(p.hardPct)}% → ${POLARISED_HARD_PCT}%.`,
    holdConstant: 'The fixed sleep window and the long day, both proven by then.',
    measure: `The verdict flips from ${p.verdict} to polarised: hard share ${Math.round(p.hardPct)}% → ${POLARISED_HARD_PCT}%. VO₂max slope. Segment gap closing.`,
    stopRule: entry,
    entryHolds: gates.length === 0 && balanceClear && loadClear,
    gates,
  };
}

// ——— helpers ————————————————————————————————————————————————————

function usable<T>(m: MetricResult<T> | null | undefined): m is MetricResult<T> {
  return !!m && m.sufficiency !== 'insufficient';
}

function count(daysSinceOnset: number, durationDays: number) {
  return { daysSinceOnset, dayCount: Math.max(1, Math.min(durationDays, daysSinceOnset + 1)) };
}

/**
 * Days since the rolling seven-night balance last crossed the action line. The
 * curve is signed and can recover, so only the trailing run counts.
 */
function balanceCrossingDays(
  series: Array<{ date: string; balanceMin: number }>,
  today: string,
): number {
  if (!series.length) return 0;
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  let onset: string | null = null;
  for (let k = sorted.length - 1; k >= 0; k--) {
    if (sorted[k].balanceMin >= -SLEEP_BALANCE_SHORTFALL_MIN) break;
    onset = sorted[k].date;
  }
  return onset ? Math.max(0, dayNumber(today) - dayNumber(onset)) : 0;
}

/** Days since the weekly volume last dropped under its median threshold. */
function thinWeekDays(
  weeks: Array<{ weekStart: string; totalDistanceM: number }>,
  medianKm: number,
  today: string,
): number {
  const complete = weeks.filter((w) => weekEnd(w.weekStart) < today);
  let onset: string | null = null;
  for (let k = complete.length - 1; k >= 0; k--) {
    if (complete[k].totalDistanceM / 1000 >= medianKm * VOLUME_LOW_PCT) break;
    onset = complete[k].weekStart;
  }
  return onset ? Math.max(0, dayNumber(today) - dayNumber(onset)) : 0;
}

/** How long the slowest open gate still has to run. */
function longestGateRemaining(i: ExperimentsInput, gates: ExperimentId[]): number {
  let most = 0;
  for (const id of gates) {
    const d = id === 'fixed-window' ? fixedWindow(i) : dullLongDay(i);
    if (!d) continue;
    most = Math.max(most, d.durationDays - d.dayCount);
  }
  return most;
}

function sentence(parts: string[]): string {
  const kept = parts.filter(Boolean);
  if (!kept.length) return '';
  if (kept.length === 1) return kept[0];
  return `${kept.slice(0, -1).join(', ')} and ${kept[kept.length - 1]}`;
}

function signed(v: number, dp: number): string {
  return v > 0 ? `+${v.toFixed(dp)}` : `−${Math.abs(v).toFixed(dp)}`;
}

function trim(km: number): string {
  const s = km.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function longDate(day: string): string {
  const d = new Date(day + 'T00:00:00Z');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function addDays(day: string, n: number): string {
  return new Date(dayNumber(day) * 86_400_000 + n * 86_400_000).toISOString().slice(0, 10);
}

function dayNumber(date: string): number {
  return Math.floor(Date.parse(date + 'T00:00:00Z') / 86_400_000);
}

function weekEnd(weekStart: string): string {
  return addDays(weekStart, 6);
}
