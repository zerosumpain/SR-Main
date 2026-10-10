// showcase.server.ts — the figures behind the landing page's showcase: what
// Daydream did this week and how useful it has been, the health record as
// totals and bands, and what the app is made of.
//
// Every part is read independently, memoised per process, timeboxed and
// failure-tolerant: a cold, slow or missing table answers with the last good
// value or null (a dash on the page) and one console line, never a slow front
// door or a 500. The reads run in parallel.
//
// Counts, totals, ratios and bands only. No note, question, title, path,
// person, place or clock time is selected, let alone returned. See showcase.ts
// for the rules every figure obeys.
//
// Nothing here is a literal: the rules come from the modules the think loop
// runs on, the app's facts from its own manifest and the route manifest.

import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { ROUTE_MANIFEST } from 'virtual:sr-route-manifest';
import { db } from '$lib/db';
import { appleHealthMetrics, heartbeatActions, heartbeatPulses, whoopRecovery, whoopSleep } from '$lib/db/schema';
import { fromStoredMetric } from '$lib/constants/apple-health-scale';
import { HEALTH_TIMEZONE, localToday } from '$lib/constants/health-day';
import { heroDayBounds } from '$lib/server/hero-slot-policy';
import { PAIR_CODE_TTL_MS, DEVICE_TOKEN_TTL_MS } from '$lib/server/native-auth';
import { CHANNELS, THINK_CADENCE_MS } from '$lib/daydream/think/questions';
import { ACTIVE_HOURS } from '$lib/daydream/budget';
import { IMPACT_WINDOW_DAYS, LOOP_START } from '$lib/daydream/impact';
import { DAILY_RAISE_CAP } from '$lib/daydream/think/notes';
import { MAX_NOTES } from '$lib/daydream/think/audit';
import { MAX_TOOL_CALLS } from '$lib/daydream/think/tools';
import manifest from '$lib/native/app-manifest.json';
import { lastNight, todaysRecovery } from './ramblers/day.server';
import type { DayFlags } from './ramblers/day';
import {
  STEP_DAYS,
  averageSleepHours,
  memoised,
  projectApp,
  projectImpact,
  projectWeek,
  recoveryMix,
  shiftDay,
  slotsPerDay,
  stepFigures,
  totalKm,
  type ThinkWeekRow,
} from './showcase-data';
import type { AppShowcase, DaydreamShowcase, HealthShowcase, ShowcaseData } from './showcase';
import { wildmindShowcase, type WildmindView } from './wildmind.server';

export type { ShowcaseData };

/** How long the front door waits for any one read before answering without it. */
const BUDGET_MS = 400;
const MIN = 60_000;
const DAY_SEC = 86_400;

// ── Daydream ────────────────────────────────────────────────────────────────

/**
 * The last seven days of thinks that ran (ok or error, never skipped: a skip
 * records that the owner was busy, so it is never counted or shown). Pulses
 * are kept fourteen days, so a week is always whole. Aggregates only.
 */
const thinkWeek = memoised<DaydreamShowcase['week']>(
  async (now) => {
    const { THINK_ACTION, THINK_RAN_OUTCOMES } = await import('$lib/daydream/think/notes.server');
    const since = new Date(now.getTime() - 7 * DAY_SEC * 1000);
    const d = sql`${heartbeatPulses.details}`;
    const [row] = await db
      .select({
        questions: sql<number>`count(*)::int`,
        ms: sql<string>`coalesce(sum(${heartbeatPulses.durationMs}), 0)::bigint`,
        lookups: sql<string>`coalesce(sum(case when jsonb_typeof(${d}->'toolCalls') = 'number' then (${d}->>'toolCalls')::numeric else 0 end), 0)::bigint`,
        rejected: sql<string>`coalesce(sum(case when jsonb_typeof(${d}->'rejected') = 'array' then jsonb_array_length(${d}->'rejected') else 0 end), 0)::bigint`,
        drops: sql<string>`coalesce(sum(case when jsonb_typeof(${d}->'citationDrops') = 'number' then (${d}->>'citationDrops')::numeric else 0 end), 0)::bigint`,
        areas: sql<number>`count(distinct ${d}->>'channel')::int`,
      })
      .from(heartbeatPulses)
      .innerJoin(heartbeatActions, eq(heartbeatActions.id, heartbeatPulses.actionId))
      .where(and(eq(heartbeatActions.name, THINK_ACTION), inArray(heartbeatPulses.outcome, [...THINK_RAN_OUTCOMES]), gte(heartbeatPulses.ts, since)));
    return projectWeek(row as ThinkWeekRow | undefined);
  },
  { name: 'daydream week', ttlMs: 5 * MIN, budgetMs: BUDGET_MS, fallback: null },
);

