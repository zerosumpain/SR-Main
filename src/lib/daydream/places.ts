import { writeMemory } from '$lib/jkai/memory/service.server';
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
// Several detectors are inert until a place has a name on it, which is why
// this ships before any of them.
//
// Since 2026-08-27 the trail carries the whole household (owner's D1
// decision), and this recompute is deliberately subject-blind: a place is a
// household fact — home is home for everyone — so visitCount and dwell are
// household aggregates. Per-person rhythms come from the trail itself
// (subject + place_id), not from this table.

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
  MIN_VISITS_TO_ASK,
  TRAIL_RETENTION_DAYS,
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
  /** Places that USED to qualify and no longer do — retired to `transit`. */
  retired: number;
  /** Trail rows whose `place_id` was filled in or corrected. */
  reassigned: number;
}

export const EMPTY_REFRESH: RefreshResult = {
  fixes: 0,
  clusters: 0,
  created: 0,
  updated: 0,
  rejected: 0,
  retired: 0,
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
      subject: daydreamTrail.subject,
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
    // Per subject, and dwell measured as time actually spent standing still —
    // see segmentVisits. A cluster on a road now produces no qualifying visit
    // at all, however many times the household drives through it.
    const visits = segmentVisits(
      members.map((m) => ({
        ts: m.ts,
        lat: m.lat as number,
        lon: m.lon as number,
        subject: m.subject,
      })),
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
      } else if (matched && matched.status === 'active') {
        // It used to qualify and does not any more. Retiring it is the point:
        // the stillness rule reclassified 78 stretches of road that the old
        // span-based dwell had promoted to places, and leaving them `active`
        // would keep them in the naming queue, on the map and in the rule
        // facts with stats that no longer describe anything.
        //
        // `transit` rather than `ignored` — `ignored` is you saying "stop
        // asking about this one", and overloading it would lose the difference
        // between a mute you chose and a judgement the engine made.
        await db
          .update(daydreamPlaces)
          .set({ status: 'transit', updatedAt: new Date() })
          .where(eq(daydreamPlaces.id, matched.id));
        result.retired++;
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
    // Local days, not UTC days: a 00:30 stay under BST belongs to the evening
    // it started in. Same reason localDayHour exists.
    const distinctDays = new Set(
      realVisits.map((v) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: LOCAL_TZ }).format(v.startedAt),
      ),
    ).size;
    const stats = {
      lat: cluster.lat,
      lon: cluster.lon,
      radiusM,
      visitCount: realVisits.length,
      distinctDays,
      medianDwellMins: median(realVisits.map((v) => v.dwellMins)),
      dayHistogram: histogram(7, dayHours.map((d) => d.day)),
      hourHistogram: histogram(24, dayHours.map((d) => d.hour)),
      firstSeenAt: realVisits[0].startedAt,
      // Max end, not the end of the last-started visit: visits from different
      // people interleave, so the two are no longer the same row.
      lastSeenAt: new Date(Math.max(...realVisits.map((v) => v.endedAt.getTime()))),
      updatedAt: new Date(),
    };

    let placeId: string;
    if (matched) {
      // Geometry and stats refresh; the owner's answer does not. A place that
      // was retired to `transit` and now qualifies again comes back — the
      // retirement is a judgement about the evidence, so it has to be
      // revisable when the evidence changes. An `ignored` place stays ignored:
      // that one is the owner's.
      await db
        .update(daydreamPlaces)
        .set(matched.status === 'transit' ? { ...stats, status: 'active' } : stats)
        .where(eq(daydreamPlaces.id, matched.id));
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
 * Which place is home.
 *
 * `kind = 'home'` is not unique and was never going to be: "Grandparents" is
 * genuinely somebody's home, and on 2026-08-27 three active places carried the
 * kind — the house, the grandparents' 1.2 km away, and a road cluster 260 m up
 * the street that had been given the same label as the house.
 *
 * The previous query took `limit(1)` with NO ordering, so which one it returned
 * was whatever Postgres happened to hand back. It happened to be right. It is
 * the input to `distance_home_km` on every trail fix and to the weather
 * fallback, so "happened to be right" is not good enough: a table rewrite or a
 * different plan would have silently moved home 1.2 km and nothing anywhere
 * would have reported it.
 *
 * Most lived-in wins — visits first, then dwell. Whatever else is called home,
 * the one you sleep at has the numbers.
 */
export async function getHomePlace(): Promise<{ lat: number; lon: number } | null> {
  const [home] = await db
    .select({ lat: daydreamPlaces.lat, lon: daydreamPlaces.lon })
    .from(daydreamPlaces)
    .where(and(eq(daydreamPlaces.kind, 'home'), eq(daydreamPlaces.status, 'active')))
    .orderBy(
      sql`${daydreamPlaces.visitCount} desc`,
      sql`${daydreamPlaces.medianDwellMins} desc`,
      sql`${daydreamPlaces.id}`,
    )
    .limit(1);
  return home ?? null;
}

/**
 * Close any open question about a place that now has a name.
 *
 * `confirmPlace` already does this for the place it just named, and that fast
 * path stays. This is the reconciler behind it, and it exists because the fast
 * path is a trigger: it only fires on the one code path, in the one process, at
 * the one moment. Anything that sets a label another way — a backfill, a repair
 * script, a merge, a future bulk import — leaves the question standing, and
 * nothing comes along afterwards to notice.
 *
 * Production showed the symptom before the cause was pinned down: six thoughts
 * still reading "What is this place you keep going to?" about places that had
 * been named hours earlier. Rather than guess which path skipped the trigger,
 * this makes the invariant true continuously — a named place has no open
 * question, whoever named it and however.
 *
 * `actioned` is protected in `persistCandidates`, so a later detect tick cannot
 * reopen what this closes.
 */
export async function reconcileNamedPlaceThoughts(): Promise<number> {
  const { daydreamThoughts } = await import('$lib/db/schema');
  const resolved = await db
    .update(daydreamThoughts)
    .set({ status: 'actioned', updatedAt: new Date() })
    .where(
      and(
        inArray(daydreamThoughts.status, ['new', 'delivered', 'seen', 'suppressed']),
        sql`${daydreamThoughts.placeId} in (
          select ${daydreamPlaces.id} from ${daydreamPlaces}
          where ${daydreamPlaces.label} is not null
        )`,
      ),
    )
    .returning({ id: daydreamThoughts.id });
  return resolved.length;
}

/**
 * The naming queue: every unnamed place, best guess already attached.
 *
 * Deliberately NOT gated on MIN_VISITS_TO_ASK. That threshold governs whether
 * somewhere is worth spending an INTERRUPTION on, which is a different question
 * from whether it belongs in a list the owner chose to open. Applying it here is
 * what made the naming panel render nothing at all: no place had reached three
 * visits, so the one surface that could clear the bottleneck showed an empty
 * state while 78 places sat waiting.
 *
 * Ordered by visit count, then by whether we have something to show — a queue
 * that opens with three recognisable names is one the owner keeps going with.
 */
export async function listNamingQueue(limit = 60) {
  return db
    .select()
    .from(daydreamPlaces)
    .where(and(eq(daydreamPlaces.status, 'active'), sql`${daydreamPlaces.label} is null`))
    .orderBy(
      sql`${daydreamPlaces.distinctDays} desc`,
      sql`${daydreamPlaces.visitCount} desc`,
      sql`(${daydreamPlaces.suggestedLabel} is null)`,
      sql`${daydreamPlaces.lastSeenAt} desc nulls last`,
    )
    .limit(limit);
}

/**
 * Places worth asking about: gone to on enough separate DAYS to be a habit,
 * still unnamed, not muted.
 *
 * Days rather than visits since 2026-08-27 — `visitCount` is person-visits, so
 * one outing with the whole family in the car reads five.
 *
 * (The `unknown_place` detector filters the snapshot itself rather than calling
 * this; the two must agree, which is why the threshold lives in `types.ts`.)
 */
export async function listUnnamedPlaces(limit = 10) {
  return db
    .select()
    .from(daydreamPlaces)
    .where(
      and(
        eq(daydreamPlaces.status, 'active'),
        sql`${daydreamPlaces.label} is null`,
        gte(daydreamPlaces.distinctDays, MIN_VISITS_TO_ASK),
      ),
    )
    .orderBy(sql`${daydreamPlaces.distinctDays} desc`)
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
): Promise<{ memoryId: string; thoughtsResolved: number }> {

  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('jkai-memory-write'))`);
    const [place] = await tx
      .select()
      .from(daydreamPlaces)
      .where(eq(daydreamPlaces.id, placeId))
      .limit(1);
    if (!place) throw new Error(`no such place: ${placeId}`);

    const clean = label.trim().slice(0, 200);
    if (!clean) throw new Error('a place needs a name');

    const rhythm = describePlaceRhythm(place);
    const content = `${clean} (${kind}) — a place John visits: ${rhythm}.`;

    const memory = await writeMemory({ category: 'places', content, daydreamOrigin: 'place', replacesId: place.memoryId,
      sourceConversationId: opts.conversationId ?? null,
      provenance: { origin: 'daydream-place', sourceId: placeId, assertion: 'stated' } }, tx);

    await tx
      .update(daydreamPlaces)
      .set({
        label: clean,
        kind,
        source: 'confirmed',
        memoryId: memory.id,
        updatedAt: new Date(),
      })
      .where(eq(daydreamPlaces.id, placeId));

    // The question has been answered, so the thought asking it is finished
    // business. Without this it sits on the ledger still saying "What is this
    // place you keep going to?" about somewhere that now has a name — the detector
    // stops raising it, which is precisely why nothing would ever come along and
    // tidy the existing row.
    //
    // `actioned` is a PROTECTED status, so a later run cannot resurrect it.
    //
    // Recorded as feedback, but LABELLED as inferred.
    //
    // This block used to record nothing, on the correct grounds that quietly
    // manufacturing an upvote would inflate a kind's score with something the
    // owner never said. The cost of that correctness was severe: he named five
    // places — the exact act the whole feature exists to elicit — and the ledger
    // learned nothing, while `coldStartThreshold` sat pinned at 0.75 waiting for
    // 25 responses it had no way to collect.
    //
    // Keeping the provenance answers both. `feedbackSource: 'action'` weighs 0.4
    // of a stated verdict, so it moves the threshold over time and cannot on its
    // own make a kind look loved, and the page says "inferred from naming the
    // place" rather than "you said useful". The original objection was to
    // pretending; it was never to noticing.
    const { daydreamThoughts } = await import('$lib/db/schema');
    const resolved = await tx
      .update(daydreamThoughts)
      .set({
        status: 'actioned',
        // Only where he has not already ruled explicitly — a stated verdict is
        // never overwritten by an inferred one.
        feedback: sql`coalesce(${daydreamThoughts.feedback}, 'useful')`,
        feedbackSource: sql`coalesce(${daydreamThoughts.feedbackSource}, 'action')`,
        feedbackAt: sql`coalesce(${daydreamThoughts.feedbackAt}, now())`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(daydreamThoughts.placeId, placeId),
          inArray(daydreamThoughts.status, ['new', 'delivered', 'seen', 'suppressed']),
        ),
      )
      .returning({ id: daydreamThoughts.id });

    return { memoryId: memory.id, thoughtsResolved: resolved.length };
  });
}

/** "Stop asking about this one." A place-level mute that survives
 *  re-clustering, which dismissing a single thought would not. */
export async function ignorePlace(placeId: string): Promise<void> {
  await db
    .update(daydreamPlaces)
    .set({ status: 'ignored', updatedAt: new Date() })
    .where(eq(daydreamPlaces.id, placeId));
}

// ── Visit history ────────────────────────────────────────────────────────────

export interface PlaceVisit {
  startedAt: string;
  dwellMins: number;
  /** Whose visit. Five people write the trail, and "Jemima, Tuesday 14:20" is
   *  a great deal easier to place than an anonymous Tuesday 14:20. */
  subject: string;
  /** Local, because a visit's day and time are local facts. "Tuesday 14:30" in
   *  UTC is a different Tuesday for half the year. */
  dateLabel: string;
  dayName: string;
  timeLabel: string;
}

/**
 * When, exactly, was the owner here?
 *
 * The rhythm summary ("4 visits, usually Tuesday") is what a rule reasons with;
 * this is what a PERSON needs to recognise a place. "Tue 12 Aug, 14:20, 40
 * minutes" is a memory; "usually Tuesday afternoon" is a statistic, and nobody
 * has ever recognised a dentist from a statistic.
 *
 * Derived on demand rather than stored: it is only ever wanted for the one
 * place whose naming form is open, and computing it for all 84 on every page
 * load would be a lot of segmentation for something nobody is looking at.
 */
export async function getPlaceVisits(placeId: string, limit = 12): Promise<PlaceVisit[]> {
  const rows = await db
    .select({
      ts: daydreamTrail.ts,
      lat: daydreamTrail.lat,
      lon: daydreamTrail.lon,
      subject: daydreamTrail.subject,
    })
    .from(daydreamTrail)
    .where(and(eq(daydreamTrail.placeId, placeId), isNotNull(daydreamTrail.lat)))
    .orderBy(asc(daydreamTrail.ts));

  if (rows.length === 0) return [];

  // The SAME segmenter the place builder uses. If this list showed visits that
  // did not count, the naming card would be arguing with the reason the place
  // is on the list at all.
  const visits = segmentVisits(
    rows.map((r) => ({
      ts: r.ts,
      lat: r.lat as number,
      lon: r.lon as number,
      subject: r.subject,
    })),
  ).filter((v) => v.dwellMins >= MIN_DWELL_MINS);

  const dateFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: LOCAL_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: LOCAL_TZ, weekday: 'long' });
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: LOCAL_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  // Newest first: the most recent visit is the one most likely to be recognised.
  return visits
    .slice(-limit)
    .reverse()
    .map((v) => ({
      startedAt: v.startedAt.toISOString(),
      dwellMins: v.dwellMins,
      subject: v.subject,
      dateLabel: dateFmt.format(v.startedAt),
      dayName: dayFmt.format(v.startedAt),
      timeLabel: timeFmt.format(v.startedAt),
    }));
}
