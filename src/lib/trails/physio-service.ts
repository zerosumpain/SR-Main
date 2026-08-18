// Read side for /trails/dashboard and the physiological enrichment on
// /trails/[id]. Composes the pure analytics in $lib/health/analytics over the
// trails tables plus the Whoop/Apple daily metrics. Mirrors the other health
// services: server-only, plain data out, every sub-source fails soft.

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  activities,
  activitySeries,
  appleHealthMetrics,
  whoopRecovery,
} from '$lib/db/schema';
import { trimpFromSamples, trimpFromAvg, type HrProfile, type HrSample } from '$lib/health/analytics/trimp';
import {
  timeInZones,
  zoneEdges,
  addZones,
  totalZoneSeconds,
  type ZoneSeconds,
} from '$lib/health/analytics/hr-zones';
import {
  efficiencyFactor,
  splitHalves,
  decoupling,
} from '$lib/health/analytics/efficiency';
import { hrrCurve, hrr60, type HrrPoint } from '$lib/health/analytics/hrr';
import { computeACWR, type ACWRResult, type LoadDay } from '$lib/health/analytics/acwr';
import { computePolarised, type PolarisedResult } from '$lib/health/analytics/polarised';
import { rollingMean, trailingMean, type DayPoint } from '$lib/health/analytics/rolling';
import type { MetricResult } from '$lib/health/analytics/types';
import { getVO2Max, resolveHealthProfile } from '$lib/health/services/vo2max-service';
import { getACWR } from '$lib/health/services/acwr-service';
import type { VO2Result } from '$lib/health/analytics/vo2max-percentile';
import type { ActivityDetail } from './activities-service';

// ---------------------------------------------------------------------------
// Shapes

export interface TrendSeries {
  daily: DayPoint[];
  rolling7: DayPoint[];
  latest7: number | null; // trailing 7-day mean
  baseline28: number | null; // trailing 28-day mean
}

export interface WorkoutPhysio {
  id: string;
  name: string;
  activityType: string;
  day: string; // local YYYY-MM-DD
  startDate: number;
  durationS: number;
  distanceM: number | null;
  avgHeartrate: number | null;
  trimp: number | null;
  ef: number | null;
  hrr60: number | null;
}

export interface WeekVolume {
  weekStart: string; // Monday, YYYY-MM-DD
  totalS: number;
  totalDistanceM: number;
  byType: Record<string, number>; // seconds per activity type
}

export interface TrailsDashboard {
  profile: HrProfile & { hrMaxSource: string };
  vo2: { result: MetricResult<VO2Result> | null; series: DayPoint[] };
  rhr: TrendSeries | null;
  hrv: TrendSeries | null; // Whoop RMSSD — not comparable with SDNN below
  hrvSdnn: TrendSeries | null; // Apple SDNN daily medians
  recovery: DayPoint[];
  workouts: WorkoutPhysio[]; // last 90 days, ascending
  load: {
    days: LoadDay[]; // daily TRIMP, zero-filled from first activity
    trimpAcwr: MetricResult<ACWRResult> | null;
    strainAcwr: MetricResult<ACWRResult> | null; // Whoop-strain interim
  };
  weeks: WeekVolume[]; // exactly 12, oldest first
  zones28: { zones: ZoneSeconds; polarised: MetricResult<PolarisedResult> | null } | null;
}

export interface ActivityPhysio {
  trimp: number | null;
  trimpBasis: 'series' | 'average' | null;
  ef: number | null;
  decouplingPct: number | null;
  hrr60: number | null;
  hrrCurve: HrrPoint[] | null;
  zones: ZoneSeconds | null;
  zoneEdges: number[]; // absolute bpm starts for z1..z5
  hrMax: number;
  mets: number | null;
  minHr: number | null;
  temperatureC: number | null;
  humidityPct: number | null;
  typical: { paceSPerKm: number | null; avgHr: number | null; ef: number | null; n: number };
}

// ---------------------------------------------------------------------------
// HR profile

