// The shell around the coach: read the state, call the pure decisions, and try
// to draw a line on the ground through the targets.
//
// Everything in here is allowed to fail and nothing in here is allowed to
// throw. The point of the card is that it is on the page every morning, and a
// dead openrouteservice key or an empty segments table degrades it — a missing
// route, a stated reason — rather than removing it. On homeserv there is no
// ORS_API_KEY at all, so the degraded path IS the local development path and
// gets exercised on every page load, which is exactly how it should be.

import { desc, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { activities, activitySegmentEfforts, activitySegments } from '$lib/db/schema';
import { encodePolyline } from '$lib/health/polyline';
import type { MetricResult } from '$lib/health/analytics/types';
import type { MonotonyResult } from '$lib/health/analytics/monotony';
import type { PolarisedResult } from '$lib/health/analytics/polarised';
import { getMonotony } from '$lib/health/services/monotony-service';
import { getPolarised } from '$lib/health/services/polarised-service';
import {
  applyProgression,
  INTENSITY_LABELS,
  rankGettableSegments,
  type CoachSport,
  type GettableTarget,
  type Intensity,
  type SportCounts,
  type TrainingState,
} from './coach';
import { activityLabel } from './format';
import { gradeDifficulty, type DifficultyBand } from './difficulty';
import { getTrailsDashboard, type TrailsDashboard } from './physio-service';
import { proposeSession } from './planner';
import {
  ORS_KEY_HELP,
  ORS_PROFILES,
  OrsError,
  orsConfigured,
  viaRoute,
  type PlannerSport,
} from './ors';
import { scoreRoute, type Coord } from './scoring';
import { listSegments, type SegmentListRow } from './segments-service';
import { haversineM } from './track';

// ---------------------------------------------------------------------------
// Shapes — this is exactly what CoachCard renders.

export interface CoachSession {
  sport: CoachSport;
  sportLabel: string;
  intensity: Intensity;
  intensityLabel: string;
  targetDistanceM: number;
  targetMinutes: number;
  /** One plain-English line per rule that fired. */
  why: string[];
  /** Which of this repo's four disagreeing ACWRs the progression read. */
  acwrSource: string;
  /** False for a sport openrouteservice has no profile for — swim, other. */
  routable: boolean;
}

export interface CoachRoute {
  distanceM: number;
  ascentM: number | null;
  /** ORS's own moving-time estimate for the profile. */
  estimatedTimeS: number;
  /** scoreRoute's verdict, 0..1. */
  score: number;
  notes: string[];
  difficulty: DifficultyBand;
  /** The target segments this route strings together, in the order it meets them. */
  through: string[];
  /**
   * An encoded polyline for a small static preview, downsampled to about 400
   * points. NOT the geometry — `PlannedRoute.coordinates` is tens of thousands
   * of numbers and route payloads on this site have already 413'd. Anyone who
   * wants the real line plans it at /health/plan.
   */
  polyline: string;
  points: number;
}

export interface DailyPlan {
  generatedAt: string;
  session: CoachSession;
  targets: GettableTarget[];
  route: CoachRoute | null;
  /** One calm sentence when there is no route. Null when there is one. */
  routeNote: string | null;
  /** Anything that failed on the way, named rather than hidden. */
  degraded: string[];
}

// ---------------------------------------------------------------------------
// Tuning

/** How many candidates get their per-effort EF read before the final cut. */
const SHORTLIST = 6;
/** How many targets the card names. */
const TARGET_LIMIT = 3;
/** Targets further apart than this are not one session. */
const CLUSTER_RADIUS_M = 12_000;
/** Points in the preview polyline. ~400 is a legible thumbnail at ~2 KB. */
const PREVIEW_POINTS = 400;

// ---------------------------------------------------------------------------

async function soft<T>(label: string, fn: () => Promise<T>, degraded: string[]): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[trails/coach] ${label} failed:`, message);
    degraded.push(`${label}: ${message}`);
    return null;
  }
}

/** Today where the workouts happened, not where the server is. */
function localToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

/**
 * The day before a `YYYY-MM-DD`, done as calendar arithmetic on the parts.
 *
 * Never `new Date(day)` then `setDate` — the workouts' days are local strings
 * and re-interpreting one through the server's zone is how a 00:30 BST run
 * lands on the wrong day.
 */
function previousDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * How hard yesterday was, from the only evidence there is: mean heart rate
 * against this profile's maximum. No heart rate means no answer — null, not a
 * guess, because the monotony rule uses this to pick something DIFFERENT and a
 * wrong guess sends it the wrong way.
 */
export function classifyIntensity(avgBpm: number | null, hrMax: number): Intensity | null {
  if (avgBpm == null || !Number.isFinite(avgBpm) || avgBpm <= 0 || !(hrMax > 0)) return null;
  const pct = avgBpm / hrMax;
  if (pct < 0.65) return 'recovery';
  if (pct < 0.75) return 'easy';
  if (pct < 0.84) return 'steady';
  if (pct < 0.91) return 'threshold';
  return 'intervals';
}

function yesterdayIntensity(dashboard: TrailsDashboard | null): Intensity | null {
  if (!dashboard) return null;
  const target = previousDay(localToday());
  // Hardest session of the day, where there was more than one.
  const candidates = dashboard.workouts.filter((w) => w.day === target);
  if (!candidates.length) return null;
  const hrMax = dashboard.profile.hrMax;
  const found = candidates
    .map((w) => classifyIntensity(w.avgHeartrate, hrMax))
    .filter((i): i is Intensity => i != null);
  if (!found.length) return null;
  const order: Intensity[] = ['recovery', 'easy', 'steady', 'threshold', 'intervals'];
  return found.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0];
}

/**
 * Outings per EFFECTIVE type over two windows.
 *
 * `activity_type` holds what the phone said and ingest clobbers it on every
 * sync; the owner's correction lives in `type_override`. Counting the raw
 * column would have the coach nudging toward a sport that was renamed away
 * months ago, so the coalesce here is `effectiveType()` in SQL.
 */
async function sportCounts(): Promise<{ last8Weeks: SportCounts; last2Weeks: SportCounts }> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .select({
      type: sql<string>`coalesce(nullif(trim(${activities.typeOverride}), ''), ${activities.activityType})`,
      recent: sql<number>`count(*) filter (where ${activities.startDate} >= ${now - 14 * 86400})::int`,
      all: sql<number>`count(*)::int`,
    })
    .from(activities)
    .where(sql`${activities.startDate} >= ${now - 56 * 86400}`)
    .groupBy(sql`coalesce(nullif(trim(${activities.typeOverride}), ''), ${activities.activityType})`);

  const last8Weeks: SportCounts = {};
  const last2Weeks: SportCounts = {};
  for (const r of rows) {
    if (!r.type) continue;
    last8Weeks[r.type] = r.all;
    last2Weeks[r.type] = r.recent;
  }
  return { last8Weeks, last2Weeks };
}

/** A list row, in the shape the pure scorer wants. `form` already holds the
 *  PB, the gap and the age; the recent best is the gap applied to the PB. */
function toCandidate(row: SegmentListRow, recentEf?: Array<number | null>) {
  const pb = row.form.pbDurationS ?? row.bests.durationS;
  const gapPct = row.form.gapPct;
  return {
    id: row.id,
    name: row.name,
    activityType: row.activityType,
    distanceM: row.distanceM,
    pbDurationS: pb,
    recentBestS: pb != null && gapPct != null ? pb * (1 + gapPct) : null,
    effortCount: row.effortCount,
    daysSincePb: row.form.daysSincePb,
    recentEf,
  };
}

// ---------------------------------------------------------------------------
// Shortlist detail

interface ShortlistDetail {
  /** Efficiency factor of the five most recent efforts, NEWEST first. */
  recentEf: Array<number | null>;
  /** First and last point of the segment, in its own direction. */
  first: [number, number] | null;
  last: [number, number] | null;
}

/**
 * Everything the shortlist needs, in two queries.
 *
 * The endpoints come out of the jsonb with `-> 0` and `-> -1` rather than by
 * selecting `coordinates` and indexing in JavaScript: a segment's geometry is
 * hundreds of points and the route only ever wants two of them.
 */
async function shortlistDetail(ids: number[]): Promise<Map<number, ShortlistDetail>> {
  const out = new Map<number, ShortlistDetail>();
  if (!ids.length) return out;

  const [ends, efforts] = await Promise.all([
    db
      .select({
        id: activitySegments.id,
        first: sql<unknown>`${activitySegments.coordinates} -> 0`,
        last: sql<unknown>`${activitySegments.coordinates} -> -1`,
      })
      .from(activitySegments)
      .where(inArray(activitySegments.id, ids)),
    db
      .select({
        segmentId: activitySegmentEfforts.segmentId,
        efficiencyFactor: activitySegmentEfforts.efficiencyFactor,
      })
      .from(activitySegmentEfforts)
      .where(inArray(activitySegmentEfforts.segmentId, ids))
      .orderBy(desc(activitySegmentEfforts.startedAt)),
  ]);

  const point = (v: unknown): [number, number] | null => {
    if (!Array.isArray(v) || v.length < 2) return null;
    const [lng, lat] = v;
    return typeof lng === 'number' && typeof lat === 'number' ? [lng, lat] : null;
  };

  for (const id of ids) out.set(id, { recentEf: [], first: null, last: null });
  for (const row of ends) {
    const entry = out.get(row.id);
    if (entry) {
      entry.first = point(row.first);
      entry.last = point(row.last);
    }
  }
  for (const e of efforts) {
    const entry = out.get(e.segmentId);
    if (entry && entry.recentEf.length < 5) entry.recentEf.push(e.efficiencyFactor);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Route

type Waypoint = [number, number];

interface TargetGeometry {
  id: number;
  name: string;
  /** First and last point of the segment, IN ITS OWN DIRECTION. */
  start: Waypoint;
  end: Waypoint;
}

/**
 * Targets that are one session's worth of ground apart, nearest-neighbour from
 * the best one.
 *
 * The best target anchors it rather than the geographic centre: the card's job
 * is the record most worth going after, and a route that visits three mediocre
 * targets near each other instead is a different, worse suggestion.
 */
export function clusterTargets(geoms: TargetGeometry[], radiusM = CLUSTER_RADIUS_M): TargetGeometry[] {
  if (geoms.length <= 1) return geoms;
  const [anchor, ...rest] = geoms;
  const near = rest.filter((g) => haversineM(anchor.start, g.start) <= radiusM);

  const ordered: TargetGeometry[] = [anchor];
  const pool = [...near];
  let cursor = anchor.end;
  while (pool.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const d = haversineM(cursor, pool[i].start);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    const [next] = pool.splice(bestIndex, 1);
    ordered.push(next);
    cursor = next.end;
  }
  return ordered;
}

/** Every point would be tens of thousands of numbers. This is a thumbnail. */
function preview(coordinates: Coord[]): { polyline: string; points: number } {
  const step = Math.max(1, Math.ceil(coordinates.length / PREVIEW_POINTS));
  const sampled = coordinates.filter((_, i) => i % step === 0 || i === coordinates.length - 1);
  return {
    polyline: encodePolyline(sampled.map(([lng, lat]) => [lat, lng] as [number, number])),
    points: sampled.length,
  };
}

async function drawRoute(
  sport: PlannerSport,
  targetDistanceM: number,
  geoms: TargetGeometry[],
  degraded: string[],
  signal?: AbortSignal,
): Promise<{ route: CoachRoute | null; note: string | null }> {
  const profile = ORS_PROFILES[sport];
  const ordered = clusterTargets(geoms);
  if (!ordered.length) return { route: null, note: null };

  // Fewer targets on each attempt. Strictly SEQUENTIAL, and a 429 breaks out
  // rather than burning the remaining allowance: the free tier is 40 requests
  // a minute and a burst is the fastest way to lose the whole batch.
  for (let take = Math.min(3, ordered.length); take >= 1; take--) {
    const chosen = ordered.slice(0, take);
    const coordinates: Waypoint[] = chosen.flatMap((g) => [g.start, g.end]);
    try {
      const route = await viaRoute({ profile, coordinates, signal });
      const coords = route.coordinates as Coord[];
      const breakdown = scoreRoute({
        coordinates: coords,
        distanceM: route.distanceM,
        sport,
        targetDistanceM,
        // A route that has to touch three separate pieces of ground is not a
        // loop and was never trying to be. Scoring it as one would dock it for
        // the retracing that getting between the targets requires.
        allowOutAndBack: true,
        surface: route.surface,
        waytype: route.waytype,
      });
      const difficulty = gradeDifficulty({
        distanceM: route.distanceM,
        ascentM: route.ascentM,
        sport,
        stepsShare: breakdown.terrain.stepsShare,
      });
      return {
        route: {
          distanceM: Math.round(route.distanceM),
          ascentM: route.ascentM == null ? null : Math.round(route.ascentM),
          estimatedTimeS: Math.round(route.durationS),
          score: Number(breakdown.total.toFixed(3)),
          notes: breakdown.notes,
          difficulty: difficulty.band,
          through: chosen.map((g) => g.name),
          ...preview(coords),
        },
        note: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      degraded.push(`route through ${take} target${take === 1 ? '' : 's'}: ${message}`);
      // Any 4xx means asking again with one fewer waypoint will get the same
      // answer: 429 is the minute ceiling, 403 is the DAILY quota, 400 is a
      // request ORS will not route. Only 429 used to break out, so once the
      // free tier's daily quota was spent every render burned three doomed
      // round trips instead of one.
      const fourxx =
        err instanceof OrsError && typeof err.status === 'number' && err.status >= 400 && err.status < 500;
      if (fourxx) {
        const status = (err as OrsError).status;
        return {
          route: null,
          note:
            status === 429
              ? 'openrouteservice is rate-limited right now, so the route could not be drawn — the session and the targets stand on their own.'
              : status === 403
                ? 'The openrouteservice daily quota is spent, so the route could not be drawn — the session and the targets stand on their own.'
                : 'openrouteservice refused the request, so the route could not be drawn — the session and the targets stand on their own.',
        };
      }
    }
  }

  return {
    route: null,
    note: 'No road or path route could be found between these targets, so today is the session and the targets without a line on the map.',
  };
}

// ---------------------------------------------------------------------------

function emptyPlan(degraded: string[]): DailyPlan {
  return {
    generatedAt: new Date().toISOString(),
    session: {
      sport: 'run',
      sportLabel: activityLabel('run'),
      intensity: 'easy',
      intensityLabel: INTENSITY_LABELS.easy,
      targetDistanceM: 8000,
      targetMinutes: 53,
      why: ['No training history could be read just now, so this is the default suggestion.'],
      acwrSource: 'unavailable',
      routable: true,
    },
    targets: [],
    route: null,
    routeNote: 'The plan could not be assembled fully, so there is no route today.',
    degraded,
  };
}

/**
 * Today's session, today's beatable records, and — where there is a key and the
 * ground allows — a route through them.
 *
 * Never throws. Pass `dashboard` when the caller has already loaded one:
 * `getTrailsDashboard()` reads ninety days of heart-rate series and is far and
 * away the most expensive thing on this path.
 */
/**
 * How long the whole plan gets before the route is abandoned.
 *
 * openrouteservice is a third party on the far side of the internet, and this
 * runs INSIDE the owner's /health render — an ORS call that hangs would hang
 * the hub with it. The card degrades to "no route" rather than making the page
 * wait, which is the same thing it already does when there is no key.
 */
const ROUTE_DEADLINE_MS = 6000;

/**
 * How long a plan stands before it is worked out again.
 *
 * It is a DAILY plan, and drawing its route costs a third-party HTTP call
 * against a 2,000-a-day free tier. Without this every render of the hub — every
 * refresh, every client-side navigation back to /health, every invalidateAll —
 * re-planned it from scratch.
 */
const PLAN_TTL_MS = 15 * 60 * 1000;
let planCache: { key: string; at: number; value: DailyPlan } | null = null;

/** Drop the memo — for the tests, and for anything that changes the corpus. */
export function invalidateDailyPlan(): void {
  planCache = null;
}

export async function getDailyPlan(
  opts: {
    /** Reuse the caller's copy rather than loading the physio suite twice. */
    dashboard?: TrailsDashboard;
    monotony?: MetricResult<MonotonyResult> | null;
    polarised?: MetricResult<PolarisedResult> | null;
    signal?: AbortSignal;
  } = {},
): Promise<DailyPlan> {
  const degraded: string[] = [];

  // Keyed on the LOCAL day, read from the server's own clock in Europe/London
  // rather than through a UTC date — a plan made at 00:30 BST belongs to the day
  // it was made on.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  if (planCache && planCache.key === today && Date.now() - planCache.at < PLAN_TTL_MS) {
    return planCache.value;
  }

  const deadline = AbortSignal.timeout(ROUTE_DEADLINE_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;

  try {
    const [base, dashboard, monotony, polarised, counts] = await Promise.all([
      soft('session proposal', () => proposeSession(), degraded),
      opts.dashboard
        ? Promise.resolve(opts.dashboard)
        : soft('physio dashboard', () => getTrailsDashboard(), degraded),
      // The owner /health load has already computed both of these. Handing
       // them over saves two round trips against a five-connection pool that
       // the whole site shares.
      opts.monotony !== undefined
        ? Promise.resolve(opts.monotony)
        : soft('monotony', () => getMonotony(), degraded),
      opts.polarised !== undefined
        ? Promise.resolve(opts.polarised)
        : soft('intensity mix', () => getPolarised(), degraded),
      soft('sport history', () => sportCounts(), degraded),
    ]);

    const state: TrainingState = {
      acwr: dashboard?.load.trimpAcwr ?? null,
      monotony,
      polarised,
      yesterdayIntensity: yesterdayIntensity(dashboard),
      last8Weeks: counts?.last8Weeks ?? {},
      last2Weeks: counts?.last2Weeks ?? {},
    };

    const progression = applyProgression(
      {
        // proposeSession only ever returns one of the six routable sports; the
        // coach's own type is the eight, and the progression may move it off
        // the routable set entirely.
        sport: (base?.sport ?? 'run') as CoachSport,
        targetDistanceM: base?.distanceM ?? 8000,
      },
      state,
    );

    const routable = progression.sport in ORS_PROFILES;
    const session: CoachSession = {
      sport: progression.sport,
      sportLabel: activityLabel(progression.sport),
      intensity: progression.intensity,
      intensityLabel: INTENSITY_LABELS[progression.intensity],
      targetDistanceM: progression.targetDistanceM,
      targetMinutes: progression.targetMinutes,
      // The proposal's own reasoning first — the sport and the distance came
      // from there — then the progression's, in the order the rules fired.
      why: [...(base?.rationale ?? []), ...progression.why],
      acwrSource: progression.acwrSource,
      routable,
    };

    // --- targets ---------------------------------------------------------
    const list = await soft(
      'segments',
      () => listSegments({ types: [progression.sport] }),
      degraded,
    );
    const rows = list?.rows ?? [];

    // Two passes. The first ranks on what the list query already carries; only
    // the shortlist pays for its per-effort efficiency series, which the list
    // does not return and which decides the form term.
    const shortlist = rankGettableSegments(rows.map((r) => toCandidate(r)), {
      targetDistanceM: session.targetDistanceM,
      limit: SHORTLIST,
      minScore: 0.1,
    });

    const byId = new Map(rows.map((r) => [r.id, r]));
    // Two queries for the whole shortlist, not `getSegment()` per candidate.
    // That was six calls of two round trips each, and every one of them dragged
    // the segment's ENTIRE coordinate array off the database to read two points
    // out of it.
    const details = await soft(
      'shortlist detail',
      () => shortlistDetail(shortlist.map((t) => t.id)),
      degraded,
    );

    const enriched = shortlist.flatMap((t) => {
      const row = byId.get(t.id);
      if (!row) return [];
      // Efforts come back newest-first; the trend wants the last five oldest-first.
      const recentEf = details?.get(t.id)?.recentEf.slice().reverse();
      return [toCandidate(row, recentEf)];
    });

    const targets = rankGettableSegments(enriched, {
      targetDistanceM: session.targetDistanceM,
      limit: TARGET_LIMIT,
    });

    // --- route -----------------------------------------------------------
    let route: CoachRoute | null = null;
    let routeNote: string | null = null;

    if (!routable) {
      routeNote = `${session.sportLabel} is not something openrouteservice can route, so today is a session brief rather than a route.`;
    } else if (!targets.length) {
      routeNote =
        'No segment on record is close enough to beatable today, so there is nothing to route through yet.';
    } else if (!(await orsConfigured())) {
      routeNote = `No openrouteservice key on this host, so the route could not be drawn — the session and the targets below stand on their own. ${ORS_KEY_HELP}`;
    } else {
      const geoms: TargetGeometry[] = [];
      for (const t of targets) {
        const ends = details?.get(t.id) ?? null;
        const first = ends?.first;
        const last = ends?.last;
        if (!first || !last) continue;
        geoms.push({
          id: t.id,
          name: t.name,
          // Segments are DIRECTIONAL — start then end, in the segment's own
          // order. Reversed, this plans the descent and calls it the climb.
          start: [first[0], first[1]],
          end: [last[0], last[1]],
        });
      }

      if (!geoms.length) {
        routeNote = 'The target segments carry no usable geometry, so no route could be drawn.';
      } else {
        const drawn = await drawRoute(
          progression.sport as PlannerSport,
          session.targetDistanceM,
          geoms,
          degraded,
          signal,
        );
        route = drawn.route;
        routeNote = drawn.note;
      }
    }

    const plan: DailyPlan = {
      generatedAt: new Date().toISOString(),
      session,
      targets,
      route,
      routeNote,
      degraded,
    };
    planCache = { key: today, at: Date.now(), value: plan };
    return plan;
  } catch (err) {
    // The card is on the page every morning; it does not get to take the page
    // down with it.
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[trails/coach] daily plan failed entirely:', message);
    return emptyPlan([...degraded, `daily plan: ${message}`]);
  }
}
