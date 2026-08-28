// The sentences that open each chapter of /health.
//
// The page used to be a stack of sections and the reader had to work out what
// each one was for. A lede says it in plain words before the numbers arrive.
//
// Every one of these is DERIVED — read off the same data the charts below it
// draw. None of it is model-written, because a page that already carries a
// generated narrative paragraph and a set of computed annotations does not need
// a third voice, and because a sentence that cannot be traced to a number is
// the thing this codebase has been burned by before.
//
// Two rules hold throughout:
//
//  1. `MetricResult.value` is NEVER null. An `insufficient` result carries a
//     fully-populated ZERO struct — a confident `{ ratio: 0, zone:
//     'detraining' }`. Every reader here checks `sufficiency` first.
//  2. When there is nothing to say, SAY THAT. A lede that invents a trend out
//     of two readings is worse than one admitting the window is thin.

import type { MetricResult } from './analytics/types';
import type { ACWRResult } from './analytics/acwr';
import type { MonotonyResult } from './analytics/monotony';
import type { PolarisedResult } from './analytics/polarised';
import type { VO2Result } from './analytics/vo2max-percentile';

/** True when a metric has enough behind it to be quoted. */
export function usable<T>(m: MetricResult<T> | null | undefined): m is MetricResult<T> {
  return !!m && m.sufficiency !== 'insufficient';
}

function bpm(n: number): string {
  return `${Math.round(n)} bpm`;
}

function signed(n: number, dp = 0): string {
  const v = n.toFixed(dp);
  return n > 0 ? `+${v}` : v;
}

/** Join clauses into a sentence: "a, b and c." */
function sentence(parts: string[]): string {
  const kept = parts.filter(Boolean);
  if (!kept.length) return '';
  if (kept.length === 1) return `${kept[0]}.`;
  return `${kept.slice(0, -1).join(', ')} and ${kept[kept.length - 1]}.`;
}

// ——— 01 · Today ————————————————————————————————————————————————————

export interface TodayInput {
  recovery: number;
  hrv: number;
  rhr: number;
  slept: number;
  rhrBaseline: number;
  deltas: { recDelta: number; hrvDeltaPct: number; rhrDelta: number; sleepDelta: number } | null;
  readinessLabel: string | null;
  syncedAgoSeconds: number;
}

export function todayLede(i: TodayInput): string {
  if (i.syncedAgoSeconds > 36 * 3600) {
    const days = Math.round(i.syncedAgoSeconds / 86_400);
    return `Nothing has synced for ${days} day${days === 1 ? '' : 's'}, so this is the last thing the body said rather than where it is now.`;
  }

  const parts: string[] = [];
  if (i.recovery > 0) {
    const move = i.deltas ? ` (${signed(i.deltas.recDelta)} on the seven-day average)` : '';
    parts.push(`recovery at ${Math.round(i.recovery)}%${move}`);
  }
  if (i.rhr > 0 && i.rhrBaseline > 0) {
    const diff = Math.round(i.rhr - i.rhrBaseline);
    parts.push(
      diff === 0
        ? `a resting heart rate exactly on its ${bpm(i.rhrBaseline)} baseline`
        : `a resting heart rate ${Math.abs(diff)} bpm ${diff < 0 ? 'under' : 'over'} baseline`,
    );
  }
  if (i.slept > 0) parts.push(`${i.slept.toFixed(1)} hours of sleep`);

  const opener = sentence(parts);
  if (!opener) return 'No readings have landed for today yet.';

  const verdict = i.readinessLabel ? ` The composite reads ${i.readinessLabel.toLowerCase()}.` : '';
  return `Today: ${opener}${verdict}`;
}

// ——— 02 · The last thirty days ——————————————————————————————————

export interface WindowInput {
  /** One entry per day in the window; 0 is the missing sentinel throughout. */
  days: Array<{ recovery: number; slept: number; strain: number; steps: number }>;
  workouts: number;
}

