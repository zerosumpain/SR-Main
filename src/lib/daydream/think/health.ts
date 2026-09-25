// src/lib/daydream/think/health.ts
//
// Health, deeply — two tools the think loop can call.
//
// Until now daydream read only COUNTS from SR-Health (`health-remote.ts`):
// never the hub digest, which is where /health says what it has CONCLUDED —
// the tripwires and what each one means, the ranked moves, the experiments,
// the forecasts, the verdict — and never the ~40 HealthKit kinds the app
// uploads. A health cycle that cannot see what the health page concluded will
// re-derive it badly or contradict it.
//
// `health_hub` is the digest as text, over the service lane the phone already
// uses (`native-health-hub.ts`, cached a minute). `health_series` is one metric
// by day, read straight off the tables the features builder reads — with the
// same two storage traps handled the same way:
//
//   apple_health_metrics  every value ×100 (`appleValue`)
//   whoop_sleep           durations in MILLISECONDS despite the names
//                         (`msToMinutes`) — the 464,018-hours-of-sleep bug
//
// and a plausibility bound on every series, so a unit error drops a reading
// and says so rather than handing the model a 100× figure to reason from.

import { and, gte, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { appleHealthMetrics, whoopCycles, whoopRecovery, whoopSleep } from '$lib/db/schema';
import { getNativeHealthHub } from '$lib/server/native-health-hub';
import type { HubDigest } from '$lib/server/health-hub-contract';
import { aggregate, appleValue, msToMinutes, strainValue, type Aggregation } from '../features/normalise';
import { appleLocalDay, localDay } from '../features/build';

// ── health_hub ──────────────────────────────────────────────────────────────

export const HUB_SECTIONS = ['read', 'tiles', 'instruments', 'forecasts', 'moves', 'tripwires', 'plan', 'experiments', 'verdict'] as const;
export type HubSection = (typeof HUB_SECTIONS)[number];

/**
 * The digest as prose, section by section. PURE.
 *
 * Every string here was written by SR-Health, which owns the numbers; this
 * only lays them out. A tripwire is rendered with its MEANING because the state
 * alone ("tripped") is exactly the kind of bare fact the old counts gave.
 */
export function renderHub(d: HubDigest, sections: readonly HubSection[] = HUB_SECTIONS): string {
  const want = new Set(sections);
  const out: string[] = [];
  const age = Math.round(d.syncedAgoSeconds / 60);
  out.push(`/health digest, generated ${d.generatedAt}, data synced ${age} min ago${d.isMock ? ' — DEMO DATA, not his' : ''}.`);

  if (want.has('read')) {
    if (d.lede) out.push(`The one-line read: ${d.lede}`);
    if (d.readiness) {
      const f = d.readiness.factors.map((x) => `${x.label} ${x.score}`).join(', ');
      out.push(`Readiness ${d.readiness.score} (${d.readiness.label}): ${d.readiness.recommendation}. Factors: ${f}.`);
    }
    if (d.planner) out.push(`The planner would commission: ${d.planner.headline}${d.planner.detail ? ` — ${d.planner.detail}` : ''}`);
  }
  if (want.has('tiles') && d.tiles.length) {
    out.push('Tiles:');
    for (const t of d.tiles) out.push(`  ${t.label}: ${t.display}${t.unit ? ` ${t.unit}` : ''}${t.foot ? ` (${t.foot})` : ''} [${t.tone}]`);
  }
  if (want.has('instruments') && d.instruments.length) {
    out.push('Instruments:');
    for (const i of d.instruments) out.push(`  ${i.label} (${i.window}): ${i.reading} — ${i.meaning} [${i.tone}]`);
  }
  if (want.has('forecasts') && d.forecasts.length) {
    out.push('Forecasts:');
    for (const f of d.forecasts) out.push(`  ${f.label}, ${f.horizonDays}d: ${f.reading}`);
  }
  if (want.has('moves') && d.moves.length) {
    out.push('Ranked moves:');
    for (const m of d.moves) out.push(`  ${m.rank}. ${m.title} — buys ${m.buys}; costs ${m.costs}; leverage ${m.leverage}`);
  }
  if (want.has('tripwires') && d.tripwires.length) {
    out.push('Tripwires:');
    for (const t of d.tripwires) {
      out.push(`  ${t.signal} [${t.state}] over ${t.window}: now ${t.now}, trips at ${t.trigger}. Means: ${t.meaning}`);
    }
  }
  if (want.has('plan') && d.plan) {
    out.push(`Today's proposed session (${d.plan.sport}): ${d.plan.headline}. Why: ${d.plan.why.join('; ')}`);
  }
  if (want.has('experiments') && d.experiments.length) {
    out.push('Experiments:');
    for (const e of d.experiments) {
      out.push(`  [${e.status}] ${e.title}: change ${e.change}; hold ${e.hold}; measure ${e.measure}; stop ${e.stop}${e.counter ? ` (${e.counter})` : ''}`);
    }
  }
  if (want.has('verdict') && d.verdict) {
    out.push(`Verdict: ${d.verdict.headline.join(' ')} ${d.verdict.body.join(' ')}${d.verdict.reviewOn ? ` (review on ${d.verdict.reviewOn})` : ''}`);
  }
  return out.join('\n');
}

export async function healthHubTool(args: Record<string, unknown>): Promise<string> {
  const asked = Array.isArray(args.sections)
    ? args.sections.filter((s): s is HubSection => typeof s === 'string' && (HUB_SECTIONS as readonly string[]).includes(s))
    : [];
  const digest = await getNativeHealthHub();
  return renderHub(digest, asked.length ? asked : HUB_SECTIONS);
}

// ── health_series ───────────────────────────────────────────────────────────

interface AppleSeries {
  source: 'apple';
  metric: string;
  how: Aggregation;
  unit: string;
  lo: number;
  hi: number;
}
interface WhoopSeries {
  source: 'whoop';
  unit: string;
  lo: number;
  hi: number;
}

/**
 * The series a cycle may ask for, by key. Apple kinds are the ones the phone
 * uploads and /health's everyday section reads (SR-Health `health/everyday.ts`
 * carries the same metric names and rules). Bounds are sanity, not medicine:
 * wide enough for any real day, narrow enough that a ×100 or a ms-as-minutes
 * error lands outside them.
 */
export const APPLE_SERIES: Record<string, AppleSeries> = {
  steps: { source: 'apple', metric: 'step_count', how: 'sum', unit: 'steps', lo: 0, hi: 100_000 },
  active_energy: { source: 'apple', metric: 'active_energy', how: 'sum', unit: 'kcal', lo: 0, hi: 10_000 },
  heart_rate: { source: 'apple', metric: 'heart_rate', how: 'mean', unit: 'bpm', lo: 30, hi: 200 },
  hrv_apple: { source: 'apple', metric: 'heart_rate_variability', how: 'mean', unit: 'ms', lo: 5, hi: 300 },
  rhr_apple: { source: 'apple', metric: 'resting_heart_rate', how: 'mean', unit: 'bpm', lo: 25, hi: 120 },
  resp_rate: { source: 'apple', metric: 'respiratory_rate', how: 'mean', unit: 'breaths/min', lo: 5, hi: 40 },
  wrist_temp: { source: 'apple', metric: 'apple_sleeping_wrist_temperature', how: 'mean', unit: '°C', lo: 25, hi: 42 },
  spo2: { source: 'apple', metric: 'oxygen_saturation', how: 'mean', unit: 'SpO2, fraction or %', lo: 0.5, hi: 100 },
  daylight: { source: 'apple', metric: 'time_in_daylight', how: 'sum', unit: 'min', lo: 0, hi: 1440 },
  mindful: { source: 'apple', metric: 'mindful_minutes', how: 'sum', unit: 'min', lo: 0, hi: 1440 },
  mood: { source: 'apple', metric: 'state_of_mind_valence', how: 'mean', unit: 'valence −1..1', lo: -1, hi: 1 },
  vo2max: { source: 'apple', metric: 'vo2_max', how: 'last', unit: 'ml/kg/min', lo: 10, hi: 90 },
  walking_speed: { source: 'apple', metric: 'walking_speed', how: 'mean', unit: 'm/s', lo: 0.1, hi: 4 },
};

export const WHOOP_SERIES: Record<string, WhoopSeries> = {
  sleep_hours: { source: 'whoop', unit: 'h asleep', lo: 0, hi: 16 },
  deep_minutes: { source: 'whoop', unit: 'min slow-wave', lo: 0, hi: 400 },
  rem_minutes: { source: 'whoop', unit: 'min REM', lo: 0, hi: 400 },
  sleep_performance: { source: 'whoop', unit: '%', lo: 0, hi: 100 },
  sleep_resp_rate: { source: 'whoop', unit: 'breaths/min', lo: 5, hi: 40 },
  recovery: { source: 'whoop', unit: '%', lo: 0, hi: 100 },
  hrv: { source: 'whoop', unit: 'ms rMSSD', lo: 5, hi: 300 },
  rhr: { source: 'whoop', unit: 'bpm', lo: 25, hi: 120 },
  skin_temp: { source: 'whoop', unit: '°C', lo: 25, hi: 42 },
  strain: { source: 'whoop', unit: '0–21', lo: 0, hi: 21 },
};

export const SERIES_KEYS = [...Object.keys(WHOOP_SERIES), ...Object.keys(APPLE_SERIES)];
export const SERIES_DEFAULT_DAYS = 28;
export const SERIES_MAX_DAYS = 120;

export interface DayValue {
  day: string;
  value: number;
}

/** Per-day values, bounded, with how many were thrown out. PURE. */
export function boundDays(
  byDay: Map<string, number[]>,
  how: Aggregation,
  lo: number,
  hi: number,
): { days: DayValue[]; dropped: number } {
  const days: DayValue[] = [];
  let dropped = 0;
  for (const [day, values] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const v = aggregate(values, how);
    if (v == null) continue;
    if (v < lo || v > hi) {
      dropped++;
      continue;
    }
    days.push({ day, value: v });
  }
  return { days, dropped };
}

function round(n: number): number {
  const a = Math.abs(n);
  return a >= 100 ? Math.round(n) : a >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
}

/** The card text for a series. PURE. */
export function renderSeries(key: string, unit: string, days: DayValue[], dropped: number, window: number): string {
  if (days.length === 0) {
    return `${key}: no readings in the last ${window} days${dropped ? ` (${dropped} day(s) dropped as implausible — a unit problem in the source, not a finding)` : ''}.`;
  }
  const values = days.map((d) => d.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const last7 = days.slice(-7).map((d) => d.value);
  const prior = days.slice(0, -7).map((d) => d.value);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const lines = [
    `${key} (${unit}), ${days.length} day(s) with readings in the last ${window}: mean ${round(mean)}, min ${round(Math.min(...values))}, max ${round(Math.max(...values))}.`,
  ];
  if (last7.length && prior.length >= 7) {
    lines.push(`Last 7 recorded days average ${round(avg(last7))} against ${round(avg(prior))} before.`);
  }
  if (dropped) lines.push(`${dropped} day(s) dropped as outside ${unit} bounds — treat as a source fault, never as a reading.`);
  lines.push('By day: ' + days.map((d) => `${d.day} ${round(d.value)}`).join(', '));
  return lines.join('\n');
}

async function appleByDay(metric: string, from: Date): Promise<Map<string, number[]>> {
  const rows = await db
    .select({
      dateLocal: appleHealthMetrics.dateLocal,
      date: appleHealthMetrics.date,
      value: appleHealthMetrics.value,
    })
    .from(appleHealthMetrics)
    .where(
      and(
        gte(appleHealthMetrics.date, Math.floor(from.getTime() / 1000)),
        // `inArray`, as the features builder learned: a bound JS array in raw
        // SQL silently matches nothing.
        inArray(appleHealthMetrics.metricName, [metric]),
      ),
    );
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const v = appleValue(r.value); // ×100 undone here, and only here
    if (v == null) continue;
    const day = appleLocalDay(r.dateLocal, r.date);
    const list = byDay.get(day) ?? [];
    list.push(v);
    byDay.set(day, list);
  }
  return byDay;
}

async function whoopByDay(key: string, from: Date): Promise<Map<string, number[]>> {
  const since = Math.floor(from.getTime() / 1000);
  const byDay = new Map<string, number[]>();
  const push = (day: string, v: number | null) => {
    if (v == null || !Number.isFinite(v)) return;
    const list = byDay.get(day) ?? [];
    list.push(v);
    byDay.set(day, list);
  };

  if (['sleep_hours', 'deep_minutes', 'rem_minutes', 'sleep_performance', 'sleep_resp_rate'].includes(key)) {
    const rows = await db
      .select({
        endDate: whoopSleep.endDate,
        nap: whoopSleep.nap,
        totalInBed: whoopSleep.totalInBed,
        totalAwake: whoopSleep.totalAwake,
        totalSlowWave: whoopSleep.totalSlowWave,
        totalRem: whoopSleep.totalRem,
        sleepPerformance: whoopSleep.sleepPerformance,
        respiratoryRate: whoopSleep.respiratoryRate,
      })
      .from(whoopSleep)
      .where(gte(whoopSleep.endDate, since));
    for (const r of rows) {
      if (r.nap) continue;
      // A night belongs to the morning it ends on, as in features/build.ts.
      const day = localDay(new Date(r.endDate * 1000));
      if (key === 'sleep_hours') {
        const inBed = msToMinutes(r.totalInBed);
        const awake = msToMinutes(r.totalAwake) ?? 0;
        push(day, inBed == null ? null : Math.max(0, inBed - awake) / 60);
      } else if (key === 'deep_minutes') push(day, msToMinutes(r.totalSlowWave));
      else if (key === 'rem_minutes') push(day, msToMinutes(r.totalRem));
      else if (key === 'sleep_performance') push(day, r.sleepPerformance);
      else push(day, r.respiratoryRate);
    }
  } else if (['recovery', 'hrv', 'rhr', 'skin_temp'].includes(key)) {
    const rows = await db
      .select({
        createdDate: whoopRecovery.createdDate,
        recoveryScore: whoopRecovery.recoveryScore,
        hrvRmssd: whoopRecovery.hrvRmssd,
        restingHeartRate: whoopRecovery.restingHeartRate,
        skinTemp: whoopRecovery.skinTemp,
      })
      .from(whoopRecovery)
      .where(gte(whoopRecovery.createdDate, since));
    for (const r of rows) {
      const day = localDay(new Date(r.createdDate * 1000));
      if (key === 'recovery') push(day, r.recoveryScore);
      else if (key === 'hrv') push(day, r.hrvRmssd);
      else if (key === 'rhr') push(day, r.restingHeartRate);
      // Celsius ×100, per the schema — unscaled here and nowhere else.
      else push(day, r.skinTemp == null ? null : r.skinTemp / 100);
    }
  } else if (key === 'strain') {
    const rows = await db
      .select({ startDate: whoopCycles.startDate, startDateLocal: whoopCycles.startDateLocal, strain: whoopCycles.strain })
      .from(whoopCycles)
      .where(gte(whoopCycles.startDate, since));
    for (const r of rows) {
      const head = (r.startDateLocal ?? '').slice(0, 10);
      const day = /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : localDay(new Date(r.startDate * 1000));
      // Stored both raw and ×100 by two writers; the value test decides.
      push(day, strainValue(r.strain));
    }
  }
  return byDay;
}

export async function healthSeriesTool(args: Record<string, unknown>, now = new Date()): Promise<string> {
  const key = typeof args.metric === 'string' ? args.metric.trim() : '';
  const rawDays = Number(args.days);
  const window = Number.isFinite(rawDays) ? Math.min(SERIES_MAX_DAYS, Math.max(7, Math.round(rawDays))) : SERIES_DEFAULT_DAYS;
  const from = new Date(now.getTime() - window * 86_400_000);

  const apple = APPLE_SERIES[key];
  const whoop = WHOOP_SERIES[key];
  if (!apple && !whoop) {
    return `Unknown series "${key}". The series are: ${SERIES_KEYS.join(', ')}.`;
  }
  if (apple) {
    const { days, dropped } = boundDays(await appleByDay(apple.metric, from), apple.how, apple.lo, apple.hi);
    return renderSeries(key, apple.unit, days, dropped, window);
  }
  // Whoop: one row per night / cycle, so a day's figure is its mean — two rows
  // on one day means a re-scored night, not two nights.
  const { days, dropped } = boundDays(await whoopByDay(key, from), key === 'strain' ? 'max' : 'mean', whoop.lo, whoop.hi);
  return renderSeries(key, whoop.unit, days, dropped, window);
}

export function healthSeriesDescription(): string {
  return (
    "One of the owner's health metrics by day, with a summary and the last week against the weeks before. " +
    `Whoop (the primary sleep and recovery source): ${Object.keys(WHOOP_SERIES).join(', ')}. ` +
    `Apple Watch / HealthKit: ${Object.keys(APPLE_SERIES).join(', ')}. ` +
    'Readings outside plausible bounds are dropped and counted, never shown.'
  );
}