const TANAKA_INTERCEPT = 208;
const TANAKA_SLOPE = 0.7;
const DEFAULT_HR_REST = 60;

async function safe<T>(label: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.warn(`[trails-physio] ${label} failed:`, (err as Error)?.message);
    return null;
  }
}

export async function resolveHrProfile(): Promise<HrProfile & { hrMaxSource: string }> {
  const { age, sex } = resolveHealthProfile();
  const tanaka = Math.round(TANAKA_INTERCEPT - TANAKA_SLOPE * age);

  const [actMaxRow] = (await safe(
    'observed activity max HR',
    db.select({ m: sql<number | null>`max(${activities.maxHeartrate})` }).from(activities),
  )) ?? [null];
  const [appleMaxRow] = (await safe(
    'observed apple max HR',
    db
      .select({ m: sql<number | null>`max(${appleHealthMetrics.maxValue})` })
      .from(appleHealthMetrics)
      .where(eq(appleHealthMetrics.metricName, 'heart_rate')),
  )) ?? [null];

  const observed = Math.max(actMaxRow?.m ?? 0, (appleMaxRow?.m ?? 0) / 100);
  const hrMax = Math.max(tanaka, Math.round(observed));
  const hrMaxSource = observed > tanaka ? 'observed' : 'tanaka';

  const rhrRows = await safe(
    'whoop RHR for hrRest',
    db
      .select({ created: whoopRecovery.createdDate, rhr: whoopRecovery.restingHeartRate })
      .from(whoopRecovery)
      .where(gte(whoopRecovery.createdDate, epochDaysAgo(28))),
  );
  const hrRest = rhrRows?.length
    ? Math.round(rhrRows.reduce((a, r) => a + r.rhr, 0) / rhrRows.length)
    : DEFAULT_HR_REST;

  return { hrMax, hrRest, sex, hrMaxSource };
}

// ---------------------------------------------------------------------------
// Dashboard