export function windowLede(i: WindowInput): string {
  const n = i.days.length;
  if (!n) return 'No days in the window carry a reading yet.';

  const withReading = i.days.filter((d) => d.recovery > 0 || d.slept > 0 || d.steps > 0).length;
  const mean = (pick: (d: WindowInput['days'][number]) => number) => {
    const vals = i.days.map(pick).filter((v) => v > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const rec = mean((d) => d.recovery);
  const slept = mean((d) => d.slept);
  const parts: string[] = [];
  if (rec != null) parts.push(`recovery averaged ${Math.round(rec)}%`);
  if (slept != null) parts.push(`sleep ${slept.toFixed(1)} hours a night`);
  if (i.workouts > 0) parts.push(`${i.workouts} session${i.workouts === 1 ? '' : 's'} logged`);

  const body = sentence(parts);
  const coverage =
    withReading === n
      ? `Every one of the last ${n} days has a reading`
      : `${withReading} of the last ${n} days carry a reading`;
  return body ? `${coverage}. ${body.charAt(0).toUpperCase()}${body.slice(1)}` : `${coverage}.`;
}

// ——— 03 · The direction of travel ————————————————————————————————

export interface DirectionInput {
  vo2: MetricResult<VO2Result> | null;
  /** 7-day mean against the 28-day baseline. */
  rhr: { latest7: number | null; baseline28: number | null } | null;
  hrv: { latest7: number | null; baseline28: number | null } | null;
  ef: { latest7: number | null; baseline28: number | null } | null;
}

export function directionLede(i: DirectionInput): string {
  const parts: string[] = [];

  if (usable(i.vo2)) {
    const slope = i.vo2.value.trendSlopePerMonth;
    // Under 0.05 a month is noise on an estimate the watch rounds anyway.
    if (Math.abs(slope) >= 0.05) {
      parts.push(
        `cardio fitness is ${slope > 0 ? 'climbing' : 'drifting down'} ${Math.abs(slope).toFixed(2)} ml/kg/min a month`,
      );
    } else {
      parts.push('cardio fitness is flat');
    }
  }

  if (i.rhr?.latest7 != null && i.rhr.baseline28 != null) {
    const diff = i.rhr.latest7 - i.rhr.baseline28;
    if (Math.abs(diff) >= 1) {
      // A resting heart rate FALLING is the improvement, which is the wrong way
      // round for every other line on the page — so the word says it, not the sign.
      parts.push(`resting heart rate is ${Math.abs(diff).toFixed(0)} bpm ${diff < 0 ? 'below' : 'above'} its month`);
    }
  }

  if (i.hrv?.latest7 != null && i.hrv.baseline28 != null) {
    const diff = i.hrv.latest7 - i.hrv.baseline28;
    if (Math.abs(diff) >= 2) {
      parts.push(`HRV is ${Math.abs(diff).toFixed(0)} ms ${diff > 0 ? 'up on' : 'down on'} it`);
    }
  }

  if (i.ef?.latest7 != null && i.ef.baseline28 != null && i.ef.baseline28 > 0) {
    const pct = ((i.ef.latest7 - i.ef.baseline28) / i.ef.baseline28) * 100;
    if (Math.abs(pct) >= 2) {
      parts.push(`you are covering ${Math.abs(pct).toFixed(0)}% ${pct > 0 ? 'more' : 'less'} ground per heartbeat`);
    }
  }

  if (!parts.length) return 'Nothing has moved far enough from its own baseline to call a direction yet.';
  return `${sentence(parts).charAt(0).toUpperCase()}${sentence(parts).slice(1)}`;
}

// ——— 04 · The load ————————————————————————————————————————————————

export interface LoadInput {
  acwr: MetricResult<ACWRResult> | null;
  monotony: MetricResult<MonotonyResult> | null;
  polarised: MetricResult<PolarisedResult> | null;
  /** Days of load banked so far, for the not-yet-enough case. */
  daysBanked: number;
}

const ZONE_PROSE: Record<string, string> = {
  detraining: 'that is detraining — the base is going backwards',
  undertraining: 'that is under the band where fitness builds, so there is room',
  optimal: 'that is the band where fitness builds without breaking',
  caution: 'that is above the comfortable band — worth watching',
  danger: 'that is the band injuries come from',
};

export function loadLede(i: LoadInput): string {
  if (!usable(i.acwr)) {
    return `Not enough load banked to read an acute-to-chronic ratio yet — ${i.daysBanked} of the 14 days it needs.`;
  }

  const { ratio, zone } = i.acwr.value;
  const parts = [`acute load is ${ratio.toFixed(2)}× the chronic base, and ${ZONE_PROSE[zone] ?? zone}`];

  // getMonotony() can NEVER report insufficient — it zero-fills seven calendar
  // days before computing, so sufficiency is always 'ok' even against an empty
  // database. The mean and the standard deviation are the real guard.
  const m = i.monotony;
  if (usable(m) && m.value.mean > 0 && m.value.sd > 0 && m.value.band !== 'low') {
    parts.push(`the week's sessions are ${m.value.band === 'high' ? 'very' : 'fairly'} alike, which is its own strain`);
  }

  if (usable(i.polarised) && i.polarised.value.verdict === 'junk-middle') {
    parts.push('most of the time is being spent in the middle zones');
  }

  return `${sentence(parts).charAt(0).toUpperCase()}${sentence(parts).slice(1)}`;
}

// ——— 05 · Recovery and sleep ————————————————————————————————————

export interface RecoveryInput {
  debtHours: number | null;
  autonomicLabel: string | null;
  sleepRegularity: number | null;
}

export function recoveryLede(i: RecoveryInput): string {
  const parts: string[] = [];
  if (i.debtHours != null && Math.abs(i.debtHours) >= 0.5) {
    parts.push(
      i.debtHours > 0
        ? `you are ${i.debtHours.toFixed(1)} hours of sleep down over the last fortnight`
        : `you are ${Math.abs(i.debtHours).toFixed(1)} hours of sleep ahead over the last fortnight`,
    );
  }
  if (i.autonomicLabel) parts.push(`the nervous system reads ${i.autonomicLabel.toLowerCase()}`);
  if (i.sleepRegularity != null) {
    parts.push(
      `and you go to bed at roughly the same time ${Math.round(i.sleepRegularity)} nights in a hundred`,
    );
  }
  if (!parts.length) return 'Not enough sleep history yet to say whether you are getting it back.';
  return `${sentence(parts).charAt(0).toUpperCase()}${sentence(parts).slice(1)}`;
}

// ——— 06 · The ground ————————————————————————————————————————————

export interface GroundInput {
  outings: number;
  distanceM: number;
  types: string[];
  segments: number;
  recentPrs: number;
}

export function groundLede(i: GroundInput): string {
  if (!i.outings) return 'No outings on record yet.';

  const km = i.distanceM > 0 ? `${(i.distanceM / 1000).toFixed(1)} km` : null;
  const sports = i.types.length > 1 ? `across ${i.types.length} sports` : null;
  const parts = [
    `the last ${i.outings} outing${i.outings === 1 ? '' : 's'}${km ? ` covered ${km}` : ''}${sports ? ` ${sports}` : ''}`,
  ];
  if (i.segments > 0) {
    parts.push(`${i.segments} stretch${i.segments === 1 ? '' : 'es'} of ground you have covered more than once`);
  }
  if (i.recentPrs > 0) {
    parts.push(`${i.recentPrs} new best${i.recentPrs === 1 ? '' : 's'} in the last month`);
  }
  return `${sentence(parts).charAt(0).toUpperCase()}${sentence(parts).slice(1)}`;
}
