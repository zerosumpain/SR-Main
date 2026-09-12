// The visible board: a fixed pointy-top hex lattice over the whole map.
//
// CLIENT-SAFE — the one file under $lib/geo that is. The blanket rule next
// door (see rings.ts) exists because a claim ring's vertices are real GPS
// fixes for five people, three of them children. Nothing of the sort passes
// through here: every signature in this file carries integers, a viewport, or
// a lattice coordinate, and the only module it imports is `./tiles`, whose
// arithmetic the landgrab page already runs in the browser to turn a map tap
// into a cell (+page.svelte).
//
// WHY A SECOND GRID, when the ledger already has one. The z19 square cell is
// the SCORING atom and does not move: ownership is still the decayed argmax
// over `geo_capture_events`, still keyed on (tile_x, tile_y), and this file
// re-ingests nothing. What changes is the DRAWING. v1 and v2 hid the grid and
// dissolved held cells into smoothed blobs, which read as painted ground; a
// honeycomb drawn over everything, claimed and unclaimed alike, reads as a
// board — which is what the game actually is.
//
// The lattice lives in z19 SLIPPY TILE UNITS, the frame the ledger is already
// keyed in, so cell -> hex is arithmetic with no projection step of its own.
// One tile unit is one cell across (~44.3 m at Darlington); y increases
// SOUTHWARD, as it does everywhere in slippy space.

import { TILE_ZOOM, tileCorner, tileFractional, type LatLon } from './tiles';

/** Axial hex coordinate. `q` runs east, `r` runs south-east. */
export interface Hex {
  q: number;
  r: number;
}

const SQRT3 = Math.sqrt(3);

/**
 * Circumradius, in tile units, chosen so a hex covers EXACTLY one cell of
 * ground: area = (3*sqrt(3)/2) * R^2 = 1.
 *
 * Equal area is not an aesthetic choice. `cellAreaM2` is computed once from the
 * ledger's median latitude and is the unit behind every number on the page —
 * the leaderboard, share of Darlington, the Sunday letter, the two-cell loop
 * floor, the six-cell battleground floor. A chunkier hex would look better as a
 * game board and would make all of them disagree with the page they sit on.
 */
export const HEX_R = Math.sqrt(2 / (3 * SQRT3));

/** Flat-to-flat width, in tile units. ~1.0746 cells, i.e. ~47.6 m at 54.5N. */
export const HEX_WIDTH_TILES = SQRT3 * HEX_R;

/** Vertex-to-vertex height, in tile units. ~1.2408 cells, ~55.0 m. */
export const HEX_HEIGHT_TILES = 2 * HEX_R;

/** Axial steps to the six nearest hexes. */
export const HEX_NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** Corner offsets from a centre, in tile units, at 60-degree steps from -30. */
const CORNERS: ReadonlyArray<readonly [number, number]> = Array.from({ length: 6 }, (_, i) => {
  const a = ((60 * i - 30) * Math.PI) / 180;
  return [HEX_R * Math.cos(a), HEX_R * Math.sin(a)] as const;
});

/** Centre of hex (q, r) in tile units. */
export function hexCentreWorld(q: number, r: number): [number, number] {
  return [HEX_R * SQRT3 * (q + r / 2), HEX_R * 1.5 * r];
}

/**
 * Cube rounding — round a fractional axial coordinate to the hex that actually
 * contains the point.
 *
 * Rounding q and r independently is wrong at every hex boundary: the two axes
 * are not orthogonal, so the nearest integer pair is not always the containing
 * hex. Rounding all three cube coordinates and repairing the one with the
 * largest error is the standard fix, and it is what makes `hexesForTile` a
 * partition rather than an approximation.
 */
function axialRound(qf: number, rf: number): Hex {
  const x = qf;
  const z = rf;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  // `|| 0` collapses the negative zero `-ry - rz` produces at the origin. It
  // is invisible in a key (template literals print "0") and in JSON, and very
  // visible in a deep-equality assertion — so it is normalised at the one place
  // it can be created rather than at every reader.
  return { q: rx || 0, r: rz || 0 };
}

/** The hex containing a point given in tile units. */
export function hexOfWorld(wx: number, wy: number): Hex {
  return axialRound(((SQRT3 / 3) * wx - wy / 3) / HEX_R, ((2 / 3) * wy) / HEX_R);
}

/** The hex containing a latitude/longitude. */
export function hexAt(lat: number, lon: number): Hex {
  const [wx, wy] = tileFractional(lat, lon, TILE_ZOOM);
  return hexOfWorld(wx, wy);
}

/** Centre of hex (q, r) as a latitude/longitude. */
export function hexCentre(q: number, r: number): LatLon {
  const [wx, wy] = hexCentreWorld(q, r);
  return tileCorner(wx, wy, TILE_ZOOM);
}

/**
 * Every hex the square cell (x, y) claims.
 *
 * BOTH directions of the mapping, unioned: the hex holding the cell's centre,
 * plus any hex whose own centre falls inside the cell.
 *
 * Either direction alone leaves holes. A hex covers exactly one cell of area,
 * so on average exactly one cell centre lands in each hex — meaning some hexes
 * get two and some get none, and a solid block of held ground would be drawn
 * with speckle through it. The union is gap-free across any solid block, and
 * feathers by at most one hex at an edge.
 *
 * Six candidates is the whole search: a hex centre inside the cell is at most
 * sqrt(2)/2 from the cell's centre, which is at most R from the home hex's
 * centre, so at most 1.328 tile units away — and the second neighbour ring
 * starts at 3R = 1.861.
 */
