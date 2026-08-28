// Assembly for the excellence engine: one pass over the corpus, one call into
// the pure ranker in ./highlights, memoised so the list page and the hub do not
// each pay for it.
//
// Two things this file exists to get right:
//
//  * `activities.metadata` is NOT selected. It carries the phone's per-minute
//    stepCount, basalEnergy and heartRate arrays — around 11 KB of JSON per row,
//    so `select()` over 1,100 activities is a ~12 MB round trip to read three
//    scalars. Only the three keys the ranker needs are projected, in SQL.
//
//  * Ranks are computed over the WHOLE corpus, not the page. A "3rd fastest"
//    that only considered the last 200 outings would be a different, wrong
//    number every time the filter moved.

import { asc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { activities, activitySegmentEfforts, activitySegments } from '$lib/db/schema';
import { celsiusFrom, effectiveType, localParts } from './activity-meta';
import {
  collectChains,
  computeHighlights,
  type ActivityFacts,
  type EffortFacts,
  type Highlight,
} from './highlights';

export type { Highlight } from './highlights';

export interface HighlightCorpus {
  /** activityId → highlights, best first. Every activity has at least one. */
  byActivity: Map<string, Highlight[]>;
  activityCount: number;
  effortCount: number;
  computedAtMs: number;
}

// Cached because the hub, the list and a detail page all want the same ranking
// inside one navigation. Keyed on the corpus fingerprint so an ingest, an
// exclusion or a type correction invalidates it without anyone remembering to.
const TTL_MS = 5 * 60 * 1000;
let cache: { key: string; value: HighlightCorpus } | null = null;

async function fingerprint(): Promise<string> {
  const [row] = await db
    .select({
      activities: sql<number>`count(*)::int`,
      lastSynced: sql<number>`coalesce(max(${activities.syncedAt}), 0)::int`,
      excluded: sql<number>`count(*) filter (where ${activities.excludedFromSegments})::int`,
      overridden: sql<number>`count(*) filter (where ${activities.typeOverride} is not null)::int`,
      lastStart: sql<number>`coalesce(max(${activities.startDate}), 0)::int`,
      totalDuration: sql<number>`coalesce(sum(${activities.durationS}), 0)::bigint`,
    })
    .from(activities);
  const [efforts] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activitySegmentEfforts);
  // `syncedAt` alone is not enough: the ingest upsert did not bump it, so a
  // re-ingested activity changed its numbers without changing the key. The last
  // start date and the summed duration move whenever the corpus really does.
  return [
    row?.activities,
    row?.lastSynced,
    row?.lastStart,
    row?.totalDuration,
    row?.excluded,
    row?.overridden,
    efforts?.n,
  ].join(':');
}

/** The three metadata keys the ranker needs, projected in SQL. */
const TEMPERATURE = sql<unknown>`${activities.metadata} -> 'temperature'`;
const IS_INDOOR = sql<boolean | null>`(${activities.metadata} ->> 'isIndoor')::boolean`;
const LOCATION = sql<string | null>`${activities.metadata} ->> 'location'`;

export async function loadActivityFacts(): Promise<ActivityFacts[]> {
  const rows = await db
    .select({
      id: activities.id,
      name: activities.name,
      activityType: activities.activityType,
      typeOverride: activities.typeOverride,
      startDate: activities.startDate,
      startDateLocal: activities.startDateLocal,
      distanceM: activities.distanceM,
      durationS: activities.durationS,
      activeDurationS: activities.activeDurationS,
      elevationGainM: activities.elevationGainM,
      avgHeartrate: activities.avgHeartrate,
      maxHeartrate: activities.maxHeartrate,
      avgPaceSPerKm: activities.avgPaceSPerKm,
      activeEnergyKj: activities.activeEnergyKj,
      excludedFromSegments: activities.excludedFromSegments,
      temperature: TEMPERATURE,
      isIndoor: IS_INDOOR,
      location: LOCATION,
    })
    .from(activities)
    .orderBy(asc(activities.startDate));

  return rows.map((r) => {
    const parts = localParts(r.startDateLocal);
    return {
      id: r.id,
      name: r.name,
      activityType: effectiveType(r),
      startDate: r.startDate,
      day: parts?.day ?? null,
      minutesOfDay: parts?.minutesOfDay ?? null,
      distanceM: r.distanceM,
      durationS: r.durationS,
      movingS: r.activeDurationS,
      elevationGainM: r.elevationGainM,
      avgHeartrate: r.avgHeartrate,
      maxHeartrate: r.maxHeartrate,
      avgPaceSPerKm: r.avgPaceSPerKm,
      activeEnergyKj: r.activeEnergyKj,
      tempC: celsiusFrom(r.temperature),
      indoor: resolveIndoor(r.isIndoor, r.location),
      excludedFromSegments: r.excludedFromSegments,
    } satisfies ActivityFacts;
  });
}

/**
 * `isIndoor` is authoritative when present. Older exports only carried
 * `location: 'Outdoor' | 'Indoor'`, and anything else stays null — "we do not
 * know" and "we know it was outside" pick different activities out of a
 * hottest-day ranking.
 */