/**
 * Impact, cut to its public numbers. Shared with capabilities.server.ts's hit
 * rate, so the front door runs `loadImpactCounts()` at most once every five minutes
 * however many sections print a figure from it.
 */
export const daydreamImpact = memoised<DaydreamShowcase['impact']>(
  async (now) => {
    // Counts only: the read never selects a title, a link or a note's evidence.
    const { loadImpactCounts } = await import('$lib/daydream/impact.server');
    return projectImpact(await loadImpactCounts(now));
  },
  { name: 'daydream impact', ttlMs: 5 * MIN, budgetMs: BUDGET_MS, fallback: null },
);

function daydreamRules(): DaydreamShowcase['rules'] {
  const cadenceMinutes = THINK_CADENCE_MS / MIN;
  return {
    cadenceMinutes,
    activeHours: { start: ACTIVE_HOURS.start, end: ACTIVE_HOURS.end },
    slotsPerDay: slotsPerDay(ACTIVE_HOURS, cadenceMinutes),
    areas: CHANNELS.length,
    maxLookups: MAX_TOOL_CALLS,
    maxNotes: MAX_NOTES,
    dailyRaiseCap: DAILY_RAISE_CAP,
    windowDays: IMPACT_WINDOW_DAYS,
    loopStart: LOOP_START,
  };
}

// ── Health ──────────────────────────────────────────────────────────────────

/** London midnight (unix seconds) at the start of a `YYYY-MM-DD` London day. */
function londonStart(day: string): number {
  return heroDayBounds(new Date(`${day}T12:00:00Z`)).start;
}

/**
 * The London calendar day of an hourly row's start, in SQL. The zone is inlined
 * as a literal (it is a constant, never input): as a bound parameter it would
 * be a different placeholder in SELECT and GROUP BY, which Postgres refuses.
 */
const londonDay = sql<string>`to_char(to_timestamp(${appleHealthMetrics.date}) at time zone ${sql.raw(`'${HEALTH_TIMEZONE.replace(/'/g, "''")}'`)}, 'YYYY-MM-DD')`;

/** Daily step totals since 1 January, and far enough back for a full window of days with readings in January. */
const stepsYear = memoised<Pick<HealthShowcase, 'steps30' | 'stepsYear' | 'daysOver10k' | 'bestDay'>>(
  async (now) => {
    const today = localToday(now);
    const from = Math.min(londonStart(`${today.slice(0, 4)}-01-01`), londonStart(shiftDay(today, -2 * STEP_DAYS)));
    const nowSec = Math.floor(now.getTime() / 1000);
    const rows = await db
      .select({ day: londonDay, total: sql<string>`coalesce(sum(${appleHealthMetrics.value}), 0)::bigint` })
      .from(appleHealthMetrics)
      .where(
        and(
          eq(appleHealthMetrics.metricName, 'step_count'),
          gte(appleHealthMetrics.date, from),
          lt(appleHealthMetrics.date, nowSec + 1),
        ),
      )
      .groupBy(londonDay);
    return stepFigures(
      rows.map((r) => ({ date: String(r.day), steps: Math.round(fromStoredMetric(Number(r.total))) })),
      today,
    );
  },
  { name: 'steps', ttlMs: 10 * MIN, budgetMs: BUDGET_MS, fallback: { steps30: null, stepsYear: null, daysOver10k: null, bestDay: null } },
);

/** Walking and running distance since 1 January, everyday walking included. Summed per stored unit. */
const kmYear = memoised<number | null>(
  async (now) => {
    const today = localToday(now);
    const nowSec = Math.floor(now.getTime() / 1000);
    const rows = await db
      .select({ units: appleHealthMetrics.units, total: sql<string>`coalesce(sum(${appleHealthMetrics.value}), 0)::bigint` })
      .from(appleHealthMetrics)
      .where(
        and(
          eq(appleHealthMetrics.metricName, 'walking_running_distance'),
          gte(appleHealthMetrics.date, londonStart(`${today.slice(0, 4)}-01-01`)),
          lt(appleHealthMetrics.date, nowSec + 1),
        ),
      )
      .groupBy(appleHealthMetrics.units);
    return totalKm(rows.map((r) => ({ units: r.units, total: fromStoredMetric(Number(r.total)) })));
  },
  { name: 'distance', ttlMs: 10 * MIN, budgetMs: BUDGET_MS, fallback: null },
);

