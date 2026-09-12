import { error } from '@sveltejs/kit';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { isOwnerRequest } from '$lib/server/owner';
import { db } from '$lib/db';
import { activities, daydreamTrail, geoClaims } from '$lib/db/schema';
import {
  CAPTURING_ACTIVITY_TYPES,
  WORKOUT_SUBJECT,
  activityTypeNotIn,
} from '$lib/geo/service';
import { GEO_THRESHOLDS } from '$lib/geo/loops';
import { connectedComponents } from '$lib/geo/dissolve';
import { hexRings, packHexes, type Hex } from '$lib/geo/hex';
import { hexesForTiles, resolveHexBoard } from '$lib/geo/hex-board';
import { chooseFocus } from '$lib/geo/focus';
import { findBattlegrounds, nextMoves } from '$lib/geo/battlegrounds';
import { latestLandgrabWeekly } from '$lib/geo/weekly';
import { TILE_ZOOM, parseTileKey, tileAreaM2, tileCentre, type Tile } from '$lib/geo/tiles';
import {
  DEFAULT_WINDOW,
  HOME_BOX,
  homeBoxAreaM2,
  inHomeBox,
  windowOf,
} from './identity';
import { resolveContest } from './contested';
import { parseFilter, resolveBoard } from './query.server';
import { nameFor } from './names.server';
import type {
  Battleground,
  FeedItem,
  Handovers,
  LandgrabData,
  LatLonBounds,
  NextMove,
  PlayerHexes,
  ShareRow,
} from './types';

// The guard, verbatim from /projects/family-life360-history. /projects is a
// public PREFIX in PUBLIC_PATHS, so this load function IS the entire gate:
// there is no card on the index, no entry in STATIC_PROJECT_KEYS, and no data
// endpoint. Five people's movement history, three of them children — the
// posture is the repo's binary one, owner or nothing.

/** Coordinate precision in the payload. 5 dp is ~1.1 m; cells are 44 m. */
const COORD_DP = 5;
const round = (n: number) => Math.round(n * 10 ** COORD_DP) / 10 ** COORD_DP;

const FEED_LIMIT = 40;

/** The highest legal tile index at the shared zoom, on both axes — the same
 *  bound `/projects/landgrab/geo` enforces on `?x`/`?y`. Off `TILE_ZOOM` rather
 *  than a literal 19, so a re-zoom of the grid cannot leave this behind. */
const MAX_TILE_INDEX = 2 ** TILE_ZOOM - 1;

/**
 * The bbox of a board, in the payload's [[south, west], [north, east]] shape.
 *
 * The map's "All" view is the only thing that needs it, and it is the only
 * thing `territory` was still being shipped for once the drawing became a
 * lattice: the browser has the hexes, but asking it to project 19,000 of them
 * before the camera can move is a frame it does not need to spend.
 */
