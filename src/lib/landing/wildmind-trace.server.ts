// wildmind-trace.server.ts — Wildmind's seen-terrain grid to a handful of SVG
// paths, once per terrain version.
//
// The grid comes from Wildmind's public snapshot with unseen cells already
// zeroed. Each cell is sorted into one of seven map classes (TERRAIN_CLASS),
// and the cells of each class are outlined by walking their edges (marching
// squares on a staircase: every boundary is horizontal or vertical), chained
// into closed rings and written as `M x y h… v… z` with only the corners kept.
// A class is one even-odd path, so holes need no special handling. On the real
// day-16 save (141 cells across) that is seven paths and some 2,700 corners;
// the day-27 valley (164 across) about 4,200, and a full 192-wide grid at two
// tiles a cell about 5,800 (some 5 KB gzipped in a poll answer). It draws in
// the SSR HTML, prints, and takes each view's palette through CSS.
//
// The frame is at most MAX_ACROSS cells across (Wildmind's own cap, so a real
// grid is always traced cell for cell), and the whole drawing at most
// MAX_CORNERS corners. Past the corner cap the map is simplified, not shrunk:
// specks (a patch of one class smaller than a few cells, or a fleck of high
// ground) are absorbed into the ground round them, a few cells more each pass,
// and the trace runs again at full resolution. Only if that is still too many
// are cells merged two by two (the commonest class wins), which no real valley
// needs. Server only (the suffix keeps it out of every client chunk); the last
// two versions are cached.

import {
  TERRAIN_CLASS,
  TERRAIN_CLASSES,
  toMap,
  type MapFrame,
  type TerrainClass,
  type WildmindMap,
  type WildmindTerrain,
} from './wildmind';

/** The widest a frame is drawn, in cells: Wildmind's own grid cap (GRID_MAX in server/public.ts). */
export const MAX_ACROSS = 192;
/** The most corners a map may have in all (a full 192-wide valley fits); past it the map is simplified and traced again. */
export const MAX_CORNERS = 6000;
/** Height bytes at or above this are high ground for the relief (round((h + 2) × 10): 3.5 world units). */
export const RELIEF_BYTE = 55;
/** Labels sent with a map at most. */
export const MAX_LABELS = 40;
const MAX_FACTOR = 32;
/** Speck sizes tried in turn past the corner cap, in cells (patches smaller than this are absorbed). */
const SPECKS = [2, 4, 8, 16];
const METRES_PER_TILE = 2;

const WATER = new Set<TerrainClass>(['sea', 'fresh']);

export interface Traced {
  map: WildmindMap;
  frame: MapFrame;
  /** Corners in all paths, for the cap and the tests. */
  corners: number;
}

/** Cells to rings: the boundary of every cell where `inside` is true, as an even-odd path. */
export function traceRings(w: number, h: number, inside: (i: number, j: number) => boolean): { d: string; rings: number; corners: number } {
  const VW = w + 1;
  const key = (x: number, y: number) => y * VW + x;
  // At most two edges leave a vertex (two at a saddle). Directions: 0 +x, 1 +y, 2 −x, 3 −y.
  const out = new Int8Array(VW * (h + 1) * 2).fill(-1);
  let edges = 0;
  const add = (x: number, y: number, dir: number) => {
    const k = key(x, y) * 2;
    out[out[k] === -1 ? k : k + 1] = dir;
    edges++;
  };
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && inside(i, j);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if (!at(i, j)) continue;
      // Clockwise in screen space (y down): the inside is always on the right.
      if (!at(i, j - 1)) add(i, j, 0);
      if (!at(i + 1, j)) add(i + 1, j, 1);
      if (!at(i, j + 1)) add(i + 1, j + 1, 2);
      if (!at(i - 1, j)) add(i, j + 1, 3);
    }
  if (!edges) return { d: '', rings: 0, corners: 0 };

  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  /** Takes the edge out of (x, y), preferring a right turn from `from`, then straight, then left. */
  const take = (x: number, y: number, from: number): number => {
    const k = key(x, y) * 2;
    const a = out[k];
    const b = out[k + 1];
    let pick = -1;
    if (b === -1 || from === -1) pick = a !== -1 ? 0 : 1;
    else {
      for (const turn of [1, 0, 3]) {
        const want = (from + turn) % 4;
        if (a === want) {
          pick = 0;
          break;
        }
        if (b === want) {
          pick = 1;
          break;
        }
      }
      if (pick === -1) pick = a !== -1 ? 0 : 1;
    }
    const dir = out[k + pick];
    if (pick === 0) {
      out[k] = out[k + 1];
      out[k + 1] = -1;
    } else out[k + 1] = -1;
    return dir;
  };

  let d = '';
  let rings = 0;
  let corners = 0;
  for (let y = 0; y <= h; y++)
    for (let x = 0; x <= w; x++) {
      while (out[key(x, y) * 2] !== -1) {
        // Walk one ring, keeping each vertex with the direction that leaves it.
        const pts: number[] = [];
        let cx = x;
        let cy = y;
        let from = -1;
        // The first vertex in scan order is a ring's top-left corner, with one
        // edge in and one out, so coming back to it closes the ring.
        do {
          const dir = take(cx, cy, from);
          if (dir < 0) break;
          pts.push(cx, cy, dir);
          cx += DX[dir];
          cy += DY[dir];
          from = dir;
        } while (!(cx === x && cy === y));
        const n = pts.length / 3;
        const cs: Array<[number, number]> = [];
        for (let q = 0; q < n; q++) {
          const prev = pts[((q - 1 + n) % n) * 3 + 2];
          if (pts[q * 3 + 2] !== prev) cs.push([pts[q * 3], pts[q * 3 + 1]]);
        }
        if (cs.length < 4) continue;
        let s = `M${cs[0][0]} ${cs[0][1]}`;
        for (let q = 1; q < cs.length; q++) {
          const dx = cs[q][0] - cs[q - 1][0];
          const dy = cs[q][1] - cs[q - 1][1];
          s += dx ? `h${dx}` : `v${dy}`;
        }
        d += `${s}z`;
        rings++;
        corners += cs.length;
      }
    }
  return { d, rings, corners };
}