function resolveIndoor(isIndoor: boolean | null, location: string | null): boolean | null {
  if (typeof isIndoor === 'boolean') return isIndoor;
  const l = location?.trim().toLowerCase();
  if (l === 'indoor') return true;
  if (l === 'outdoor') return false;
  return null;
}

export async function loadEffortFacts(): Promise<EffortFacts[]> {
  const rows = await db
    .select({
      activityId: activitySegmentEfforts.activityId,
      segmentId: activitySegmentEfforts.segmentId,
      segmentName: activitySegments.name,
      segmentActivityType: activitySegments.activityType,
      lapIndex: activitySegmentEfforts.lapIndex,
      durationS: activitySegmentEfforts.durationS,
      paceSPerKm: activitySegmentEfforts.paceSPerKm,
      efficiencyFactor: activitySegmentEfforts.efficiencyFactor,
      beatsPerKm: activitySegmentEfforts.beatsPerKm,
      avgHeartrate: activitySegmentEfforts.avgHeartrate,
      startS: activitySegmentEfforts.startS,
      endS: activitySegmentEfforts.endS,
    })
    .from(activitySegmentEfforts)
    .innerJoin(activitySegments, eq(activitySegments.id, activitySegmentEfforts.segmentId));
  return rows;
}

export async function getHighlightCorpus(): Promise<HighlightCorpus> {
  const key = await fingerprint();
  if (cache && cache.key === key && Date.now() - cache.value.computedAtMs < TTL_MS) {
    return cache.value;
  }

  const [activityFacts, effortFacts] = await Promise.all([loadActivityFacts(), loadEffortFacts()]);
  const value: HighlightCorpus = {
    byActivity: computeHighlights(activityFacts, effortFacts),
    activityCount: activityFacts.length,
    effortCount: effortFacts.length,
    computedAtMs: Date.now(),
  };
  cache = { key, value };
  return value;
}

/** Drop the memos — called after an exclusion or a type correction. */
export function invalidateHighlights(): void {
  cache = null;
  chainCache = null;
}

/** The one highlight a table row shows. */
export function leadHighlight(
  corpus: HighlightCorpus,
  activityId: string,
): Highlight | null {
  return corpus.byActivity.get(activityId)?.[0] ?? null;
}

// ——— chains ————————————————————————————————————————————————————————

export interface SegmentChain {
  key: string;
  firstSegmentId: number;
  firstName: string;
  secondSegmentId: number;
  secondName: string;
  /** How many times the pair has been taken one straight after the other. */
  occurrences: number;
  /** Best combined time, start of the first to the end of the second. */
  bestElapsedS: number;
  /** The activity that set it, and when. */
  bestActivityId: string;
  lastAt: number;
}

/**
 * The ordered segment pairs taken back-to-back most often.
 *
 * Two stretches run one after the other are a third thing: the chain, and the
 * transition between them is the part you actually get better at. Built from the
 * same pure `collectChains` the excellence engine uses, over the same single
 * load of efforts, so a "best back-to-back" badge on an outing and this panel
 * can never disagree.
 */
let chainCache: { key: string; value: SegmentChain[] } | null = null;

export async function getSegmentChains(limit = 12): Promise<SegmentChain[]> {
  // Memoised on the same fingerprint as the highlight corpus. Without this the
  // segments explorer reloaded all 1,136 activities and all 6,317 efforts on
  // every render, to answer a question that changes only when one of them does.
  const key = `${await fingerprint()}:${limit}`;
  if (chainCache && chainCache.key === key) return chainCache.value;

  const [efforts, facts] = await Promise.all([loadEffortFacts(), loadActivityFacts()]);
  const excluded = new Set(facts.filter((a) => a.excludedFromSegments).map((a) => a.id));
  const live = efforts.filter((e) => !excluded.has(e.activityId));

  const startedById = new Map(facts.map((a) => [a.id, a.startDate]));
  const segmentIdByName = new Map(efforts.map((e) => [e.segmentName, e.segmentId]));

  const out: SegmentChain[] = [];
  for (const [key, occurrences] of collectChains(live)) {
    if (occurrences.length < 2) continue;
    const best = occurrences.reduce((a, b) => (b.elapsedS < a.elapsedS ? b : a));
    out.push({
      key,
      firstSegmentId: best.firstSegmentId,
      firstName: best.firstName,
      secondSegmentId: segmentIdByName.get(best.secondName) ?? -1,
      secondName: best.secondName,
      occurrences: occurrences.length,
      bestElapsedS: best.elapsedS,
      bestActivityId: best.activityId,
      lastAt: Math.max(...occurrences.map((o) => startedById.get(o.activityId) ?? 0)),
    });
  }

  // Most-travelled first — the pair you chain every week is the one worth a
  // target time; a pair you did twice is a coincidence with a number on it.
  const value = out
    .sort((a, b) => b.occurrences - a.occurrences || a.bestElapsedS - b.bestElapsedS)
    .slice(0, limit);
  chainCache = { key, value };
  return value;
}
