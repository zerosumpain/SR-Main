// src/lib/daydream/places.ts
//
// Turning a pile of coordinates into a set of places, and a place into a fact.
//
// The clustering half is mechanical. The half that matters is `confirmPlace`:
// a centroid with four visits is a fact about coordinates and is useless on
// its own — it becomes useful the moment it has a name, and the only reliable
// source of that name is the owner. So the loop is: cluster → notice an
// unnamed frequent place → ask → write the answer into jkai_memories under the
// `places` category that table already has → record the memory id here so the
// two can never drift.
//
// Five of the eight planned detectors are inert until a place has a name on
// it, which is why this ships before any of them.

import { and, asc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamTrail, jkaiMemories } from '$lib/db/schema';
import { clusterPoints, clusterRadiusM, median, metresBetween, segmentVisits } from './cluster';
import {
  CLUSTER_RADIUS_M,
  LOCAL_TZ,
  MAX_USABLE_ACCURACY_M,
  MIN_DWELL_MINS,
  MIN_VISITS_FOR_PLACE,
  TRAIL_RETENTION_DAYS,
  VISIT_MAX_GAP_MINS,
  type ClusterPoint,
} from './types';

export interface RefreshResult {
  /** Fixes considered this pass. */
  fixes: number;
  clusters: number;
  created: number;
  updated: number;
  /** Clusters that did not clear the visit/dwell bar — noise, drive-pasts. */
  rejected: number;
  /** Trail rows whose `place_id` was filled in or corrected. */
  reassigned: number;
}

export const EMPTY_REFRESH: RefreshResult = {
  fixes: 0,
  clusters: 0,
  created: 0,
  updated: 0,
  rejected: 0,
  reassigned: 0,
};

/** Weekday index 0..6 (Mon..Sun) and hour 0..23, in LOCAL time.
 *  A place's rhythm is a local fact — "usually Tuesday afternoon" is
 *  meaningless in UTC, and for half the year the two disagree. */
export function localDayHour(d: Date, tz = LOCAL_TZ): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const day = Math.max(0, order.indexOf(wd));
  // Intl can render midnight as "24" in some locales/engines.
  const hour = Number(hh) % 24;
  return { day, hour: Number.isFinite(hour) ? hour : 0 };
}

function histogram(size: number, values: number[]): number[] {
  const out = new Array(size).fill(0);
  for (const v of values) {
    if (v >= 0 && v < size) out[v]++;
  }
  return out;
}

/**
 * Re-derive the place graph from the trail.
 *
 * Deliberately a full recompute over the retention window rather than an
 * incremental update: the clusterer is order-dependent, so an incremental pass
 * would let today's fixes split a place that a full pass keeps whole, and the
 * two would disagree in ways nobody could reproduce. The window is bounded by
 * retention, so the cost is bounded too.
 *
 * What it will NOT do is overwrite a name. A confirmed place keeps its label,
 * kind, source and memory id no matter how the geometry moves underneath it —
 * the owner's answer is the one thing here that recomputation must never
 * silently revise.
 */
