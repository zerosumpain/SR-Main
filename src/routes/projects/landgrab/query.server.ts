// The board, once — read by the page and by the drill endpoint beside it.
//
// SERVER ONLY (`.server.ts`): it reaches for `$lib/db` and `$lib/geo/service`.
// The two halves are the two questions every surface of this feature asks
// first: what did the reader ask for (`parseFilter`, off the URL), and who owns
// what under it (`resolveBoard`, off the ledger). They were inlined in the page
// load until the region drill needed the same answers; a second copy of the
// window logic is exactly how the map and the feed end up disagreeing about the
// same filter, which is the failure the one-legal-spelling rule exists to stop.
//
// Nothing here runs at import time — `db` is only touched inside the two
// functions — so the guard test can import the page with `$lib/db` mocked.

import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { geoCaptureEvents, geoTileState } from '$lib/db/schema';
import {
  readVisitorSets,
  resolveFilteredOwnership,
  type TerritoryFilter,
} from '$lib/geo/service';
import type { TileOwnership } from '$lib/geo/ownership';
import { tileAreaM2, tileCentre, tileKeyOf } from '$lib/geo/tiles';
import { assignIdentities, ACTIVITY_FILTERS, windowOf } from './identity';
import type { DateWindowKey, PlayerIdentity } from './identity';

const WEEK_MS = 7 * 86_400_000;

export interface ParsedFilter {
  windowKey: DateWindowKey;
  windowMs: number | null;
  windowActive: boolean;
  includedActivities: string[];
  includeUntyped: boolean;
  includedSubjects: string[];
  subjectsFiltered: boolean;
  noPlayers: boolean;
  filterActive: boolean;
  /** The filter without its window — the base every instant shares. */
  baseFilter: TerritoryFilter;
  /** The filter as at an instant. The window's bound moves with the question. */
  filterAt: (asOf: Date) => TerritoryFilter;
  /** The window's lower bound as at an arbitrary instant. Undefined is all time. */
  windowFrom: (asOf: Date) => Date | undefined;
  availableActivities: string[];
  hasUntyped: boolean;
  allSubjects: string[];
  dimensions: Array<{
    subject: string;
    activityType: string | null;
    sourceKind: string;
    events: number;
  }>;
}

export async function parseFilter(url: URL): Promise<ParsedFilter> {
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
  // The filter. The URL is the state, so the page's owner guard is also the
  // filter's gate — no second endpoint to add to an allow-list and forget
  // about.
  //
  // The toolbar speaks in INCLUDES (tick what counts); TerritoryFilter speaks
  // in excludes. Converting here, once, is what keeps the ugly half of the
  // three-valued-logic trap out of the components: `excludeUntyped` is its own
  // flag precisely because `activity_type not in ('ride')` cannot express it.
  // -------------------------------------------------------------------------
  const listParam = (key: string): string[] | null => {
    const raw = url.searchParams.get(key);
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
  const activeWindow = windowOf(url.searchParams.get('window'));
  const windowKey: DateWindowKey = activeWindow.key;
  const windowMs = activeWindow.ms;
  const windowActive = windowMs !== null;
  /** The window's lower bound as at an arbitrary instant. Undefined is all time. */
  const windowFrom = (asOf: Date): Date | undefined =>
    windowMs === null ? undefined : new Date(asOf.getTime() - windowMs);

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

  return {
    windowKey,
    windowMs,
    windowActive,
    includedActivities: [...includedActivities],
    includeUntyped,
    includedSubjects,
    subjectsFiltered,
    noPlayers,
    filterActive,
    baseFilter,
    filterAt,
    windowFrom,
    availableActivities: [...availableActivities],
    hasUntyped,
    allSubjects,
    dimensions,
  };
}

export interface Board {
  now: Date;
  weekAgo: Date;
  tileRange: { minX: number; maxX: number; minY: number; maxY: number } | null;
  cellAreaM2: number;
  ownedNow: Map<string, TileOwnership>;
  /** Owner only: the week-ago board is a diff, never a scoreboard. */
  ownedThen: Map<string, string>;
  visitors: Map<string, Set<string>>;
  players: PlayerIdentity[];
  /** What the same filter holds WITHOUT its window — the price of narrowing. */
  cellsAllTime: number;
}

export async function resolveBoard(filter: ParsedFilter, now: Date = new Date()): Promise<Board> {
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const { noPlayers, filterActive, baseFilter, filterAt, windowActive } = filter;

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
    return {
      now,
      weekAgo,
      tileRange: null,
      cellAreaM2,
      ownedNow: new Map(),
      ownedThen: new Map(),
      visitors: new Map(),
      players: assignIdentities(filter.allSubjects),
      cellsAllTime: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Ownership now.
  //
  // geo_tile_state is the materialised fast path and is only correct for the
  // UNFILTERED view; the moment a chip is unticked the question changes and
  // resolveFilteredOwnership is the one legal way to ask it. The two agree when
  // no filter is applied, which is what makes this branch safe.
  // -------------------------------------------------------------------------
  let ownedNow = new Map<string, TileOwnership>();
  if (noPlayers) {
    // Nothing to resolve.
  } else if (filterActive) {
    ownedNow = await resolveFilteredOwnership({ now, filter: filterAt(now), tileRange });
  } else {
    // The same eight fields resolveFilteredOwnership returns. The score, the
    // runner-up and `lastEventAt` are not decoration: the cheapest-neighbour
    // board is computed from the gap between the two scores, and the focus box
    // is fitted to the cells touched in the last seven days — a fixed clock,
    // independent of the date window, so that "all time" has a focus too.
    const rows = await db
      .select({
        tileX: geoTileState.tileX,
        tileY: geoTileState.tileY,
        ownerSubject: geoTileState.ownerSubject,
        ownerScore: geoTileState.ownerScore,
        runnerUp: geoTileState.runnerUp,
        runnerUpScore: geoTileState.runnerUpScore,
        lastEventAt: geoTileState.lastEventAt,
        ownerSince: geoTileState.ownerSince,
      })
      .from(geoTileState);
    for (const r of rows) {
      ownedNow.set(tileKeyOf(r.tileX, r.tileY), {
        tileX: r.tileX,
        tileY: r.tileY,
        owner: r.ownerSubject,
        score: r.ownerScore,
        runnerUp: r.runnerUp,
        runnerUpScore: r.runnerUpScore,
        lastEventAt: r.lastEventAt,
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

  // The contested half of the map. Ranking total ground ranks how far somebody
  // roams: 91% of the map has been visited by exactly one person, and no
  // scoring rule can take a cell off somebody nobody else has been near. This
  // is the half that is actually a game, and it answers over the same filter
  // and window as everything else.
  const visitors = noPlayers
    ? new Map<string, Set<string>>()
    : await readVisitorSets({ now, filter: filterAt(now), tileRange });

  const players = assignIdentities([
    ...new Set([...filter.allSubjects, ...[...ownedNow.values()].map((o) => o.owner)]),
  ]);

  return { now, weekAgo, tileRange, cellAreaM2, ownedNow, ownedThen, visitors, players, cellsAllTime };
}