/** Thirty days of recovery by band, and the last seven main sleeps as an average. */
const whoopMonth = memoised<Pick<HealthShowcase, 'recovery30' | 'sleepAvg7'>>(
  async (now) => {
    const nowSec = Math.floor(now.getTime() / 1000);
    const [scores, nights] = await Promise.all([
      db
        .select({ score: whoopRecovery.recoveryScore })
        .from(whoopRecovery)
        .where(and(gte(whoopRecovery.createdDate, nowSec - 30 * DAY_SEC), lt(whoopRecovery.createdDate, nowSec + 1))),
      db
        .select({ inBed: whoopSleep.totalInBed, awake: whoopSleep.totalAwake })
        .from(whoopSleep)
        .where(and(eq(whoopSleep.nap, false), gte(whoopSleep.endDate, nowSec - 7 * DAY_SEC), lt(whoopSleep.endDate, nowSec + 1)))
        .orderBy(desc(whoopSleep.endDate))
        .limit(7),
    ]);
    return { recovery30: recoveryMix(scores.map((r) => r.score)), sleepAvg7: averageSleepHours(nights) };
  },
  { name: 'recovery and sleep', ttlMs: 30 * MIN, budgetMs: BUDGET_MS, fallback: { recovery30: null, sleepAvg7: null } },
);

/** Last night's sleep and today's recovery as bands: the rambler's own reading when the page has one. */
async function bands(now: Date, day?: Promise<DayFlags>): Promise<HealthShowcase['bands']> {
  if (day) {
    const d = await day.catch(() => null);
    return { sleep: d?.sleep ?? null, recovery: d?.recovery ?? null };
  }
  const nowSec = Math.floor(now.getTime() / 1000);
  const [sleep, recovery] = await Promise.all([lastNight(nowSec), todaysRecovery(nowSec)]);
  return { sleep, recovery };
}

// ── The app ─────────────────────────────────────────────────────────────────

let app: AppShowcase | null = null;

/** Static per build: the manifest is committed and the routes are the build's own. */
function appFacts(): AppShowcase {
  app ??= projectApp(manifest, ROUTE_MANIFEST, { pairCodeMs: PAIR_CODE_TTL_MS, deviceTokenMs: DEVICE_TOKEN_TTL_MS });
  return app;
}

// ── Together ────────────────────────────────────────────────────────────────

function wantsFixture(): boolean {
  return dev && env.LANDING_SHOWCASE_FIXTURE === '1';
}

export interface LoadShowcaseOptions {
  /** The page's own rambler reading, so the bands cost no second query. */
  day?: Promise<DayFlags>;
  /** The view the page is rendered in: the notes get Wildmind's map drawn their way on the server. */
  view?: string;
}

/** The Wildmind drawing a page view wants from the server (only the notes draw theirs there). */
const wildmindView = (view: string | undefined): WildmindView | null => (view === 'notes' ? 'notes' : null);

export async function loadShowcase(now = new Date(), opts: LoadShowcaseOptions = {}): Promise<ShowcaseData> {
  const rules = daydreamRules();

  // Local preview only: the synthetic database has nothing to count. The
  // import sits inside the dev branch so a production build drops the module.
  if (wantsFixture()) {
    const { showcaseFixture } = await import('./showcase.fixture');
    const f = showcaseFixture(localToday(now));
    const wildmind = await wildmindShowcase(now, null, wildmindView(opts.view));
    return { daydream: { ...f.daydream, rules }, health: f.health, app: appFacts(), fixture: true, ...(wildmind ? { wildmind } : {}) };
  }

  const [week, impact, steps, km, whoop, band, wildmind] = await Promise.all([
    thinkWeek(now),
    daydreamImpact(now),
    stepsYear(now),
    kmYear(now),
    whoopMonth(now),
    bands(now, opts.day),
    wildmindShowcase(now, null, wildmindView(opts.view)),
  ]);

  return {
    daydream: { week, impact, rules },
    health: { ...steps, kmYear: km, ...whoop, bands: band, kinds: null },
    app: appFacts(),
    ...(wildmind ? { wildmind } : {}),
  };
}
