import { createHash } from 'node:crypto';
import { getFromExtracted } from './extracted-app';
import type { HealthContext } from './health-context-contract';

/**
 * /health, sized for a phone.
 *
 * The page has nine sections and reads top to bottom; a phone is opened for one
 * question — "how am I doing today" — and the honest answer to that is four
 * figures, each with the thing that makes a figure mean anything: a unit, a
 * window, and yesterday to compare it against. /health's own methodology says
 * it in the negative: a header figure is a number with no frame.
 *
 * Nothing here recomputes a health metric. The values arrive from SR-Health's
 * `/api/health/context` and `/api/health/stats` over the service lane, already
 * scaled and already aggregated — which is the whole point of the lane and also
 * the trap this repository has fallen into before. Steps and strain are stored
 * ×100; recovery is a MAX over a day, not a SUM; sleep stages are UNIONED
 * because they overlap between sources. Every one of those is decided in
 * SR-Health. Re-deriving a figure here would be re-deciding them, silently and
 * wrongly.
 */

export interface NativeHealthFigure {
  key: 'recovery' | 'hrv' | 'rhr' | 'sleep';
  label: string;
  /** The raw number, for a chart. */
  value: number;
  unit: string;
  /** Rendered, because rounding is an editorial decision and not the app's. */
  display: string;
  /** Movement against the comparison the window implies; null when unknown. */
  delta: number | null;
  deltaDisplay: string | null;
  direction: 'up' | 'down' | 'flat' | null;
  /** Whether that movement is the good direction FOR THIS METRIC. A resting
   *  heart rate going down is the body recovering; HRV going down is not. */
  improving: boolean | null;
  caption: string;
  /** Oldest to newest, for a sparkline. Days with no measurement are absent
   *  from the source series already. */
  series: number[];
}

export interface NativeHealthWeek {
  activities: number;
  distanceKm: number;
  durationMinutes: number;
  elevationM: number;
  avgRecovery: number;
  avgSleep: number;
}

export interface NativeHealthSummary {
  generatedAt: string;
  /** With no real day in the window the whole series is a demonstration. The
   *  app says so on the screen rather than presenting it as measurement. */
  isMock: boolean;
  strap: string;
  readiness: { score: number; label: string; recommendation: string } | null;
  figures: NativeHealthFigure[];
  week: NativeHealthWeek | null;
  records: Array<{ label: string; display: string; date: string | null }>;
  /**
   * A short hash of the figures as they stand.
   *
   * This is what makes "notify me when it changes" cheap: the watcher compares
   * one string instead of four numbers and a null. It covers the displayed
   * values only — not `generatedAt`, which moves every call, and not the
   * series, which gains a day at midnight whether or not anything happened.
   */
  fingerprint: string;
}

interface StatsResponse {
  weekly?: {
    activities?: number;
    totalDistance?: number;
    totalDuration?: number;
    totalElevation?: number;
    avgRecovery?: number;
    avgSleep?: number;
  };
  personalRecords?: Array<{ label: string; value: number; unit: string; display?: string; date?: string | null }>;
}

/** One hour. The figures move on a daily rhythm; a fresher read buys nothing. */
const CACHE_MS = 60_000;
let cached: { at: number; value: NativeHealthSummary } | null = null;