function boardBounds(hexes: readonly Hex[]): LatLonBounds | null {
  if (!hexes.length) return null;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const ring of hexRings(hexes)) {
    for (const [lat, lon] of ring) {
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lon < west) west = lon;
      if (lon > east) east = lon;
    }
  }
  return [
    [round(south), round(west)],
    [round(north), round(east)],
  ];
}

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

  // The filter and the board both live in `query.server.ts`, because the region
  // drill beside this page answers over the SAME filter. Two copies of the
  // window logic is how a map and the panel drilled out of it end up disagreeing
  // about who owns a cell.
  const filter = await parseFilter(event.url);
  const board = await resolveBoard(filter, now);

  const {
    windowKey,
    windowActive,
    includedActivities,
    includeUntyped,
    includedSubjects,
    subjectsFiltered,
    noPlayers,
    filterActive,
    availableActivities,
    hasUntyped,
    allSubjects,
    dimensions,
  } = filter;
  /** The toolbar's includes, back in the excludes the SQL speaks. */
  const excludeActivityTypes = filter.baseFilter.excludeActivityTypes ?? [];
  /** The bound as at now — the one every period query on this page shares. */
  const windowSince = filter.windowFrom(now);
  const activeWindow = windowOf(windowKey);

  if (!board.tileRange) {
    return emptyPayload(now, availableActivities, hasUntyped);
  }

  const { weekAgo, cellAreaM2, ownedNow, ownedThen, visitors, players, cellsAllTime } = board;

  // -------------------------------------------------------------------------
  // Cells -> the board.
  //
  // v1 and v2 hid the grid and dissolved held cells into smoothed blobs, which
  // read as painted ground; the map is a honeycomb now, so the browser gets
  // the lattice instead. What it does NOT get is per-cell geometry: the hexes
  // travel as delta-packed axial integers (~4 bytes each against ~40 for a
  // ring vertex) and the six corners are built on the client.
  // -------------------------------------------------------------------------
  const cellsBySubject = new Map<string, Tile[]>();
  const sinceBySubject = new Map<string, number>();
  for (const o of ownedNow.values()) {
    const tile: Tile = { x: o.tileX, y: o.tileY };
    const list = cellsBySubject.get(o.owner);
    if (list) list.push(tile);
    else cellsBySubject.set(o.owner, [tile]);
    const t = o.ownerSince.getTime();
    const oldest = sinceBySubject.get(o.owner);
    if (oldest === undefined || t < oldest) sinceBySubject.set(o.owner, t);
  }

  const hexBoard = resolveHexBoard(ownedNow.values());
  const hexes: PlayerHexes[] = [...hexBoard.entries()]
    .map(([subject, list]) => ({ subject, packed: packHexes(list) }))
    .sort((a, b) => b.packed.length - a.packed.length);
  const territoryBounds = boardBounds([...hexBoard.values()].flat());

  // -------------------------------------------------------------------------
  // Boards.
  //
  // One pass over the union of the two ownership maps answers three questions
  // at once — who gained, who lost, and WHICH cells moved. One definition of
  // "changed hands" for all three, deliberately: a cell nobody held a week ago
  // and somebody holds now counts, exactly as `findBattlegrounds` and the map
  // focus count it. Three places drawing their own line between a first claim
  // and a takeover is how they end up disagreeing.
  // -------------------------------------------------------------------------
  const gained = new Map<string, number>();
  const lost = new Map<string, number>();
  const changedTiles: Tile[] = [];
  const keys = new Set([...ownedNow.keys(), ...ownedThen.keys()]);
  for (const key of keys) {
    const before = ownedThen.get(key) ?? null;
    const after = ownedNow.get(key)?.owner ?? null;
    if (before === after) continue;
    changedTiles.push(parseTileKey(key));
    if (after) gained.set(after, (gained.get(after) ?? 0) + 1);
    if (before) lost.set(before, (lost.get(before) ?? 0) + 1);
  }

  // The contested board. Ranking total ground ranks how far somebody roams:
  // 91% of the map has been visited by exactly one person, and no scoring rule
  // can take a cell off somebody nobody else has been near. This is the half of
  // the map that is actually a game, and it answers over the same filter and
  // window as everything else on the page.
  const ownerByCell = new Map([...ownedNow].map(([key, o]) => [key, o.owner]));
  const contest = resolveContest({
    visitors,
    ownerByCell,
    subjects: players.map((p) => p.subject),
  });

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
  // Where to look, and what moved.
  // -------------------------------------------------------------------------

  // The ground that changed hands, as hexes rather than as a dissolved
  // silhouette. On a board the moved ground has to sit ON the lattice: an
  // outline that cuts across hex edges reads as a drawing error rather than as
  // an overlay. `cells` stays the count of record — it is the number the
  // boards and the Sunday letter print, in the ledger's own unit.
  const handovers: Handovers = {
    cells: changedTiles.length,
    packed: packHexes(hexesForTiles(changedTiles)),
  };

  // The map opens on where the change was, biased home. `active` is ground
  // TOUCHED IN THE LAST SEVEN DAYS, deliberately independent of the date
  // window: the window decides ownership, the week decides where the eye goes.
  //
  // Filtering `active` by the window instead would be a tautology and was one
  // until 2026-09-12. A window is only set when `filterActive`, which resolves
  // ownership with `capturedFrom` already applied, so every surviving cell has
  // `lastEventAt` inside the window by construction — the test passed for every
  // row and the focus was being handed the whole board at weight 1. Seven days
  // is a second, fixed clock, so "all time" gets a focus too.
  const activeTiles = [...ownedNow.values()]
    .filter((o) => o.lastEventAt >= weekAgo)
    .map((o) => ({ x: o.tileX, y: o.tileY }));
  const focus = chooseFocus({ changed: changedTiles, active: activeTiles, home: HOME_BOX });

  // Share of the household's ground, and of the Darlington box. The second is
  // measured against `homeBoxAreaM2()` rather than against the map's extent, so
  // "n% of Darlington" means the same thing whatever else is on screen.
  const householdCells = ownedNow.size;
  const boxArea = homeBoxAreaM2();
  const share: ShareRow[] = standings.map((s) => {
    const cells = cellsBySubject.get(s.subject) ?? [];
    const inBox = cells.filter((t) => {
      const c = tileCentre(t.x, t.y);
      return inHomeBox(c.lat, c.lon);
    }).length;
    return {
      subject: s.subject,
      cells: s.tiles,
      areaM2: s.areaM2,
      share: householdCells ? s.tiles / householdCells : 0,
      homeShare: (inBox * cellAreaM2) / boxArea,
      gainedM2: s.gainedM2,
      lostM2: s.lostM2,
    };
  });

  // The clumps that are actually a game, named within a budget of three
  // geocoder REQUESTS and a three-second wall clock shared by all twelve —
  // each lookup carries a 10 s HTTP timeout of its own, and a page load must
  // not be able to sit on three of those. Past either limit the card prints
  // its coordinates. `keys` is the module's working set and is stripped: the
  // browser gets a name, a centre and a scoreboard.
  const cores = findBattlegrounds({ visitors, ownerByCell, ownerThenByCell: ownedThen }).slice(0, 12);
  const budget = { uncached: 3, deadline: Date.now() + 3000 };
  const battlegrounds: Battleground[] = [];
  for (const core of cores) {
    battlegrounds.push({
      id: core.id,
      name: await nameFor(core.centre, budget),
      centre: core.centre,
      cells: core.cells,
      holders: core.holders,
      handovers: core.handovers,
      contenders: core.contenders,
    });
  }

  /** Cell -> the name of the battleground it sits in, so a move can say where
   *  it is without a second geocode. Built index-parallel with `cores`. */
  const keyToBattleground = new Map<string, string | null>();
  for (let i = 0; i < cores.length; i++) {
    for (const key of cores[i].keys) keyToBattleground.set(key, battlegrounds[i].name);
  }

  // `loopCells` arrives already clamped to MAX_LOOP_CELLS — a zero gap is
  // reachable, and `3 / 0` is Infinity, which JSON.stringify writes as null
  // into a field typed number. Clamped in the module so every caller agrees.
  const nextMovesOut: NextMove[] = nextMoves({
    owned: ownedNow,
    subjects: players.map((p) => p.subject),
  }).map((m) => ({
    subject: m.subject,
    holder: m.holder,
    cells: m.cells,
    centre: m.centre,
    maxGap: m.maxGap,
    loopCells: m.loopCells,
    near:
      m.keys.map((k) => keyToBattleground.get(k)).find((n): n is string => typeof n === 'string') ??
      null,
  }));

  const letter = await latestLandgrabWeekly();

  // A deep link into the drill: `?geo=x:y`. Validated here, fetched by the client.
  // Seven digits admits 9,999,999, but z19's highest legal index on either axis
  // is 524,287 — so a shape-only check hands the client a cell reference the
  // endpoint answers with a 400, and the drawer opens on an error. The bound
  // makes an out-of-range link simply not a deep link.
  const geoParam = event.url.searchParams.get('geo');
  const geoMatch = geoParam ? /^(\d{1,7}):(\d{1,7})$/.exec(geoParam) : null;
  const geoXY = geoMatch ? { x: Number(geoMatch[1]), y: Number(geoMatch[2]) } : null;
  const geo = geoXY && geoXY.x <= MAX_TILE_INDEX && geoXY.y <= MAX_TILE_INDEX ? geoXY : null;

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
    hexes,
    territoryBounds,
    standings,
    contested: contest,
    feed,
    dangle,
    totals: {
      events: dimensions.reduce((n, d) => n + d.events, 0),
      claims: feed.length,
      cells: ownedNow.size,
      areaM2: ownedNow.size * cellAreaM2,
    },
    focus,
    handovers,
    share,
    battlegrounds,
    nextMoves: nextMovesOut,
    letter,
    geo,
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
      hexes: [],
      territoryBounds: null,
      standings: [],
      contested: { cells: 0, board: [] },
      feed: [],
      dangle: [],
      totals: { events: 0, claims: 0, cells: 0, areaM2: 0 },
      // An empty ledger has no change to focus on and nothing to name. These
      // are the true answers here, not placeholders — the branch is reached
      // only when geo_capture_events is empty.
      focus: {
        bounds: [
          [HOME_BOX.south, HOME_BOX.west],
          [HOME_BOX.north, HOME_BOX.east],
        ],
        reason: 'quiet',
        changedCells: 0,
        label: 'Darlington · nothing has changed hands',
      },
      handovers: { cells: 0, packed: [] },
      share: [],
      battlegrounds: [],
      nextMoves: [],
      letter: null,
      geo: null,
    },
  };
}