export async function refreshPlaces(opts: { windowDays?: number } = {}): Promise<RefreshResult> {
  const windowDays = opts.windowDays ?? TRAIL_RETENTION_DAYS;
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const fixes = await db
    .select({
      id: daydreamTrail.id,
      ts: daydreamTrail.ts,
      lat: daydreamTrail.lat,
      lon: daydreamTrail.lon,
      accuracyM: daydreamTrail.accuracyM,
      placeId: daydreamTrail.placeId,
    })
    .from(daydreamTrail)
    .where(and(gte(daydreamTrail.ts, since), isNotNull(daydreamTrail.lat)))
    .orderBy(asc(daydreamTrail.ts));

  if (fixes.length === 0) return { ...EMPTY_REFRESH };

  // A wide accuracy circle "arrives" at every shop you drove past, so those
  // fixes are kept in the trail but excluded from deciding where places are.
  const usable = fixes.filter(
    (f) => f.accuracyM == null || f.accuracyM <= MAX_USABLE_ACCURACY_M,
  );

  const points: ClusterPoint[] = usable.map((f, i) => ({
    idx: i,
    lat: f.lat as number,
    lon: f.lon as number,
    ts: f.ts,
  }));

  const clusters = clusterPoints(points, CLUSTER_RADIUS_M);

  const existing = await db.select().from(daydreamPlaces);
  /** Place ids already taken by a cluster this pass, so two clusters cannot
   *  both write their stats onto the same row. */
  const claimed = new Set<string>();

  const result: RefreshResult = { ...EMPTY_REFRESH, fixes: fixes.length, clusters: clusters.length };

  /** trail row id → place id, for the backfill at the end. */
  const assignment = new Map<number, string>();

  for (const cluster of clusters) {
    const members = cluster.members.map((i) => usable[i]);
    const visits = segmentVisits(
      members.map((m) => m.ts),
      VISIT_MAX_GAP_MINS,
    );
    const realVisits = visits.filter((v) => v.dwellMins >= MIN_DWELL_MINS);

    // Match to the NEAREST existing place before deciding this is new —
    // otherwise a place drifts a few metres between passes and forks into a
    // second row, taking its confirmed name with it. Nearest rather than first
    // because two places can legitimately sit within each other's radius, and
    // `claimed` stops two clusters both writing to the same row.
    let matched: (typeof existing)[number] | undefined;
    let matchedDist = Infinity;
    for (const p of existing) {
      if (p.status === 'merged' || claimed.has(p.id)) continue;
      const d = metresBetween(cluster.lat, cluster.lon, p.lat, p.lon);
      if (d <= Math.max(p.radiusM, CLUSTER_RADIUS_M) && d < matchedDist) {
        matchedDist = d;
        matched = p;
      }
    }
    if (matched) claimed.add(matched.id);

    if (realVisits.length < MIN_VISITS_FOR_PLACE) {
      // Not a place yet. An ALREADY confirmed place is not demoted by a quiet
      // fortnight — you named it, it stays named.
      if (matched && matched.source === 'confirmed') {
        for (const m of members) assignment.set(m.id, matched.id);
      } else {
        result.rejected++;
      }
      continue;
    }

    const radiusM = clusterRadiusM(cluster.lat, cluster.lon, members.map((m) => ({
      lat: m.lat as number,
      lon: m.lon as number,
    })));
    const dayHours = realVisits.map((v) => localDayHour(v.startedAt));
    const stats = {
      lat: cluster.lat,
      lon: cluster.lon,
      radiusM,
      visitCount: realVisits.length,
      medianDwellMins: median(realVisits.map((v) => v.dwellMins)),
      dayHistogram: histogram(7, dayHours.map((d) => d.day)),
      hourHistogram: histogram(24, dayHours.map((d) => d.hour)),
      firstSeenAt: realVisits[0].startedAt,
      lastSeenAt: realVisits[realVisits.length - 1].endedAt,
      updatedAt: new Date(),
    };

    let placeId: string;
    if (matched) {
      // Geometry and stats refresh; the owner's answer does not.
      await db.update(daydreamPlaces).set(stats).where(eq(daydreamPlaces.id, matched.id));
      placeId = matched.id;
      result.updated++;
    } else {
      const [created] = await db
        .insert(daydreamPlaces)
        .values({ ...stats, source: 'inferred', kind: 'unknown' })
        .returning({ id: daydreamPlaces.id });
      placeId = created.id;
      result.created++;
    }

    for (const m of members) assignment.set(m.id, placeId);
  }

  // Backfill place_id on the trail so visit queries are one indexed lookup
  // rather than a geometry scan per detector, per tick.
  const changed = new Map<string, number[]>();
  for (const f of usable) {
    const want = assignment.get(f.id) ?? null;
    if (want !== f.placeId && want != null) {
      const list = changed.get(want) ?? [];
      list.push(f.id);
      changed.set(want, list);
    }
  }
  for (const [placeId, ids] of changed) {
    // Chunked: Postgres has a bind-parameter ceiling and a busy quarter can
    // easily produce more ids than it allows in one IN list.
    for (let i = 0; i < ids.length; i += 1000) {
      const slice = ids.slice(i, i + 1000);
      await db
        .update(daydreamTrail)
        .set({ placeId })
        .where(inArray(daydreamTrail.id, slice));
      result.reassigned += slice.length;
    }
  }

  return result;
}

/**
 * Places worth asking about: enough visits to matter, still unnamed, not
 * muted. This is the input to the `unknown_place` thought.
 */
