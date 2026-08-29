import { error } from '@sveltejs/kit';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { isOwnerRequest } from '$lib/server/owner';
import { db } from '$lib/db';
import { activities, daydreamTrail, geoCaptureEvents, geoClaims, geoTileState } from '$lib/db/schema';
import {
  CAPTURING_ACTIVITY_TYPES,
  WORKOUT_SUBJECT,
  activityTypeNotIn,
  resolveFilteredOwnership,
  type TerritoryFilter,
} from '$lib/geo/service';
import { GEO_THRESHOLDS } from '$lib/geo/loops';
import { connectedComponents, dissolveTiles } from '$lib/geo/dissolve';
import { tileAreaM2, tileCentre, tileKeyOf, type Tile } from '$lib/geo/tiles';
import { assignIdentities, ACTIVITY_FILTERS, DEFAULT_WINDOW, windowOf } from './identity';
import type { DateWindowKey } from './identity';
import type { LandgrabData, LandgrabRegion, FeedItem } from './types';

// The guard, verbatim from /projects/family-life360-history. /projects is a
// public PREFIX in PUBLIC_PATHS, so this load function IS the entire gate:
// there is no card on the index, no entry in STATIC_PROJECT_KEYS, and no data
// endpoint. Five people's movement history, three of them children — the
// posture is the repo's binary one, owner or nothing.

/** Coordinate precision in the payload. 5 dp is ~1.1 m; cells are 44 m. */
const COORD_DP = 5;
const round = (n: number) => Math.round(n * 10 ** COORD_DP) / 10 ** COORD_DP;

const WEEK_MS = 7 * 86_400_000;
const FEED_LIMIT = 40;

/** The trail legs a distance sum is allowed to believe, matching the gates the
 *  capture path already applies. A drive must not appear in the dangle line
 *  either. */
