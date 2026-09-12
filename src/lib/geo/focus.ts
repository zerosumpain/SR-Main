// Where the map opens.
//
// The old fit was "every cell anyone owns", which is the county. This finds
// where the ground actually MOVED in the window and fits that — biased to
// Darlington unless somewhere else was clearly the story of the week.
//
// Pure. Cells in, lat/lon bounds out. Weights, ratios and floors are in FOCUS
// so the rule can be argued from numbers rather than re-read from code.

import { tileAt, tileCentre, TILE_ZOOM, type Tile } from './tiles';

export interface HomeBoxLike {
  name: string;
  south: number;
  north: number;
  west: number;
  east: number;
  centre: [number, number];
}

export interface FocusInput {
  /** Cells whose owner differs from a week ago (weight 3). */
  changed: Tile[];
  /** Cells with any event in the window (weight 1). */
  active: Tile[];
  home: HomeBoxLike;
  zoom?: number;
}

export interface FocusResult {
  bounds: [[number, number], [number, number]];
  reason: 'home' | 'away' | 'quiet';
  changedCells: number;
  label: string;
}

export const FOCUS = {
  /** z19 → z14: ~1.4 km bins at 54.5°N. */
  binShift: 5,
  changedWeight: 3,
  activeWeight: 1,
  /** A bin joins a cluster if it carries at least this share of the heaviest bin. */
  clusterFloor: 0.1,
  /** Away wins only at this multiple of home's weight … */
  awayRatio: 2,
  /** … and only if it is at least this share of everything. */
  awayShare: 0.25,
  /** Never fit tighter than this on either axis — one block walk is not a viewport. */
  minSpanM: 1500,
  padRatio: 0.1,
} as const;

const M_PER_DEG_LAT = 111_195;

interface Cluster {
  bins: Set<string>;
  weight: number;
  /** Every membership, not every cell — a cell that both changed and was active is in here twice. */
  cells: Tile[];
  /**
   * DISTINCT cells in this cluster whose owner changed. A key set, not a
   * counter: the same cell arrives once from `changed` and again from
   * `active`, and "40 cells changed hands" must not read 80.
   */
  changed: Set<string>;
}

export function chooseFocus(input: FocusInput): FocusResult {
  const { home } = input;
  const zoom = input.zoom ?? TILE_ZOOM;
  const homeBounds: FocusResult['bounds'] = [[home.south, home.west], [home.north, home.east]];

  // Bin weights.
  const binOf = (t: Tile) => `${t.x >> FOCUS.binShift}:${t.y >> FOCUS.binShift}`;
  const weight = new Map<string, number>();
  const members = new Map<string, Tile[]>();
  const changedSet = new Set<string>();
  const add = (t: Tile, w: number, changed: boolean) => {
    const b = binOf(t);
    weight.set(b, (weight.get(b) ?? 0) + w);
    (members.get(b) ?? members.set(b, []).get(b)!).push(t);
    if (changed) changedSet.add(`${t.x}:${t.y}`);
  };
  for (const t of input.changed) add(t, FOCUS.changedWeight, true);
  for (const t of input.active) add(t, FOCUS.activeWeight, false);

  const total = [...weight.values()].reduce((a, b) => a + b, 0);
  if (total === 0) {
    return { bounds: homeBounds, reason: 'quiet', changedCells: 0, label: `${home.name} · nothing has changed hands` };
  }

  // Clusters: 8-connected bins above the floor.
  const heaviest = Math.max(...weight.values());
  const eligible = new Set([...weight].filter(([, w]) => w >= heaviest * FOCUS.clusterFloor).map(([b]) => b));
  const seen = new Set<string>();
  const clusters: Cluster[] = [];
  for (const start of eligible) {
    if (seen.has(start)) continue;
    const cluster: Cluster = { bins: new Set(), weight: 0, cells: [], changed: new Set() };
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const b = stack.pop()!;
      cluster.bins.add(b);
      cluster.weight += weight.get(b) ?? 0;
      for (const t of members.get(b) ?? []) {
        cluster.cells.push(t);
        const key = `${t.x}:${t.y}`;
        if (changedSet.has(key)) cluster.changed.add(key);
      }
      const [bx, by] = b.split(':').map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const n = `${bx + dx}:${by + dy}`;
        if (eligible.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    clusters.push(cluster);
  }
  clusters.sort((a, b) => b.weight - a.weight);

  const touchesHome = (c: Cluster) =>
    c.cells.some((t) => {
      const ll = tileCentre(t.x, t.y, zoom);
      return ll.lat >= home.south && ll.lat <= home.north && ll.lon >= home.west && ll.lon <= home.east;
    });
  const homeCluster = clusters.find(touchesHome) ?? null;
  const awayCluster = clusters.find((c) => c !== homeCluster) ?? null;

  const homeWeight = homeCluster?.weight ?? 0;
  const away =
    awayCluster && awayCluster.weight >= homeWeight * FOCUS.awayRatio && awayCluster.weight >= total * FOCUS.awayShare
      ? awayCluster
      : null;

  const chosen = away ?? homeCluster;
  if (!chosen) {
    // Everything is away but nothing dominates: the home box, with what changed
    // counted. The count is the WHOLE window's changed cells, not a cluster's —
    // there is no chosen cluster here, and reporting 0 while ground moved is a
    // lie a stat tile would repeat.
    return {
      bounds: homeBounds,
      reason: 'home',
      changedCells: changedSet.size,
      label: `${home.name} · the change was spread thin elsewhere`,
    };
  }

  const bounds = fit(chosen.cells, zoom);
  const where = away ? `away from ${home.name}` : home.name;
  const n = chosen.changed.size;
  return {
    bounds,
    reason: away ? 'away' : 'home',
    changedCells: n,
    label: `${where} · ${n.toLocaleString('en-GB')} cell${n === 1 ? '' : 's'} changed hands`,
  };
}

/** Bbox of the cells' centres, padded, and never narrower than the minimum span. */
function fit(cells: Tile[], zoom: number): FocusResult['bounds'] {
  let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
  for (const t of cells) {
    const ll = tileCentre(t.x, t.y, zoom);
    s = Math.min(s, ll.lat); n = Math.max(n, ll.lat); w = Math.min(w, ll.lon); e = Math.max(e, ll.lon);
  }
  const midLat = (s + n) / 2;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const latSpan = Math.max((n - s) * (1 + 2 * FOCUS.padRatio), FOCUS.minSpanM / M_PER_DEG_LAT);
  const lonSpan = Math.max((e - w) * (1 + 2 * FOCUS.padRatio), FOCUS.minSpanM / mPerDegLon);
  const cLat = midLat, cLon = (w + e) / 2;
  return [[cLat - latSpan / 2, cLon - lonSpan / 2], [cLat + latSpan / 2, cLon + lonSpan / 2]];
}

// tileAt is re-exported for callers that focus from a lat/lon click.
export { tileAt };