/**
 * Absorbs specks: every 4-connected patch of one seen class smaller than `min`
 * cells takes the commonest seen class bordering it, and every patch of high
 * ground smaller than `min` is lowered. Unseen cells are never filled (that
 * would draw ground nobody has seen). Returns new arrays; the inputs are kept.
 */
export function despeckle(W: number, H: number, cls: Int8Array, high: Uint8Array, min: number): { cls: Int8Array; high: Uint8Array } {
  const out = cls.slice();
  const raised = high.slice();
  const seenMark = new Int32Array(W * H).fill(-1);
  const stack: number[] = [];
  const patch: number[] = [];
  const near = new Int32Array(TERRAIN_CLASSES.length);
  /** The 4-connected patch of `k` where `same` holds, into `patch`; `ring` counts its seen neighbours by class. */
  const flood = (k: number, mark: number, same: (q: number) => boolean, ring: ((q: number) => void) | null) => {
    patch.length = 0;
    stack.length = 0;
    stack.push(k);
    seenMark[k] = mark;
    while (stack.length) {
      const q = stack.pop()!;
      patch.push(q);
      const x = q % W;
      const z = (q - x) / W;
      for (const n of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, z > 0 ? q - W : -1, z < H - 1 ? q + W : -1]) {
        if (n < 0) continue;
        if (same(n)) {
          if (seenMark[n] !== mark) {
            seenMark[n] = mark;
            stack.push(n);
          }
        } else ring?.(n);
      }
      if (patch.length >= min) {
        // Big enough already: mark the rest of it without collecting it.
        while (stack.length) {
          const r = stack.pop()!;
          const rx = r % W;
          const rz = (r - rx) / W;
          for (const n of [rx > 0 ? r - 1 : -1, rx < W - 1 ? r + 1 : -1, rz > 0 ? r - W : -1, rz < H - 1 ? r + W : -1])
            if (n >= 0 && same(n) && seenMark[n] !== mark) {
              seenMark[n] = mark;
              stack.push(n);
            }
        }
        return false;
      }
    }
    return true;
  };
  let mark = 0;
  for (let k = 0; k < W * H; k++) {
    const c = cls[k];
    if (c < 0 || seenMark[k] >= 0) continue;
    near.fill(0);
    const small = flood(k, mark++, (q) => cls[q] === c, (q) => {
      if (cls[q] >= 0) near[cls[q]]++;
    });
    if (!small) continue;
    let best = -1;
    for (let n = 0; n < near.length; n++) if (near[n] > 0 && (best < 0 || near[n] > near[best])) best = n;
    if (best >= 0) for (const q of patch) out[q] = best;
  }
  seenMark.fill(-1);
  for (let k = 0; k < W * H; k++) {
    if (!raised[k] || seenMark[k] >= 0) continue;
    if (flood(k, mark++, (q) => high[q] === 1, null)) for (const q of patch) raised[q] = 0;
  }
  return { cls: out, high: raised };
}