export function hexesForTile(x: number, y: number): Hex[] {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const home = hexOfWorld(cx, cy);
  const out: Hex[] = [home];
  for (const [dq, dr] of HEX_NEIGHBOURS) {
    const q = home.q + dq;
    const r = home.r + dr;
    const [hx, hy] = hexCentreWorld(q, r);
    if (Math.abs(hx - cx) <= 0.5 && Math.abs(hy - cy) <= 0.5) out.push({ q, r });
  }
  return out;
}

/** Stable string key for a Map or a Set. Not a database key. */
export const hexKey = (q: number, r: number): string => `${q}:${r}`;

export function parseHexKey(key: string): Hex {
  const [q, r] = key.split(':');
  return { q: Number(q), r: Number(r) };
}

/**
 * Rendered width of a hex, in CSS pixels, at a slippy zoom.
 *
 * A z19 tile unit is 256 * 2^(zoom - 19) pixels across, and a hex is
 * `HEX_WIDTH_TILES` of them. This is what decides whether the unclaimed mesh
 * is drawn at all: below about nine pixels a honeycomb stops being a board and
 * becomes a grey wash over the basemap.
 */
export function hexWidthPx(zoom: number): number {
  return 256 * 2 ** (zoom - TILE_ZOOM) * HEX_WIDTH_TILES;
}

export interface HexViewport {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Every hex overlapping a viewport, or null when that would be more than
 * `max` of them.
 *
 * Null rather than a truncated list: a partial honeycomb is worse than none,
 * because the reader reads the edge of the list as the edge of the board. The
 * caller's answer to null is to draw no mesh at all.
 *
 * A screen rectangle is a PARALLELOGRAM in axial space — q shears with r — so
 * this walks rows and recomputes the q range for each one rather than taking a
 * bounding box in (q, r), which would over-generate by the shear and could
 * refuse a viewport it can actually afford.
 */
export function hexesInBounds(view: HexViewport, max: number): Hex[] | null {
  // North is the SMALLER wy: slippy y increases southward.
  const [wxW, wyN] = tileFractional(view.north, view.west, TILE_ZOOM);
  const [wxE, wyS] = tileFractional(view.south, view.east, TILE_ZOOM);
  if (!Number.isFinite(wxW) || !Number.isFinite(wxE) || !Number.isFinite(wyN) || !Number.isFinite(wyS)) {
    return null;
  }
  const rMin = Math.floor(((2 / 3) * Math.min(wyN, wyS)) / HEX_R) - 1;
  const rMax = Math.ceil(((2 / 3) * Math.max(wyN, wyS)) / HEX_R) + 1;
  const xMin = Math.min(wxW, wxE);
  const xMax = Math.max(wxW, wxE);

  let count = 0;
  for (let r = rMin; r <= rMax; r++) {
    count += Math.ceil(xMax / (HEX_R * SQRT3) - r / 2) - Math.floor(xMin / (HEX_R * SQRT3) - r / 2) + 3;
    if (count > max) return null;
  }

  const out: Hex[] = [];
  for (let r = rMin; r <= rMax; r++) {
    const qMin = Math.floor(xMin / (HEX_R * SQRT3) - r / 2) - 1;
    const qMax = Math.ceil(xMax / (HEX_R * SQRT3) - r / 2) + 1;
    for (let q = qMin; q <= qMax; q++) out.push({ q, r });
  }
  return out;
}

/**
 * Six corners per hex, as [lat, lon] rings — the site's stored coordinate
 * order, which the Mapbox adapter converts at its own boundary.
 *
 * A whole list at once, not one hex at a time, because the inverse Mercator is
 * the expensive part and it is a function of `wy` ALONE. Every hex in a row
 * shares the same four corner latitudes, so ~19k hexes need a few hundred
 * `atan(sinh(...))` calls instead of 114k. Longitude is linear in `wx` and
 * needs no trigonometry at all.
 */
export function hexRings(hexes: readonly Hex[]): Array<Array<[number, number]>> {
  const n = 2 ** TILE_ZOOM;
  const latOf = new Map<number, number>();
  const lat = (wy: number): number => {
    const held = latOf.get(wy);
    if (held !== undefined) return held;
    const v = (Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / n))) * 180) / Math.PI;
    latOf.set(wy, v);
    return v;
  };
  return hexes.map(({ q, r }) => {
    const [cx, cy] = hexCentreWorld(q, r);
    return CORNERS.map(([dx, dy]) => [lat(cy + dy), ((cx + dx) / n) * 360 - 180] as [number, number]);
  });
}

/**
 * Delta-pack a hex list for the wire: `[q0, r0, dq1, dr1, ...]`.
 *
 * Sorted row-major first, so within a run of neighbours dr is 0 and dq is 1 —
 * about four bytes of JSON per hex, against fourteen for the absolute pair.
 * The held board is ~19k hexes; that is the difference between 80 KB and
 * 270 KB on a page that already ships a capture feed and a letter.
 */
export function packHexes(hexes: readonly Hex[]): number[] {
  const sorted = [...hexes].sort((a, b) => a.r - b.r || a.q - b.q);
  const out: number[] = [];
  let pq = 0;
  let pr = 0;
  for (let i = 0; i < sorted.length; i++) {
    const { q, r } = sorted[i];
    if (i === 0) out.push(q, r);
    else out.push(q - pq, r - pr);
    pq = q;
    pr = r;
  }
  return out;
}

/** Inverse of `packHexes`. An odd-length array is a truncated payload: the
 *  trailing half-pair is dropped rather than read as a hex at NaN. */
export function unpackHexes(packed: readonly number[]): Hex[] {
  const out: Hex[] = [];
  let q = 0;
  let r = 0;
  for (let i = 0; i + 1 < packed.length; i += 2) {
    if (i === 0) {
      q = packed[0];
      r = packed[1];
    } else {
      q += packed[i];
      r += packed[i + 1];
    }
    out.push({ q, r });
  }
  return out;
}
