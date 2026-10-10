// showcase-data.ts — the pure half of the landing showcase's data: memo and
// timebox plumbing, London-day arithmetic, rounding, banding and the
// projections that cut each feature's own shape down to the public figures in
// showcase.ts. The reads are in showcase.server.ts; nothing here touches a
// database, so all of it is tested once in showcase-data.test.ts.
//
// Every projection keeps counts, totals, ratios and bands only. A function that
// receives a richer row (an Impact with titles nearby, a manifest with
// descriptions) copies out the numbers and the public names and nothing else.

import type { Impact } from '$lib/daydream/impact';
import { recoveryBand } from './ramblers/day';
import type { AppShowcase, DaydreamShowcase, HealthShowcase } from './showcase';

// ── Memo and timebox ────────────────────────────────────────────────────────

/** Resolve with `p`, or with `fallback` once `ms` have passed, whichever is first. */
export function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

export interface MemoOptions<T> {
  /** For the one console line a failure writes. */
  name: string;
  /** How long a good answer is reused. */
  ttlMs: number;
  /** How long the front door waits before answering with the last good value. */
  budgetMs: number;
  /** What a cold failure answers with (the honest "not answering"). */
  fallback: T;
  /** After a failure, how long to answer from the last good value before asking again. */
  retryMs?: number;
  /** Where the failure line goes; injectable for tests. */
  log?: (line: string) => void;
}

/**
 * One memoised, timeboxed, failure-tolerant read. Concurrent callers share the
 * read in flight, a read that outlives the budget still lands in the memo for
 * the next caller, and a failure answers with the last good value (or the
 * fallback when there never was one) and writes one console line.
 */
