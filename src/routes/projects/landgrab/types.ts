// The page payload's shape, in one client-safe file.
//
// Everything the browser is given is here, and it is deliberately a small,
// dissolved, rounded view of the ledger: rings rather than cells (Risk 4 — the
// SVG renderer crawls at ~12k features), areas already resolved to metres, and
// no raw GPS fixes beyond a claim's own bounding-box centre.

import type { DateWindowKey, PlayerIdentity } from './identity';

/** One dissolved, Chaikin-smoothed component of somebody's ground.
 *  Coordinates are [lat, lon], which is Leaflet's order. */
export interface LandgrabRegion {
  /** Cells in this component — the area model, not the ring's shoelace area. */
  t: number;
  outer: Array<[number, number]>;
  /** Somebody else's block walk punched through the middle. */
  holes: Array<Array<[number, number]>>;
}

export interface PlayerTerritory {
  subject: string;
  regions: LandgrabRegion[];
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
  territory: PlayerTerritory[];
  standings: Standing[];
  feed: FeedItem[];
  dangle: DangleLine[];
  totals: { events: number; claims: number; cells: number; areaM2: number };
}