export async function getNativeHealthSummary(
  { fresh = false }: { fresh?: boolean } = {},
): Promise<NativeHealthSummary> {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  // Settled, not all: the four headline figures are the payload and the weekly
  // block is an enrichment. Health being slow to answer one of two questions
  // must not empty the screen.
  const [contextResult, statsResult] = await Promise.allSettled([
    getFromExtracted<HealthContext>('health', '/api/health/context', { timeoutMs: 6000 }),
    getFromExtracted<StatsResponse>('health', '/api/health/stats', { timeoutMs: 6000 }),
  ]);

  if (contextResult.status === 'rejected') throw contextResult.reason;
  const context = contextResult.value;
  const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;

  const series = context.days ?? [];

  /**
   * Zero is MISSING in this data, and that is the trap worth naming.
   *
   * A day with no HRV sample arrives as `0`, not as `null` — the series service
   * fills a gap rather than dropping it, because a hole plots as a hole in
   * every chart drawn from the same array. So `52 ms` and `0 ms` are not two
   * readings, they are a reading and a silence, and rendering the second one as
   * a number is a confident statement about a heart that did not report.
   *
   * Everything downstream keys on the em dash: the app strips the unit from it,
   * and the fingerprint still moves when a figure goes missing, which is itself
   * worth being told about.
   */
  const render = (value: number, format: (v: number) => string): string =>
    Number.isFinite(value) && value > 0 ? format(value) : '—';

  const figures: NativeHealthFigure[] = [
    {
      key: 'recovery',
      label: 'Recovery',
      value: context.today.rec,
      unit: '%',
      display: render(context.today.rec, (v) => `${Math.round(v)}`),
      delta: null,
      deltaDisplay: null,
      direction: null,
      improving: null,
      caption: 'today',
      series: series.map((d) => d.rec),
    },
    {
      key: 'hrv',
      label: 'HRV',
      value: context.today.hrv,
      unit: 'ms',
      display: render(context.today.hrv, (v) => `${Math.round(v)}`),
      delta: context.todayDeltas.hrvDeltaPct,
      deltaDisplay: percent(context.todayDeltas.hrvDeltaPct),
      direction: sign(context.todayDeltas.hrvDeltaPct),
      improving: improving(context.todayDeltas.hrvDeltaPct, 'up'),
      caption: 'vs yesterday',
      series: series.map((d) => d.hrv),
    },
    {
      key: 'rhr',
      label: 'Resting HR',
      value: context.today.rhr,
      unit: 'bpm',
      display: render(context.today.rhr, (v) => `${Math.round(v)}`),
      delta: context.todayDeltas.rhrDelta,
      deltaDisplay: signed(context.todayDeltas.rhrDelta, 'bpm'),
      direction: sign(context.todayDeltas.rhrDelta),
      // The one metric where down is the good direction.
      improving: improving(context.todayDeltas.rhrDelta, 'down'),
      caption: 'vs yesterday',
      series: series.map((d) => d.rhr),
    },
    {
      key: 'sleep',
      label: 'Sleep',
      value: context.today.slept,
      unit: 'h',
      display: render(context.today.slept, hoursMinutes),
      delta: context.todayDeltas.sleepDelta,
      deltaDisplay: signedHours(context.todayDeltas.sleepDelta),
      direction: sign(context.todayDeltas.sleepDelta),
      improving: improving(context.todayDeltas.sleepDelta, 'up'),
      caption: 'last night',
      series: series.map((d) => d.slept),
    },
  ];

  const weekly = stats?.weekly;
  const week: NativeHealthWeek | null = weekly
    ? {
        activities: weekly.activities ?? 0,
        // Metres in, kilometres out — the source is metres and a phone tile
        // showing `41,203` is a number nobody reads as a distance.
        distanceKm: round1((weekly.totalDistance ?? 0) / 1000),
        durationMinutes: Math.round((weekly.totalDuration ?? 0) / 60),
        elevationM: Math.round(weekly.totalElevation ?? 0),
        avgRecovery: weekly.avgRecovery ?? 0,
        avgSleep: weekly.avgSleep ?? 0,
      }
    : null;

  const summary: NativeHealthSummary = {
    generatedAt: new Date().toISOString(),
    isMock: context.seriesIsMock,
    strap: context.strap,
    readiness: context.readiness,
    figures,
    week,
    records: (stats?.personalRecords ?? []).map((r) => ({
      label: r.label,
      display: r.display ?? `${r.value} ${r.unit}`,
      date: r.date ?? null,
    })),
    fingerprint: '',
  };
  summary.fingerprint = fingerprintOf(summary);

  cached = { at: Date.now(), value: summary };
  return summary;
}

/**
 * The hash the watcher compares.
 *
 * Rounded before hashing. HRV arrives as an integer today, but a future source
 * that reports 52.0001 would otherwise change the fingerprint every poll and
 * turn the three-hour floor into the only thing standing between the phone and
 * a notification every three hours, for ever.
 */
export function fingerprintOf(summary: NativeHealthSummary): string {
  const material = [
    ...summary.figures.map((f) => `${f.key}:${Math.round(f.value * 10) / 10}`),
    `readiness:${summary.readiness ? Math.round(summary.readiness.score) : 'none'}`,
    `mock:${summary.isMock ? 1 : 0}`,
  ].join('|');
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

function sign(value: number | null | undefined): 'up' | 'down' | 'flat' | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

function improving(value: number | null | undefined, good: 'up' | 'down'): boolean | null {
  const direction = sign(value);
  if (direction === null || direction === 'flat') return null;
  return good === 'up' ? direction === 'up' : direction === 'down';
}

function percent(value: number): string | null {
  if (!Number.isFinite(value) || value === 0) return null;
  return `${value > 0 ? '+' : ''}${Math.round(value)}%`;
}

function signed(value: number, unit: string): string | null {
  if (!Number.isFinite(value) || value === 0) return null;
  return `${value > 0 ? '+' : ''}${Math.round(value)} ${unit}`;
}

function signedHours(value: number): string | null {
  if (!Number.isFinite(value) || Math.abs(value) < 0.05) return null;
  const minutes = Math.round(Math.abs(value) * 60);
  return `${value > 0 ? '+' : '−'}${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ''}${minutes % 60}m`;
}

function hoursMinutes(value: number): string {
  const minutes = Math.round(value * 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