export function memoised<T>(load: (now: Date) => Promise<T>, opts: MemoOptions<T>) {
  const retryMs = opts.retryMs ?? 60_000;
  const log = opts.log ?? ((line: string) => console.error(line));
  let last: { at: number; value: T } | null = null;
  let failedAt: number | null = null;
  let inflight: Promise<T> | null = null;

  const read = (now: Date): Promise<T> => {
    const t = now.getTime();
    if (last && t - last.at < opts.ttlMs) return Promise.resolve(last.value);
    if (failedAt !== null && t - failedAt < retryMs) return Promise.resolve(last?.value ?? opts.fallback);
    if (!inflight) {
      inflight = Promise.resolve()
        .then(() => load(now))
        .then((value) => {
          last = { at: t, value };
          failedAt = null;
          return value;
        })
        .catch((err: unknown) => {
          failedAt = t;
          log(`[landing] showcase ${opts.name} unavailable: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}`);
          return last?.value ?? opts.fallback;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return within(inflight, opts.budgetMs, last?.value ?? opts.fallback);
  };
  /** Forget everything (tests only). */
  read.reset = () => {
    last = null;
    failedAt = null;
    inflight = null;
  };
  return read;
}

// ── Numbers ─────────────────────────────────────────────────────────────────

/** One decimal place, or null for anything that is not a finite number. */
export function round1(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

/** A count off the wire (Postgres hands bigints back as strings). Never negative. */
export function toCount(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

// ── Daydream ────────────────────────────────────────────────────────────────

/**
 * Thinking slots in a waking day, as the Engine Room's DreamEmblem works it
 * out: the scheduler opens the think's window at its start (heartbeat
 * `nextWindowOpening`) and runs it every cadence while the clock is before the
 * end (the window is half-open), so 07:00 to 23:00 every 45 minutes is 07:00,
 * 07:45 … 22:45, twenty-two slots: the span over the cadence, rounded up.
 */
export function slotsPerDay(activeHours: { start: number; end: number }, cadenceMinutes: number): number {
  if (!(cadenceMinutes > 0) || activeHours.end <= activeHours.start) return 0;
  return Math.ceil(((activeHours.end - activeHours.start) * 60) / cadenceMinutes);
}

/** The one aggregate row behind the week's figures. */
export interface ThinkWeekRow {
  questions: unknown;
  ms: unknown;
  lookups: unknown;
  rejected: unknown;
  drops: unknown;
  areas: unknown;
}

/** A week of thinks to its public figures. A week with no thinks is a real zero, not a gap. */
export function projectWeek(row: ThinkWeekRow | undefined): NonNullable<DaydreamShowcase['week']> {
  return {
    questions: toCount(row?.questions),
    hours: round1(toCount(row?.ms) / 3_600_000) ?? 0,
    lookups: toCount(row?.lookups),
    struckOut: toCount(row?.rejected) + toCount(row?.drops),
    areasCovered: toCount(row?.areas),
  };
}

/** Impact cut down to the numbers the showcase prints. No titles, hrefs, areas or kinds. */
export function projectImpact(impact: Impact): NonNullable<DaydreamShowcase['impact']> {
  return {
    hitRate: impact.current.hitRate,
    previousHitRate: impact.previous.hitRate,
    rated: impact.current.rated,
    noticed: impact.current.noticed,
    shipped: impact.builds.shipped,
    accepted: impact.builds.accepted,
    weeks: impact.weeks.map((w) => ({ start: w.start, useful: w.useful, notUseful: w.notUseful, undecided: w.undecided })),
  };
}

// ── London days ─────────────────────────────────────────────────────────────

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` shifted by whole days. Calendar arithmetic, so clock changes cannot bite. */
export function shiftDay(day: string, by: number): string {
  if (!ISO_DAY.test(day)) throw new Error(`not a day: ${day}`);
  const t = Date.parse(`${day}T00:00:00Z`) + by * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** The `n` complete days before `today`, oldest first. */
export function daysBefore(today: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftDay(today, i - n));
}

/** Steps a day must reach to count as a ten-thousand day. */
export const TEN_THOUSAND = 10_000;

/** Days of steps the chart covers, ending on the latest complete day with readings. */
export const STEP_DAYS = 30;

/**
 * Daily step totals (London days) to the year's figures. `days` is every day
 * with readings since at least 1 January and far enough back for a full
 * window. `steps30` is the STEP_DAYS days that end on the latest COMPLETE day
 * with readings (never later than yesterday), oldest first, null for a day
 * with none. It carries no dates: the window ends where the readings end, so
 * neither the chart nor the payload can say when the phone last sent anything.
 */
export function stepFigures(
  days: Array<{ date: string; steps: number }>,
  today: string,
): Pick<HealthShowcase, 'steps30' | 'stepsYear' | 'daysOver10k' | 'bestDay'> {
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const clean = days
    .filter((d) => ISO_DAY.test(d.date) && Number.isFinite(d.steps) && d.steps >= 0)
    .map((d) => ({ date: d.date, steps: Math.round(d.steps) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const thisYear = clean.filter((d) => d.date >= yearStart && d.date <= today);
  const completeThisYear = thisYear.filter((d) => d.date < today);
  const latest = clean.filter((d) => d.date < today).at(-1)?.date ?? null;
  const by = new Map(clean.map((d) => [d.date, d.steps]));
  const steps30 = latest ? daysBefore(shiftDay(latest, 1), STEP_DAYS).map((d) => by.get(d) ?? null) : null;
  const best = completeThisYear.reduce<{ date: string; steps: number } | null>(
    (b, d) => (d.steps > 0 && (!b || d.steps > b.steps) ? d : b),
    null,
  );

  return {
    steps30,
    stepsYear: thisYear.length ? thisYear.reduce((s, d) => s + d.steps, 0) : null,
    daysOver10k: completeThisYear.length ? completeThisYear.filter((d) => d.steps >= TEN_THOUSAND).length : null,
    bestDay: best,
  };
}

/** Kilometres per stored unit. Rows in any other unit are left out, never guessed. */
const KM_PER: Record<string, number> = { km: 1, m: 0.001, mi: 1.609344 };

/** Walking + running distance totals, grouped by their stored unit, to kilometres (one decimal). */
export function totalKm(rows: Array<{ units: string; total: number }>): number | null {
  let km: number | null = null;
  for (const r of rows) {
    const per = KM_PER[r.units];
    if (per === undefined || !Number.isFinite(r.total)) continue;
    km = (km ?? 0) + r.total * per;
  }
  return round1(km);
}

/** Recovery scores to days per WHOOP band. Null when there are none. */
export function recoveryMix(scores: number[]): HealthShowcase['recovery30'] {
  const mix = { high: 0, mid: 0, low: 0 };
  let any = false;
  for (const s of scores) {
    const band = recoveryBand(s);
    if (!band) continue;
    mix[band] += 1;
    any = true;
  }
  return any ? mix : null;
}

/** Average hours asleep (in bed less awake, milliseconds in) to one decimal. Null with no nights. */
export function averageSleepHours(nights: Array<{ inBed: number; awake: number }>): number | null {
  const hours = nights
    .map((n) => Math.max(0, n.inBed - n.awake) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h > 0);
  return hours.length ? round1(hours.reduce((s, h) => s + h, 0) / hours.length) : null;
}

// ── The app ─────────────────────────────────────────────────────────────────

/** The parts of the app manifest the showcase reads. */
export interface AppManifestInput {
  targets: unknown[];
  tabs: string[];
  watchPages: string[];
  widgets: Array<{ name: string; surface: string }>;
  complications: Array<{ name: string }>;
  intents: Array<{ title: string }>;
  games: Array<{ title: string }>;
  backgroundModes: string[];
  liveActivities: boolean;
}

/** Native endpoints and the areas they cover (the first path segment under /api/native/). */
export function nativeCounts(routes: Array<{ kind: string; path: string }>): { endpoints: number; areas: number } {
  const native = routes.filter((r) => r.kind === 'api' && r.path.startsWith('/api/native/'));
  const areas = new Set(native.map((r) => r.path.split('/')[3]?.replace(/^\[.*\]$/, 'other') || 'other'));
  return { endpoints: native.length, areas: areas.size };
}

/** The app's public facts from its manifest, its routes and its key lifetimes. Names only. */
export function projectApp(
  manifest: AppManifestInput,
  routes: Array<{ kind: string; path: string }>,
  lifetimes: { pairCodeMs: number; deviceTokenMs: number },
): AppShowcase {
  const native = nativeCounts(routes);
  return {
    targets: manifest.targets.length,
    tabs: manifest.tabs.length,
    tabNames: [...manifest.tabs],
    watchPages: manifest.watchPages.length,
    widgets: manifest.widgets.map((w) => ({ name: w.name, surface: w.surface })),
    complications: manifest.complications.map((c) => ({ name: c.name })),
    intents: manifest.intents.map((i) => ({ title: i.title })),
    games: manifest.games.map((g) => g.title),
    backgroundModes: manifest.backgroundModes.length,
    liveActivities: manifest.liveActivities === true,
    nativeEndpoints: native.endpoints,
    nativeAreas: native.areas,
    pairCodeMinutes: Math.round(lifetimes.pairCodeMs / 60_000),
    deviceTokenDays: Math.round(lifetimes.deviceTokenMs / 86_400_000),
  };
}