export async function getTrailsDashboard(): Promise<TrailsDashboard> {
  const profile = await resolveHrProfile();

  const [vo2Result, vo2Series, whoopDaily, sdnnDaily, activityRows, strainAcwr] =
    await Promise.all([
      safe('vo2 result', getVO2Max()),
      safe('vo2 series', fetchVo2Series()),
      safe('whoop daily', fetchWhoopDaily(180)),
      safe('apple sdnn', fetchSdnnDaily(180)),
      safe('activities 90d', fetchActivitiesWithHr(90)),
      safe('strain acwr', getACWR()),
    ]);

  const workouts: WorkoutPhysio[] = [];
  let zones28: ZoneSeconds | null = null;
  const cutoff28 = epochDaysAgo(28);

  for (const row of activityRows ?? []) {
    const samples = row.hrSamples;
    const duration = row.activeDurationS ?? row.durationS;
    const trimp =
      (samples ? trimpFromSamples(samples, profile) : null) ??
      (row.avgHeartrate ? trimpFromAvg(duration, row.avgHeartrate, profile) : null);
    const ef = efficiencyFactor(row.distanceM, duration, row.avgHeartrate);
    const curve = hrrCurve((row.metadata as Record<string, unknown> | null)?.heartRateRecovery);

    workouts.push({
      id: row.id,
      name: row.name,
      activityType: row.activityType,
      day: row.startDateLocal.slice(0, 10),
      startDate: row.startDate,
      durationS: duration,
      distanceM: row.distanceM,
      avgHeartrate: row.avgHeartrate,
      trimp,
      ef,
      hrr60: hrr60(curve),
    });

    if (samples && row.startDate >= cutoff28) {
      const z = timeInZones(samples, profile.hrMax);
      if (z) zones28 = zones28 ? addZones(zones28, z) : z;
    }
  }
  workouts.sort((a, b) => a.startDate - b.startDate);

  // Daily TRIMP, zero-filled from the first workout so rest days count as 0 —
  // but never before it: back-filling zeros into empty history would fabricate
  // a tiny chronic load and a huge ratio.
  const loadDays = buildLoadDays(workouts);
  const trimpAcwr = loadDays.length > 0 ? computeACWR(loadDays) : null;

  return {
    profile,
    vo2: { result: vo2Result, series: vo2Series ?? [] },
    rhr: whoopDaily ? trend(whoopDaily.rhr) : null,
    hrv: whoopDaily ? trend(whoopDaily.hrv) : null,
    hrvSdnn: sdnnDaily ? trend(sdnnDaily) : null,
    recovery: whoopDaily?.recovery.slice(-90) ?? [],
    workouts,
    load: { days: loadDays, trimpAcwr, strainAcwr },
    weeks: weeklyVolume(workouts, 12),
    zones28: zones28
      ? { zones: zones28, polarised: polarisedFromZones(zones28) }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Light strip for the /trails list page — no HR series, two cheap queries.

export interface TrailsStrip {
  weeks: WeekVolume[];
  strainAcwr: MetricResult<ACWRResult> | null;
}

export async function getTrailsStrip(): Promise<TrailsStrip> {
  const rows =
    (await safe(
      'strip activities',
      db
        .select({
          id: activities.id,
          activityType: activities.activityType,
          startDate: activities.startDate,
          startDateLocal: activities.startDateLocal,
          durationS: activities.durationS,
          activeDurationS: activities.activeDurationS,
          distanceM: activities.distanceM,
        })
        .from(activities)
        .where(gte(activities.startDate, epochDaysAgo(90))),
    )) ?? [];

  const workouts: WorkoutPhysio[] = rows.map((r) => ({
    id: r.id,
    name: '',
    activityType: r.activityType,
    day: r.startDateLocal.slice(0, 10),
    startDate: r.startDate,
    durationS: r.activeDurationS ?? r.durationS,
    distanceM: r.distanceM,
    avgHeartrate: null,
    trimp: null,
    ef: null,
    hrr60: null,
  }));

  return {
    weeks: weeklyVolume(workouts, 12),
    strainAcwr: await safe('strip strain acwr', getACWR()),
  };
}

// ---------------------------------------------------------------------------
// Per-activity enrichment

export async function getActivityPhysio(detail: ActivityDetail): Promise<ActivityPhysio> {
  const profile = await resolveHrProfile();
  const hrSeries = detail.series.find((s) => s.metric === 'heart_rate');
  const samples = (hrSeries?.samples as HrSample[] | undefined) ?? null;
  const duration = detail.activeDurationS ?? detail.durationS;
  const meta = detail.metadata ?? {};

  const trimpSeries = samples ? trimpFromSamples(samples, profile) : null;
  const trimp =
    trimpSeries ??
    (detail.avgHeartrate ? trimpFromAvg(duration, detail.avgHeartrate, profile) : null);

  const curve = hrrCurve(meta.heartRateRecovery);

  // Decoupling only means something on sustained steady work.
  const longEnough = duration >= 1200;
  const halves =
    longEnough && detail.coordinates && samples
      ? splitHalves(detail.coordinates as Array<[number, number, number | null, number]>, samples)
      : null;

  const typical = await safe('typical medians', typicalForSport(detail));

  return {
    trimp,
    trimpBasis: trimp == null ? null : trimpSeries != null ? 'series' : 'average',
    ef: efficiencyFactor(detail.distanceM, duration, detail.avgHeartrate),
    decouplingPct: decoupling(halves),
    hrr60: hrr60(curve),
    hrrCurve: curve,
    zones: samples ? timeInZones(samples, profile.hrMax) : null,
    zoneEdges: zoneEdges(profile.hrMax),
    hrMax: profile.hrMax,
    mets: qty(meta.intensity), // kcal/hr·kg ≡ METs
    minHr: qty((meta.heartRate as Record<string, unknown> | undefined)?.min),
    temperatureC: qty(meta.temperature),
    humidityPct: qty(meta.humidity),
    typical: typical ?? { paceSPerKm: null, avgHr: null, ef: null, n: 0 },
  };
}

async function typicalForSport(detail: ActivityDetail) {
  const rows = await db
    .select({
      distanceM: activities.distanceM,
      durationS: activities.durationS,
      activeDurationS: activities.activeDurationS,
      avgHeartrate: activities.avgHeartrate,
      avgPaceSPerKm: activities.avgPaceSPerKm,
    })
    .from(activities)
    .where(
      and(
        eq(activities.activityType, detail.activityType),
        sql`${activities.id} <> ${detail.id}`,
      ),
    )
    .orderBy(desc(activities.startDate))
    .limit(200);

  const efs = rows
    .map((r) => efficiencyFactor(r.distanceM, r.activeDurationS ?? r.durationS, r.avgHeartrate))
    .filter((v): v is number => v != null);
  return {
    paceSPerKm: median(rows.map((r) => r.avgPaceSPerKm).filter((v): v is number => v != null)),
    avgHr: median(rows.map((r) => r.avgHeartrate).filter((v): v is number => v != null)),
    ef: median(efs),
    n: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Fetch helpers

async function fetchVo2Series(): Promise<DayPoint[]> {
  const rows = await db
    .select({ date: appleHealthMetrics.date, value: appleHealthMetrics.value })
    .from(appleHealthMetrics)
    .where(eq(appleHealthMetrics.metricName, 'vo2_max'))
    .orderBy(appleHealthMetrics.date);
  // Several readings can land on one day — keep the latest per day.
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (r.value == null) continue;
    byDay.set(isoDay(r.date), r.value / 100);
  }
  return [...byDay.entries()].map(([date, value]) => ({ date, value }));
}

async function fetchWhoopDaily(days: number) {
  const rows = await db
    .select({
      created: whoopRecovery.createdDate,
      rhr: whoopRecovery.restingHeartRate,
      hrv: whoopRecovery.hrvRmssd,
      score: whoopRecovery.recoveryScore,
    })
    .from(whoopRecovery)
    .where(gte(whoopRecovery.createdDate, epochDaysAgo(days)))
    .orderBy(whoopRecovery.createdDate);
  const rhr: DayPoint[] = [];
  const hrv: DayPoint[] = [];
  const recovery: DayPoint[] = [];
  for (const r of rows) {
    const date = isoDay(r.created);
    rhr.push({ date, value: r.rhr });
    hrv.push({ date, value: Math.round(r.hrv * 10) / 10 });
    recovery.push({ date, value: r.score });
  }
  return { rhr, hrv, recovery };
}

async function fetchSdnnDaily(days: number): Promise<DayPoint[]> {
  const rows = await db
    .select({ date: appleHealthMetrics.date, value: appleHealthMetrics.value })
    .from(appleHealthMetrics)
    .where(
      and(
        eq(appleHealthMetrics.metricName, 'heart_rate_variability'),
        gte(appleHealthMetrics.date, epochDaysAgo(days)),
      ),
    );
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    if (r.value == null) continue;
    const day = isoDay(r.date);
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(r.value / 100);
  }
  return [...byDay.entries()]
    .map(([date, vals]) => ({ date, value: Math.round(median(vals)! * 10) / 10 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

interface ActivityWithHr {
  id: string;
  name: string;
  activityType: string;
  startDate: number;
  startDateLocal: string;
  durationS: number;
  activeDurationS: number | null;
  distanceM: number | null;
  avgHeartrate: number | null;
  metadata: unknown;
  hrSamples: HrSample[] | null;
}

async function fetchActivitiesWithHr(days: number): Promise<ActivityWithHr[]> {
  const rows = await db
    .select({
      id: activities.id,
      name: activities.name,
      activityType: activities.activityType,
      startDate: activities.startDate,
      startDateLocal: activities.startDateLocal,
      durationS: activities.durationS,
      activeDurationS: activities.activeDurationS,
      distanceM: activities.distanceM,
      avgHeartrate: activities.avgHeartrate,
      metadata: activities.metadata,
    })
    .from(activities)
    .where(gte(activities.startDate, epochDaysAgo(days)))
    .orderBy(desc(activities.startDate))
    .limit(200);

  if (rows.length === 0) return [];
  const series = await db
    .select({
      activityId: activitySeries.activityId,
      samples: activitySeries.samples,
    })
    .from(activitySeries)
    .where(
      and(
        inArray(
          activitySeries.activityId,
          rows.map((r) => r.id),
        ),
        eq(activitySeries.metric, 'heart_rate'),
      ),
    );
  const byId = new Map(series.map((s) => [s.activityId, s.samples as HrSample[]]));
  return rows.map((r) => ({ ...r, hrSamples: byId.get(r.id) ?? null }));
}

// ---------------------------------------------------------------------------
// Pure assembly helpers (exported for tests)

export function trend(daily: DayPoint[]): TrendSeries {
  return {
    daily,
    rolling7: rollingMean(daily, 7),
    latest7: round1(trailingMean(daily, 7)),
    baseline28: round1(trailingMean(daily, 28)),
  };
}

export function buildLoadDays(workouts: WorkoutPhysio[]): LoadDay[] {
  if (workouts.length === 0) return [];
  const byDay = new Map<string, number>();
  for (const w of workouts) {
    if (w.trimp == null) continue;
    byDay.set(w.day, (byDay.get(w.day) ?? 0) + w.trimp);
  }
  if (byDay.size === 0) return [];
  const first = [...byDay.keys()].sort()[0];
  const today = new Date().toISOString().slice(0, 10);
  const out: LoadDay[] = [];
  for (let d = Date.parse(first + 'T00:00:00Z'); d <= Date.parse(today + 'T00:00:00Z'); d += 86400000) {
    const date = new Date(d).toISOString().slice(0, 10);
    out.push({ date, load: Math.round((byDay.get(date) ?? 0) * 10) / 10 });
  }
  return out;
}

export function weeklyVolume(workouts: WorkoutPhysio[], weeks: number): WeekVolume[] {
  const buckets = new Map<string, WeekVolume>();
  const thisMonday = mondayOf(new Date().toISOString().slice(0, 10));
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(Date.parse(thisMonday + 'T00:00:00Z') - i * 7 * 86400000)
      .toISOString()
      .slice(0, 10);
    buckets.set(start, { weekStart: start, totalS: 0, totalDistanceM: 0, byType: {} });
  }
  for (const w of workouts) {
    const bucket = buckets.get(mondayOf(w.day));
    if (!bucket) continue;
    bucket.totalS += w.durationS;
    bucket.totalDistanceM += w.distanceM ?? 0;
    bucket.byType[w.activityType] = (bucket.byType[w.activityType] ?? 0) + w.durationS;
  }
  return [...buckets.values()];
}

export function polarisedFromZones(zones: ZoneSeconds): MetricResult<PolarisedResult> | null {
  if (totalZoneSeconds(zones) === 0) return null;
  // computePolarised expects Whoop-style millisecond zone durations.
  return computePolarised([
    {
      z0: zones.z0 * 1000,
      z1: zones.z1 * 1000,
      z2: zones.z2 * 1000,
      z3: zones.z3 * 1000,
      z4: zones.z4 * 1000,
      z5: zones.z5 * 1000,
    },
  ]);
}

// ---------------------------------------------------------------------------

function qty(v: unknown): number | null {
  if (v && typeof v === 'object' && typeof (v as { qty?: unknown }).qty === 'number') {
    return Math.round((v as { qty: number }).qty * 10) / 10;
  }
  return null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round1(v: number | null): number | null {
  return v == null ? null : Math.round(v * 10) / 10;
}

function isoDay(epochS: number): string {
  return new Date(epochS * 1000).toISOString().slice(0, 10);
}

function epochDaysAgo(days: number): number {
  return Math.floor(Date.now() / 1000) - days * 86400;
}

/** Monday of the week containing the given YYYY-MM-DD. */
export function mondayOf(day: string): string {
  const t = Date.parse(day + 'T00:00:00Z');
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7;
  return new Date(t - back * 86400000).toISOString().slice(0, 10);
}