export async function listUnnamedPlaces(limit = 10) {
  return db
    .select()
    .from(daydreamPlaces)
    .where(
      and(
        eq(daydreamPlaces.status, 'active'),
        sql`${daydreamPlaces.label} is null`,
        gte(daydreamPlaces.visitCount, MIN_VISITS_FOR_PLACE),
      ),
    )
    .orderBy(sql`${daydreamPlaces.visitCount} desc`)
    .limit(limit);
}

/** How a place is described back to you — "four visits, about 20 minutes each,
 *  usually Tuesday afternoon". Pure formatting over the stored histograms, so
 *  the phrasing costs no query and no model call. */
export function describePlaceRhythm(place: {
  visitCount: number;
  medianDwellMins: number;
  dayHistogram: number[];
  hourHistogram: number[];
}): string {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const parts = [`${place.visitCount} visit${place.visitCount === 1 ? '' : 's'}`];

  if (place.medianDwellMins > 0) {
    parts.push(`about ${place.medianDwellMins} minutes each`);
  }

  const dayTotal = place.dayHistogram.reduce((a, b) => a + b, 0);
  if (dayTotal > 0) {
    const peak = place.dayHistogram.indexOf(Math.max(...place.dayHistogram));
    const share = place.dayHistogram[peak] / dayTotal;
    // Only call it a pattern when it actually is one.
    if (share >= 0.5 && place.dayHistogram[peak] >= 2) parts.push(`usually ${days[peak]}`);
  }

  const hourTotal = place.hourHistogram.reduce((a, b) => a + b, 0);
  if (hourTotal > 0) {
    const peak = place.hourHistogram.indexOf(Math.max(...place.hourHistogram));
    const band = peak < 12 ? 'morning' : peak < 17 ? 'afternoon' : 'evening';
    if (place.hourHistogram[peak] / hourTotal >= 0.4) parts.push(`in the ${band}`);
  }

  return parts.join(', ');
}

export const PLACE_KINDS = [
  'home',
  'school',
  'work',
  'shop',
  'cafe',
  'gym',
  'other',
  'unknown',
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export function isPlaceKind(v: unknown): v is PlaceKind {
  return typeof v === 'string' && (PLACE_KINDS as readonly string[]).includes(v);
}

/**
 * Record what a place actually is.
 *
 * Writes the answer to jkai_memories so it is available to every part of jkai
 * that already reads memories — not just to daydreaming — and stores the
 * memory id here so the place and the memory cannot drift apart. Re-confirming
 * supersedes the previous memory rather than leaving two contradictory rows,
 * using the `supersededBy` chain that table already has.
 *
 * This is the only write in the whole feature that happens without an explicit
 * tap on a proposal — and it is not an exception, because the owner typed the
 * answer.
 */
export async function confirmPlace(
  placeId: string,
  label: string,
  kind: PlaceKind,
  opts: { conversationId?: string | null } = {},
): Promise<{ memoryId: string }> {
  const [place] = await db
    .select()
    .from(daydreamPlaces)
    .where(eq(daydreamPlaces.id, placeId))
    .limit(1);
  if (!place) throw new Error(`no such place: ${placeId}`);

  const clean = label.trim().slice(0, 200);
  if (!clean) throw new Error('a place needs a name');

  const rhythm = describePlaceRhythm(place);
  const content = `${clean} (${kind}) — a place John visits: ${rhythm}.`;

  const [memory] = await db
    .insert(jkaiMemories)
    .values({
      category: 'places',
      content,
      confidence: 'high',
      sourceConversationId: opts.conversationId ?? null,
    })
    .returning({ id: jkaiMemories.id });

  if (place.memoryId) {
    await db
      .update(jkaiMemories)
      .set({ supersededBy: memory.id, updatedAt: new Date() })
      .where(eq(jkaiMemories.id, place.memoryId));
  }

  await db
    .update(daydreamPlaces)
    .set({
      label: clean,
      kind,
      source: 'confirmed',
      memoryId: memory.id,
      updatedAt: new Date(),
    })
    .where(eq(daydreamPlaces.id, placeId));

  return { memoryId: memory.id };
}

/** "Stop asking about this one." A place-level mute that survives
 *  re-clustering, which dismissing a single thought would not. */
export async function ignorePlace(placeId: string): Promise<void> {
  await db
    .update(daydreamPlaces)
    .set({ status: 'ignored', updatedAt: new Date() })
    .where(eq(daydreamPlaces.id, placeId));
}