const { maxInterpolationM, maxInterpolationS, maxAccuracyM, excludedModes } = GEO_THRESHOLDS;

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const load: PageServerLoad = async (event) => {
  if (!(await isOwnerRequest(event))) throw error(404, 'Not found');
  event.setHeaders({ 'cache-control': 'private, no-store' });

  const now = new Date();
  const weekAgo = new Date(now.getTime() - WEEK_MS);

  // -------------------------------------------------------------------------
  // What the ledger actually contains — the filter's own vocabulary. Offering
  // a "hike" chip on a corpus with no hikes is a lie about the data, and
  // offering "untyped" when nothing is untyped hides that the whole Life360
  // half has not landed yet.
  // -------------------------------------------------------------------------
  const dimensions = await db
    .select({
      subject: geoCaptureEvents.subject,
      activityType: geoCaptureEvents.activityType,
      sourceKind: geoCaptureEvents.sourceKind,
      events: sql<number>`count(*)::int`,
    })
    .from(geoCaptureEvents)
    .groupBy(geoCaptureEvents.subject, geoCaptureEvents.activityType, geoCaptureEvents.sourceKind);

  const allSubjects = [...new Set(dimensions.map((d) => d.subject))].sort();
  const typesPresent = new Set(dimensions.map((d) => d.activityType));
  const availableActivities = ACTIVITY_FILTERS.filter((t) => typesPresent.has(t));
  const hasUntyped = typesPresent.has(null);

  // -------------------------------------------------------------------------
  // The filter. The URL is the state, so the guard above is also the filter's
  // gate — no second endpoint to add to an allow-list and forget about.
  //
  // The toolbar speaks in INCLUDES (tick what counts); TerritoryFilter speaks
  // in excludes. Converting here, once, is what keeps the ugly half of the
  // three-valued-logic trap out of the components: `excludeUntyped` is its own
  // flag precisely because `activity_type not in ('ride')` cannot express it.
  // -------------------------------------------------------------------------
  const listParam = (key: string): string[] | null => {
    const raw = event.url.searchParams.get(key);
    if (raw === null) return null;
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  };

  const requestedActivities = listParam('activity');
  const includedActivities = requestedActivities
    ? availableActivities.filter((t) => requestedActivities.includes(t))
    : [...availableActivities];
  const includeUntyped = requestedActivities ? requestedActivities.includes('untyped') : true;

  const requestedSubjects = listParam('who');
  const includedSubjects = requestedSubjects
    ? allSubjects.filter((s) => requestedSubjects.includes(s))
    : [...allSubjects];

  // -------------------------------------------------------------------------
  // The date window — John's "filter to the last 7 days capture only".
  //
  // It is a THIRD dimension of the same TerritoryFilter, not a second
  // mechanism, because the question it asks is the same shape as the activity
  // filter's: not "hide old ground" but "who would own this ground if only the
  // last week counted". A cell John won in June and Katie trampled on Tuesday
  // is John's on the full ledger and Katie's under a seven-day window, and no
  // amount of hiding cells on the map turns the first answer into the second.
  // So the window goes into the filter and ownership is replayed, exactly as a
  // unticked activity chip already is.
  //
  // The window SLIDES with the instant the question is asked. That matters in
  // exactly one place — the gained/lost board resolves ownership as at a week
  // ago, and asking "who owned this a week ago, counting only captures from the
  // last seven days" over an ABSOLUTE lower bound is a window of zero width: it
  // would report every cell as freshly gained by whoever holds it. Relative to
  // its own instant the board keeps meaning something: under a 7-day window it
  // becomes this week's ground against last week's. Under all time the bound is
  // absent at both instants and the board is bit-for-bit what it was before.
  // -------------------------------------------------------------------------
  const activeWindow = windowOf(event.url.searchParams.get('window'));
  const windowKey: DateWindowKey = activeWindow.key;
  const windowMs = activeWindow.ms;
  const windowActive = windowMs !== null;
  /** The window's lower bound as at an arbitrary instant. Undefined is all time. */
  const windowFrom = (asOf: Date): Date | undefined =>
    windowMs === null ? undefined : new Date(asOf.getTime() - windowMs);
  /** The bound as at now — the one every period query on this page shares. */
  const windowSince = windowFrom(now);

  const excludeActivityTypes = availableActivities.filter((t) => !includedActivities.includes(t));
  const subjectsFiltered = includedSubjects.length !== allSubjects.length;
  /**
   * Nobody ticked. This has to be handled HERE rather than left to
   * TerritoryFilter, because `subjects: []` means "no subject restriction"
   * there — `filter.subjects?.length ? inArray(...) : undefined` — so an empty
   * selection silently showed everybody's ground while the claim feed
   * (correctly) showed nothing. The map and the feed disagreeing about the
   * same filter is the exact failure the one-legal-spelling rule exists to
   * prevent, so the empty case short-circuits instead of round-tripping.
   */
  const noPlayers = subjectsFiltered && includedSubjects.length === 0;
  const filterActive =
    excludeActivityTypes.length > 0 ||
    (hasUntyped && !includeUntyped) ||
    subjectsFiltered ||
    windowActive;

  /** The filter without its window — the base every instant shares. */
  const baseFilter: TerritoryFilter = {
    excludeActivityTypes,
    excludeUntyped: hasUntyped ? !includeUntyped : false,
    subjects: subjectsFiltered ? includedSubjects : undefined,
  };
  /** The filter as at an instant. The window's bound moves with the question. */
  const filterAt = (asOf: Date): TerritoryFilter => ({
    ...baseFilter,
    capturedFrom: windowFrom(asOf),
  });

  // -------------------------------------------------------------------------
  // The viewport, in cell space. The ledger's own extent: the map opens fitted
  // to every cell anyone owns, so that IS the viewport on first paint, and
  // resolveFilteredOwnership gets a bounded range rather than the whole table.
  // -------------------------------------------------------------------------
  const [extentRow] = await db
    .select({
      minX: sql<number | null>`min(${geoCaptureEvents.tileX})`,
      maxX: sql<number | null>`max(${geoCaptureEvents.tileX})`,
      minY: sql<number | null>`min(${geoCaptureEvents.tileY})`,
      maxY: sql<number | null>`max(${geoCaptureEvents.tileY})`,
    })
    .from(geoCaptureEvents);

  const tileRange =
    extentRow?.minX === null || extentRow?.minX === undefined
      ? null
      : {
          minX: Number(extentRow.minX),
          maxX: Number(extentRow.maxX),
          minY: Number(extentRow.minY),
          maxY: Number(extentRow.maxY),
        };

  // Every area on this page is cell count x this constant. One latitude for the
  // whole board, taken at the middle of the ledger's extent: at 54.5N the cell
  // side moves by under a metre across a county, and a per-cell constant would
  // make two boards that add up differently.
  const centreLat = tileRange
    ? tileCentre(
        Math.round((tileRange.minX + tileRange.maxX) / 2),
        Math.round((tileRange.minY + tileRange.maxY) / 2),
      ).lat
    : 54.52;
  const cellAreaM2 = tileAreaM2(centreLat);

  if (!tileRange) {
    return emptyPayload(now, availableActivities, hasUntyped);
  }

  // -------------------------------------------------------------------------
  // Ownership now.
  //
  // geo_tile_state is the materialised fast path and is only correct for the
  // UNFILTERED view; the moment a chip is unticked the question changes and
  // resolveFilteredOwnership is the one legal way to ask it. The two agree when
  // no filter is applied, which is what makes this branch safe.
  // -------------------------------------------------------------------------
  const ownedNow = new Map<string, { subject: string; tile: Tile; ownerSince: Date }>();
  if (noPlayers) {
    // Nothing to resolve.
  } else if (filterActive) {
    const resolved = await resolveFilteredOwnership({ now, filter: filterAt(now), tileRange });
    for (const [key, o] of resolved) {
      ownedNow.set(key, {
        subject: o.owner,
        tile: { x: o.tileX, y: o.tileY },
        ownerSince: o.ownerSince,
      });
    }
  } else {
    const rows = await db
      .select({
        tileX: geoTileState.tileX,
        tileY: geoTileState.tileY,
        ownerSubject: geoTileState.ownerSubject,
        ownerSince: geoTileState.ownerSince,
      })
      .from(geoTileState);
    for (const r of rows) {
      ownedNow.set(tileKeyOf(r.tileX, r.tileY), {
        subject: r.ownerSubject,
        tile: { x: r.tileX, y: r.tileY },
        ownerSince: r.ownerSince,
      });
    }
  }

  // Ownership as at a week ago, resolved with `now` SET TO THEN. Never with
  // today's clock: the score decays with age, so "who owned this last Saturday"
  // asked today is a different question from the one last Saturday answered.
  // This is the same technique writeDailySnapshot uses, and it is what lets the
  // weekly board be two honest columns instead of one signed number.
  //
  // Under a date window the window's own lower bound moves back with `weekAgo`
  // — see the note where windowFrom is defined. Without that, "a week ago"
  // under a seven-day window is an empty ledger and every cell reads as gained.
  const ownedThen = new Map<string, string>();
  if (!noPlayers) {
    for (const [key, o] of await resolveFilteredOwnership({
      now: weekAgo,
      filter: filterAt(weekAgo),
      tileRange,
    })) {
      ownedThen.set(key, o.owner);
    }
  }

  // What the window itself costs, in cells: the same filter asked without it.
  // Only under a window, and only so the page can state the price of narrowing
  // instead of quietly showing a smaller map.
  const cellsAllTime =
    windowActive && !noPlayers
      ? (await resolveFilteredOwnership({ now, filter: baseFilter, tileRange })).size
      : ownedNow.size;

  // -------------------------------------------------------------------------
  // Cells -> painted ground. The grid is never shipped: per-cell geometry is
  // ~12k SVG features and the renderer crawls, so each player's cells are
  // dissolved into connected components and Chaikin-smoothed server-side.
  // -------------------------------------------------------------------------
  const cellsBySubject = new Map<string, Tile[]>();
  const sinceBySubject = new Map<string, number>();
  for (const o of ownedNow.values()) {
    const list = cellsBySubject.get(o.subject);
    if (list) list.push(o.tile);
    else cellsBySubject.set(o.subject, [o.tile]);
    const t = o.ownerSince.getTime();
    const oldest = sinceBySubject.get(o.subject);
    if (oldest === undefined || t < oldest) sinceBySubject.set(o.subject, t);
  }

  const players = assignIdentities([...new Set([...allSubjects, ...cellsBySubject.keys()])]);

  const territory = [...cellsBySubject.entries()]
    .map(([subject, tiles]) => {
      const regions: LandgrabRegion[] = dissolveTiles(tiles).map((r) => ({
        t: r.tileCount,
        outer: r.outer.map(([lon, lat]) => [round(lat), round(lon)] as [number, number]),
        holes: r.holes.map((h) => h.map(([lon, lat]) => [round(lat), round(lon)] as [number, number])),
      }));
      return { subject, regions };
    })
    .sort((a, b) => b.regions.length - a.regions.length);

  // -------------------------------------------------------------------------
  // Boards.
  // -------------------------------------------------------------------------
  const gained = new Map<string, number>();
  const lost = new Map<string, number>();
  const keys = new Set([...ownedNow.keys(), ...ownedThen.keys()]);
  for (const key of keys) {
    const before = ownedThen.get(key) ?? null;
    const after = ownedNow.get(key)?.subject ?? null;
    if (before === after) continue;
    if (after) gained.set(after, (gained.get(after) ?? 0) + 1);
    if (before) lost.set(before, (lost.get(before) ?? 0) + 1);
  }

  const standings = players
    .map((p) => {
      const tiles = cellsBySubject.get(p.subject) ?? [];
      const oldest = sinceBySubject.get(p.subject) ?? null;
      return {
        subject: p.subject,
        tiles: tiles.length,
        areaM2: tiles.length * cellAreaM2,
        geos: tiles.length ? connectedComponents(tiles).length : 0,
        gainedTiles: gained.get(p.subject) ?? 0,
        lostTiles: lost.get(p.subject) ?? 0,
        gainedM2: (gained.get(p.subject) ?? 0) * cellAreaM2,
        lostM2: (lost.get(p.subject) ?? 0) * cellAreaM2,
        heldSince: oldest ? new Date(oldest).toISOString() : null,
        heldDays: oldest ? Math.max(0, Math.floor((now.getTime() - oldest) / 86_400_000)) : 0,
      };
    })
    .sort((a, b) => b.areaM2 - a.areaM2);

  // -------------------------------------------------------------------------
  // The capture feed. geo_claims.tiles_taken is `{victim: count}` with
  // 'unclaimed' for virgin ground, resolved at ingest against the ledger rather
  // than against a table that had not been written yet — so a claim that
  // displaced another claim in the same run names the person, not "unclaimed".
  // -------------------------------------------------------------------------
  const claimFilter = [
    excludeActivityTypes.length
      ? activityTypeNotIn(geoClaims.activityType, excludeActivityTypes)
      : undefined,
    hasUntyped && !includeUntyped ? sql`${geoClaims.activityType} is not null` : undefined,
    subjectsFiltered
      ? includedSubjects.length
        ? inArray(geoClaims.subject, includedSubjects)
        : sql`false`
      : undefined,
    // The feed respects the window for the same reason the map does: a claim
    // outside it contributed nothing to the ownership being drawn, so listing
    // it would be the feed narrating a map that is not on screen.
    windowSince ? gte(geoClaims.capturedAt, windowSince) : undefined,
  ].filter((p): p is Exclude<typeof p, undefined> => p !== undefined);

  const claimRows = await db
    .select({
      id: geoClaims.id,
      subject: geoClaims.subject,
      capturedAt: geoClaims.capturedAt,
      activityType: geoClaims.activityType,
      sourceKind: geoClaims.sourceKind,
      tileCount: geoClaims.tileCount,
      capturedAreaM2: geoClaims.capturedAreaM2,
      tilesTaken: geoClaims.tilesTaken,
      closure: geoClaims.closure,
      minLat: geoClaims.minLat,
      maxLat: geoClaims.maxLat,
      minLon: geoClaims.minLon,
      maxLon: geoClaims.maxLon,
    })
    .from(geoClaims)
    .where(claimFilter.length ? and(...claimFilter) : undefined)
    .orderBy(desc(geoClaims.capturedAt))
    .limit(FEED_LIMIT);

  const feed: FeedItem[] = claimRows.map((c) => {
    const taken = (c.tilesTaken ?? {}) as Record<string, number>;
    const victims = Object.entries(taken)
      .map(([subject, tiles]) => ({ subject, tiles: Number(tiles) || 0 }))
      .filter((v) => v.tiles > 0)
      .sort((a, b) => b.tiles - a.tiles)
      .map((v) => ({ ...v, areaM2: v.tiles * cellAreaM2 }));
    const closure = (c.closure ?? {}) as { method?: string; gapM?: number; pathM?: number };
    return {
      id: c.id,
      subject: c.subject,
      at: c.capturedAt.toISOString(),
      activityType: c.activityType,
      sourceKind: c.sourceKind,
      tiles: c.tileCount,
      areaM2: c.capturedAreaM2,
      victims,
      method: typeof closure.method === 'string' ? closure.method : null,
      pathM: typeof closure.pathM === 'number' ? closure.pathM : null,
      centre: [round((c.minLat + c.maxLat) / 2), round((c.minLon + c.maxLon) / 2)],
    };
  });

  // -------------------------------------------------------------------------
  // The dangle line — "walked 12.4 km this week, enclosed 0.31 km2".
  //
  // Distance comes from the two corpora that actually score: Apple workouts
  // (John's alone — `activities` has no person column) and the Life360 trail,
  // summed under the same gates the capture path uses, so a drive cannot pad
  // the line any more than it can claim a cell.
  // -------------------------------------------------------------------------
  //
  // The period is the NARROWER of the window and a week, and the page says
  // which. It never widens past a week because the trail is a rolling 90-day
  // table and summing all of it in a load function is a different feature; it
  // narrows to the window because "walked 12 km this week, enclosed nothing in
  // the last 24 hours" is two periods in one sentence, which is the kind of
  // quiet mismatch this filter exists to stop.
  const effortStart = windowSince && windowSince > weekAgo ? windowSince : weekAgo;
  const effortDays = (now.getTime() - effortStart.getTime()) / 86_400_000;

  const movedM = new Map<string, number>();
  const effortStartS = Math.floor(effortStart.getTime() / 1000);
  // The same expression the ingest uses: an owner type override beats the
  // source's own label, so a ride relabelled as a commute is filtered as one.
  const effectiveActivityType = sql<string>`coalesce(nullif(trim(${activities.typeOverride}), ''), ${activities.activityType})`;
  const countedTypes = CAPTURING_ACTIVITY_TYPES.filter(
    (t) => !excludeActivityTypes.includes(t),
  );
  const workoutRows =
    countedTypes.length && !noPlayers && includedSubjects.includes(WORKOUT_SUBJECT)
      ? await db
          .select({ distanceM: activities.distanceM })
          .from(activities)
          .where(
            and(
              gte(activities.startDate, effortStartS),
              eq(activities.excludedFromSegments, false),
              sql`${effectiveActivityType} in (${sql.join(
                countedTypes.map((t) => sql`${t}`),
                sql`, `,
              )})`,
            ),
          )
      : [];
  for (const w of workoutRows) {
    if (!w.distanceM) continue;
    movedM.set(WORKOUT_SUBJECT, (movedM.get(WORKOUT_SUBJECT) ?? 0) + w.distanceM);
  }

  const trailRows = await db
    .select({
      subject: daydreamTrail.subject,
      ts: daydreamTrail.ts,
      lat: daydreamTrail.lat,
      lon: daydreamTrail.lon,
      accuracyM: daydreamTrail.accuracyM,
      mode: daydreamTrail.mode,
    })
    .from(daydreamTrail)
    .where(
      and(
        gte(daydreamTrail.ts, effortStart),
        lte(daydreamTrail.ts, now),
        subjectsFiltered
          ? includedSubjects.length
            ? inArray(daydreamTrail.subject, includedSubjects)
            : sql`false`
          : undefined,
      ),
    )
    .orderBy(daydreamTrail.subject, daydreamTrail.ts);

  let prev: { subject: string; ts: number; at: [number, number] } | null = null;
  for (const r of trailRows) {
    if (r.lat === null || r.lon === null) continue;
    if (r.accuracyM !== null && r.accuracyM > maxAccuracyM) continue;
    if (excludedModes.includes(r.mode)) {
      prev = null;
      continue;
    }
    const at: [number, number] = [r.lat, r.lon];
    const ts = r.ts.getTime();
    if (prev && prev.subject === r.subject) {
      const gapS = (ts - prev.ts) / 1000;
      const d = haversineM(prev.at, at);
      if (gapS <= maxInterpolationS && d <= maxInterpolationM) {
        movedM.set(r.subject, (movedM.get(r.subject) ?? 0) + d);
      }
    }
    prev = { subject: r.subject, ts, at };
  }

  const enclosedRows = await db
    .select({
      subject: geoClaims.subject,
      areaM2: sql<number>`coalesce(sum(${geoClaims.capturedAreaM2}), 0)::double precision`,
      claims: sql<number>`count(*)::int`,
    })
    .from(geoClaims)
    .where(
      and(
        gte(geoClaims.capturedAt, effortStart),
        ...(claimFilter.length ? [and(...claimFilter)] : []),
      ),
    )
    .groupBy(geoClaims.subject);
  const enclosed = new Map(enclosedRows.map((r) => [r.subject, r]));

  const dangle = players.map((p) => ({
    subject: p.subject,
    movedKm: (movedM.get(p.subject) ?? 0) / 1000,
    enclosedM2: Number(enclosed.get(p.subject)?.areaM2 ?? 0),
    claims: Number(enclosed.get(p.subject)?.claims ?? 0),
  }));

  const payload: LandgrabData = {
    generatedAt: now.toISOString(),
    cellAreaM2,
    cellSideM: Math.sqrt(cellAreaM2),
    available: { activities: [...availableActivities], untyped: hasUntyped, subjects: allSubjects },
    selected: {
      activities: [...includedActivities],
      untyped: includeUntyped,
      subjects: includedSubjects,
      window: windowKey,
    },
    window: {
      key: windowKey,
      since: windowSince?.toISOString() ?? null,
      // Named here rather than in the component so the sentence and the query
      // that produced it are written in one place.
      weekBasis: windowActive
        ? `the same ${activeWindow.label.toLowerCase()} a week earlier`
        : 'the map as it stood a week ago',
      effortDays: Math.round(effortDays * 10) / 10,
      cellsOutsideWindow: Math.max(0, cellsAllTime - ownedNow.size),
    },
    filterActive,
    players,
    territory,
    standings,
    feed,
    dangle,
    totals: {
      events: dimensions.reduce((n, d) => n + d.events, 0),
      claims: feed.length,
      cells: ownedNow.size,
      areaM2: ownedNow.size * cellAreaM2,
    },
  };

  return { landgrab: payload };
};

function emptyPayload(
  now: Date,
  availableActivities: readonly string[],
  hasUntyped: boolean,
): { landgrab: LandgrabData } {
  return {
    landgrab: {
      generatedAt: now.toISOString(),
      cellAreaM2: tileAreaM2(54.52),
      cellSideM: Math.sqrt(tileAreaM2(54.52)),
      available: { activities: [...availableActivities], untyped: hasUntyped, subjects: [] },
      selected: {
        activities: [...availableActivities],
        untyped: true,
        subjects: [],
        window: DEFAULT_WINDOW,
      },
      window: {
        key: DEFAULT_WINDOW,
        since: null,
        weekBasis: 'the map as it stood a week ago',
        effortDays: 7,
        cellsOutsideWindow: 0,
      },
      filterActive: false,
      players: [],
      territory: [],
      standings: [],
      feed: [],
      dangle: [],
      totals: { events: 0, claims: 0, cells: 0, areaM2: 0 },
    },
  };
}
