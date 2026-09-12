// The page payload's shape, in one client-safe file.
//
// Everything the browser is given is here, and it is deliberately a small,
// rounded view of the ledger: the board as packed lattice integers, areas
// already resolved to metres, and no raw GPS fixes beyond a claim's own
// bounding-box centre. Nothing here carries a track, a ring vertex or a fix.

import type { BattleRow, FlipLine, TimelinePoint } from '$lib/geo/history';
import type { DateWindowKey, PlayerIdentity } from './identity';

// The drill's three row shapes have ONE definition, in the pure module that
// computes them. Re-exported rather than restated so a change to the maths
// cannot drift from the payload the page is typed against. `import type` is
// erased at compile, so this file stays client-safe.
export type { TimelinePoint, FlipLine, BattleRow } from '$lib/geo/history';

/**
 * One player's held hexes, delta-packed.
 *
 * `[q0, r0, dq1, dr1, ...]` in row-major order — see `$lib/geo/hex`
 * `packHexes`. The browser unpacks it and builds the six corners itself, which
 * is why the wire carries integers rather than rings: a held board is ~19k
 * hexes, and absolute pairs would cost three times as much.
 *
 * v2 shipped dissolved, Chaikin-smoothed rings here instead. The grid was
 * hidden on purpose then; it is the board now.
 */
export interface PlayerHexes {
  subject: string;
  packed: number[];
}

export interface Standing {
  subject: string;
  tiles: number;
  areaM2: number;
  geos: number;
  gainedTiles: number;
  lostTiles: number;
  gainedM2: number;
  lostM2: number;
  heldSince: string | null;
  heldDays: number;
}

/**
 * One row of the contested board.
 *
 * `visited` is the contested cells this person has ever stood on, `holds` the
 * ones they hold now. The rate between them is the only head-to-head number on
 * the page: total ground is 91% ground nobody else has been to, so it ranks
 * reach rather than any contest.
 */
export interface ContestedStanding {
  subject: string;
  holds: number;
  visited: number;
  /** holds / visited, 0 when they have contested nothing. */
  winRate: number;
}

export interface FeedVictim {
  subject: string;
  tiles: number;
  areaM2: number;
}

export interface FeedItem {
  id: number;
  subject: string;
  at: string;
  activityType: string | null;
  sourceKind: string;
  tiles: number;
  areaM2: number;
  victims: FeedVictim[];
  method: string | null;
  pathM: number | null;
  centre: [number, number];
}

export interface DangleLine {
  subject: string;
  movedKm: number;
  enclosedM2: number;
  claims: number;
}

/**
 * What the active date window means for the surfaces that answer over a PERIOD
 * rather than a moment.
 *
 * `since` is the window's lower bound as at `generatedAt`; `weekBasis` names
 * what the gained/lost board is comparing against, because under a window that
 * is no longer "the map, a week ago" but "the same-length window, a week ago";
 * and `effortDays` is the period the effort lines actually sum, which is the
 * NARROWER of the window and a week and so is not always seven days.
 */
export interface WindowState {
  key: DateWindowKey;
  since: string | null;
  weekBasis: string;
  effortDays: number;
  /** Cells the window itself removed — the honest cost of narrowing. */
  cellsOutsideWindow: number;
}

export interface LandgrabData {
  generatedAt: string;
  cellAreaM2: number;
  cellSideM: number;
  available: { activities: string[]; untyped: boolean; subjects: string[] };
  selected: { activities: string[]; untyped: boolean; subjects: string[]; window: DateWindowKey };
  window: WindowState;
  filterActive: boolean;
  players: PlayerIdentity[];
  /** The board: who holds which hex. One entry per player with ground. */
  hexes: PlayerHexes[];
  /** Bbox of every held hex — the map's "All" view, and nothing else. */
  territoryBounds: LatLonBounds | null;
  standings: Standing[];
  /** Cells more than one person has visited, and who is winning them. */
  contested: { cells: number; board: ContestedStanding[] };
  feed: FeedItem[];
  dangle: DangleLine[];
  totals: { events: number; claims: number; cells: number; areaM2: number };
  focus: MapFocus;
  handovers: Handovers;
  share: ShareRow[];
  battlegrounds: Battleground[];
  nextMoves: NextMove[];
  letter: WeeklyLetter | null;
  /** A validated `?geo=x:y` deep link, opened by the client on mount. */
  geo: { x: number; y: number } | null;
}

/** [[southLat, westLon], [northLat, eastLon]] */
export type LatLonBounds = [[number, number], [number, number]];

export interface MapFocus {
  bounds: LatLonBounds;
  /** 'home' — Darlington; 'away' — a heavier cluster elsewhere; 'quiet' — no change in the window. */
  reason: 'home' | 'away' | 'quiet';
  /** Cells that changed hands in the window, inside the focus bounds. */
  changedCells: number;
  /** The sentence the map head prints, e.g. "Darlington · 312 cells changed hands". */
  label: string;
}

/**
 * Ground whose owner differs from a week ago.
 *
 * `cells` is the count of record — the same number the boards and the Sunday
 * letter print, because it is counted in the ledger's own unit. `packed` is
 * the same ground as hexes, for drawing.
 */
export interface Handovers {
  cells: number;
  packed: number[];
}

export interface ShareRow {
  subject: string;
  cells: number;
  areaM2: number;
  /** cells / every cell the household holds, 0..1. */
  share: number;
  /** cells inside HOME_BOX × cellAreaM2 / homeBoxAreaM2(), 0..1. */
  homeShare: number;
  gainedM2: number;
  lostM2: number;
}

export interface Battleground {
  /** The lexicographically smallest tile key ("x:y") in the component — stable across loads. */
  id: string;
  name: string | null;
  /** [lat, lon] */
  centre: [number, number];
  cells: number;
  /** Descending by cells. */
  holders: Array<{ subject: string; cells: number }>;
  /** Cells in the component whose owner differs from a week ago. */
  handovers: number;
  /** Everyone with at least one event in the component. */
  contenders: string[];
}

export interface NextMove {
  subject: string;
  /** Majority holder of the cheap cluster. */
  holder: string;
  cells: number;
  /** [lat, lon] */
  centre: [number, number];
  /** ownerScore − challenger's score, the largest in the cluster. */
  maxGap: number;
  /** floor(LOOP_WEIGHT / maxGap): a single loop spread over up to this many cells takes every one. */
  loopCells: number;
  /** The battleground the centre falls in, if any. */
  near: string | null;
}

export interface RegionHistory {
  anchor: string;
  /** The player whose dissolved region was tapped. */
  subject: string;
  cells: number;
  areaM2: number;
  centre: [number, number];
  /** Earliest ownerSince over the region's cells. */
  since: string | null;
  name: string | null;
  timeline: TimelinePoint[];
  flips: FlipLine[];
  battle: BattleRow[];
  handovers: number;
}

export interface WeeklyLetter {
  /** Local day, YYYY-MM-DD. */
  weekEnding: string;
  summary: string;
  narrative: string | null;
  verified: boolean | null;
}