/** One trace at merge factor `f`: cells merged f×f, the commonest seen class winning. */
function traceAt(terrain: WildmindTerrain, cls: Int8Array, high: Uint8Array, f: number) {
  const { w: W, h: H } = terrain;
  const w = Math.ceil(W / f);
  const h = Math.ceil(H / f);
  const merged = new Int8Array(w * h).fill(-1);
  const relief = new Uint8Array(w * h);
  const counts = new Int32Array(TERRAIN_CLASSES.length);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      counts.fill(0);
      let land = 0;
      let raised = 0;
      for (let dz = 0; dz < f; dz++)
        for (let dx = 0; dx < f; dx++) {
          const x = i * f + dx;
          const z = j * f + dz;
          if (x >= W || z >= H) continue;
          const c = cls[z * W + x];
          if (c < 0) continue;
          counts[c]++;
          if (!WATER.has(TERRAIN_CLASSES[c])) {
            land++;
            if (high[z * W + x]) raised++;
          }
        }
      let best = -1;
      for (let c = 0; c < counts.length; c++) if (counts[c] > 0 && (best < 0 || counts[c] > counts[best])) best = c;
      merged[j * w + i] = best;
      relief[j * w + i] = land > 0 && raised * 2 >= land && best >= 0 && !WATER.has(TERRAIN_CLASSES[best]) ? 1 : 0;
    }

  const seen = traceRings(w, h, (i, j) => merged[j * w + i] >= 0);
  const layers: WildmindMap['layers'] = [];
  let corners = seen.corners;
  TERRAIN_CLASSES.forEach((name, c) => {
    const r = traceRings(w, h, (i, j) => merged[j * w + i] === c);
    if (r.d) layers.push({ cls: name, d: r.d });
    corners += r.corners;
  });
  const rel = traceRings(w, h, (i, j) => relief[j * w + i] === 1);
  corners += rel.corners;
  return { w, h, seen: seen.d, layers, relief: rel.d || null, corners };
}

/**
 * A snapshot's terrain to its map, or null when nothing has been seen (or the
 * grid does not match its own size). `version` is the snapshot's terrain version.
 */
export function traceGrid(terrain: WildmindTerrain, version: string): Traced | null {
  const { w: W, h: H } = terrain;
  const t = Buffer.from(terrain.t, 'base64');
  const hb = Buffer.from(terrain.height, 'base64');
  if (t.length !== W * H || hb.length !== W * H) return null;

  const cls = new Int8Array(W * H).fill(-1);
  const high = new Uint8Array(W * H);
  let any = false;
  for (let k = 0; k < W * H; k++) {
    if (!t[k]) continue;
    const name = terrain.terrains[t[k] - 1];
    const c = TERRAIN_CLASSES.indexOf(name ? (TERRAIN_CLASS[name] ?? 'open') : 'open');
    cls[k] = c;
    high[k] = hb[k] >= RELIEF_BYTE ? 1 : 0;
    any = true;
  }
  if (!any) return null;

  let f = Math.max(1, Math.ceil(Math.max(W, H) / MAX_ACROSS));
  let r = traceAt(terrain, cls, high, f);
  // Too many corners: simplify at this resolution first, absorbing ever larger specks.
  let simple: { cls: Int8Array; high: Uint8Array } = { cls, high };
  for (const min of SPECKS) {
    if (r.corners <= MAX_CORNERS) break;
    simple = despeckle(W, H, cls, high, min);
    r = traceAt(terrain, simple.cls, simple.high, f);
  }
  while (r.corners > MAX_CORNERS && f < MAX_FACTOR) {
    f *= 2;
    r = traceAt(terrain, simple.cls, simple.high, f);
  }

  const frame: MapFrame = { x0: terrain.origin[0], z0: terrain.origin[1], per: terrain.step * f };
  const labels = terrain.regions
    .map((g) => {
      const [x, y] = toMap(frame, g.x, g.z);
      return { name: g.n, x, y, landmark: g.k === 'l' };
    })
    .filter((l) => l.x >= 0 && l.y >= 0 && l.x <= r.w && l.y <= r.h)
    .sort((a, b) => Number(b.landmark) - Number(a.landmark) || a.name.localeCompare(b.name))
    .slice(0, MAX_LABELS);

  return {
    map: {
      version,
      w: r.w,
      h: r.h,
      metresPerUnit: METRES_PER_TILE * frame.per,
      seen: r.seen,
      layers: r.layers,
      relief: r.relief,
      labels,
    },
    frame,
    corners: r.corners,
  };
}

const cache = new Map<string, Traced | null>();

/** traceGrid, remembered for the last two terrain versions. */
export function traceCached(terrain: WildmindTerrain, version: string): Traced | null {
  if (cache.has(version)) return cache.get(version) ?? null;
  const traced = traceGrid(terrain, version);
  cache.set(version, traced);
  while (cache.size > 2) cache.delete(cache.keys().next().value as string);
  return traced;
}
