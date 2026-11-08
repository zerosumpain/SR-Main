// Homestead's island — the pure geometry and the board generator.
//
// One coordinate scheme, shared with the app (spec: 2026-10-22-family-games-
// homestead.md, "Coordinates"). Hexes are axial `(q, r)`, pointy-top, `r`
// growing downward. Every corner of the grid is the top (`N`) corner of exactly
// one hex or the bottom (`S`) corner of exactly one hex; every side is the
// `NE`, `NW` or `W` side of exactly one hex. So a corner or side has one id,
// whichever hex you reach it from — but that id may name a SEA hex (a coastal
// corner owned by a hex off the island). Validate against the board's own
// vertex and edge sets, never by "its hex exists".
//
// Nothing here keeps state or reads a clock: the room (`homestead.ts`) holds
// the generator state and passes a `next()` in.

export const RESOURCES = ['timber', 'clay', 'wool', 'grain', 'stone'] as const;
export type Resource = (typeof RESOURCES)[number];

export function isResource(v: unknown): v is Resource {
  return typeof v === 'string' && (RESOURCES as readonly string[]).includes(v);
}

export type HexKind = 'woods' | 'claypit' | 'meadow' | 'fields' | 'quarry' | 'dunes';

/** What each tile produces; dunes produce nothing. */
export const PRODUCES: Record<Exclude<HexKind, 'dunes'>, Resource> = {
  woods: 'timber',
  claypit: 'clay',
  meadow: 'wool',
  fields: 'grain',
  quarry: 'stone',
};
const KIND_OF: Record<Resource, HexKind> = { timber: 'woods', clay: 'claypit', wool: 'meadow', grain: 'fields', stone: 'quarry' };

export type IslandSize = 'standard' | 'large';
export type HarbourKind = Resource | 'any';

export interface Hex {
  id: string;
  q: number;
  r: number;
  kind: HexKind;
  /** Null on dunes. */
  resource: Resource | null;
  /** Null on dunes. */
  token: number | null;
  pips: number;
}

export interface Harbour {
  /** A coastal edge id; both its corners trade at `rate`. */
  edge: string;
  kind: HarbourKind;
  rate: 2 | 3;
}

export interface Board {
  size: IslandSize;
  hexes: Hex[];
  harbours: Harbour[];
}

/** Dots under a number: its chance in 36. */
export function pips(token: number | null): number {
  if (token === null || token === 7 || token < 2 || token > 12) return 0;
  return 6 - Math.abs(7 - token);
}

// ---- Ids -----------------------------------------------------------------

export const hexId = (q: number, r: number) => `${q + 0},${r + 0}`;
export const vertexId = (q: number, r: number, d: 'N' | 'S') => `${q + 0},${r + 0},${d}`;
export const edgeId = (q: number, r: number, d: 'NE' | 'NW' | 'W') => `${q + 0},${r + 0},${d}`;

const HEX_RE = /^(-?\d+),(-?\d+)$/;
const VERTEX_RE = /^(-?\d+),(-?\d+),(N|S)$/;
const EDGE_RE = /^(-?\d+),(-?\d+),(NE|NW|W)$/;

export function parseHex(id: unknown): { q: number; r: number } | null {
  if (typeof id !== 'string') return null;
  const m = HEX_RE.exec(id);
  return m ? { q: Number(m[1]), r: Number(m[2]) } : null;
}
export function parseVertex(id: unknown): { q: number; r: number; d: 'N' | 'S' } | null {
  if (typeof id !== 'string') return null;
  const m = VERTEX_RE.exec(id);
  return m ? { q: Number(m[1]), r: Number(m[2]), d: m[3] as 'N' | 'S' } : null;
}
export function parseEdge(id: unknown): { q: number; r: number; d: 'NE' | 'NW' | 'W' } | null {
  if (typeof id !== 'string') return null;
  const m = EDGE_RE.exec(id);
  return m ? { q: Number(m[1]), r: Number(m[2]), d: m[3] as 'NE' | 'NW' | 'W' } : null;
}

// ---- Geometry --------------------------------------------------------------

/** The six neighbours of a hex: E, W, NE, NW, SE, SW. */
export function hexNeighbours(q: number, r: number): [number, number][] {
  return [
    [q + 1, r],
    [q - 1, r],
    [q + 1, r - 1],
    [q, r - 1],
    [q, r + 1],
    [q - 1, r + 1],
  ];
}

/** The six corners of a hex, clockwise from the top. */
export function hexCorners(q: number, r: number): string[] {
  return [
    vertexId(q, r, 'N'),
    vertexId(q + 1, r - 1, 'S'),
    vertexId(q, r + 1, 'N'),
    vertexId(q, r, 'S'),
    vertexId(q - 1, r + 1, 'N'),
    vertexId(q, r - 1, 'S'),
  ];
}

/** The six sides of a hex, clockwise from the upper right. */
export function hexSides(q: number, r: number): string[] {
  return [
    edgeId(q, r, 'NE'),
    edgeId(q + 1, r, 'W'),
    edgeId(q, r + 1, 'NW'),
    edgeId(q - 1, r + 1, 'NE'),
    edgeId(q, r, 'W'),
    edgeId(q, r, 'NW'),
  ];
}

/** An edge's two corners. */
export function edgeEnds(id: string): [string, string] {
  const e = parseEdge(id);
  if (!e) throw new Error(`not an edge id: ${id}`);
  const { q, r, d } = e;
  if (d === 'NE') return [vertexId(q, r, 'N'), vertexId(q + 1, r - 1, 'S')];
  if (d === 'NW') return [vertexId(q, r - 1, 'S'), vertexId(q, r, 'N')];
  return [vertexId(q - 1, r + 1, 'N'), vertexId(q, r - 1, 'S')];
}

/** The three corners one side away (on or off the island). */
export function vertexNeighbours(id: string): string[] {
  const v = parseVertex(id);
  if (!v) throw new Error(`not a vertex id: ${id}`);
  const { q, r, d } = v;
  return d === 'N'
    ? [vertexId(q, r - 1, 'S'), vertexId(q + 1, r - 1, 'S'), vertexId(q + 1, r - 2, 'S')]
    : [vertexId(q, r + 1, 'N'), vertexId(q - 1, r + 1, 'N'), vertexId(q - 1, r + 2, 'N')];
}

/** The three sides meeting at a corner (on or off the island). */
export function vertexEdges(id: string): string[] {
  const v = parseVertex(id);
  if (!v) throw new Error(`not a vertex id: ${id}`);
  const { q, r, d } = v;
  return d === 'N'
    ? [edgeId(q, r, 'NE'), edgeId(q, r, 'NW'), edgeId(q + 1, r - 1, 'W')]
    : [edgeId(q, r + 1, 'NW'), edgeId(q - 1, r + 1, 'NE'), edgeId(q, r + 1, 'W')];
}

/** The three hexes meeting at a corner (on or off the island), as ids. */
export function vertexHexes(id: string): string[] {
  const v = parseVertex(id);
  if (!v) throw new Error(`not a vertex id: ${id}`);
  const { q, r, d } = v;
  return d === 'N'
    ? [hexId(q, r), hexId(q, r - 1), hexId(q + 1, r - 1)]
    : [hexId(q, r), hexId(q, r + 1), hexId(q - 1, r + 1)];
}

/** Pixel centre of a hex (size 1, y down) — for the coast order. */
export function hexCentre(q: number, r: number): { x: number; y: number } {
  return { x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r };
}
export function vertexPoint(id: string): { x: number; y: number } {
  const v = parseVertex(id)!;
  const c = hexCentre(v.q, v.r);
  return { x: c.x, y: c.y + (v.d === 'N' ? -1 : 1) };
}

// ---- Island shapes -----------------------------------------------------------

const dist = (q: number, r: number) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));

/** The land hexes of an island, top row first, west to east. */
export function islandCells(size: IslandSize): { q: number; r: number }[] {
  const radius = size === 'standard' ? 2 : 3;
  const out: { q: number; r: number }[] = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (dist(q, r) > radius) continue;
      // The large island drops its six corner hexes (a ±3 paired with a 0).
      if (size === 'large' && dist(q, r) === 3 && (q === 0 || r === 0 || q + r === 0)) continue;
      out.push({ q, r });
    }
  }
  return out;
}

export interface Geometry {
  /** Land hex ids, in island order. */
  hexes: string[];
  hexSet: Set<string>;
  /** Every corner of a land hex, sorted. */
  vertices: string[];
  vertexSet: Set<string>;
  /** Every side of a land hex, sorted. */
  edges: string[];
  edgeSet: Set<string>;
  /** Corner → the land hexes touching it. */
  vertexLand: Map<string, string[]>;
  /** Corner → its sides that are on the board. */
  vertexBoardEdges: Map<string, string[]>;
  /** Corner → its neighbour corners that are on the board. */
  vertexBoardNeighbours: Map<string, string[]>;
  /** Sides of exactly one land hex, in coast order (clockwise from straight up). */
  coast: string[];
}

const geometryCache = new Map<IslandSize, Geometry>();

export function geometry(size: IslandSize): Geometry {
  const cached = geometryCache.get(size);
  if (cached) return cached;
  const cells = islandCells(size);
  const hexes = cells.map((c) => hexId(c.q, c.r));
  const hexSet = new Set(hexes);
  const vertexSet = new Set<string>();
  const sideCount = new Map<string, number>();
  for (const { q, r } of cells) {
    for (const v of hexCorners(q, r)) vertexSet.add(v);
    for (const e of hexSides(q, r)) sideCount.set(e, (sideCount.get(e) ?? 0) + 1);
  }
  const edgeSet = new Set(sideCount.keys());
  const vertices = [...vertexSet].sort();
  const edges = [...edgeSet].sort();
  const vertexLand = new Map<string, string[]>();
  const vertexBoardEdges = new Map<string, string[]>();
  const vertexBoardNeighbours = new Map<string, string[]>();
  for (const v of vertices) {
    vertexLand.set(v, vertexHexes(v).filter((h) => hexSet.has(h)));
    vertexBoardEdges.set(v, vertexEdges(v).filter((e) => edgeSet.has(e)));
    vertexBoardNeighbours.set(v, vertexNeighbours(v).filter((n) => vertexSet.has(n)));
  }
  const angle = (e: string) => {
    const [a, b] = edgeEnds(e).map(vertexPoint);
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    const t = Math.atan2(x, -y);
    return t < -1e-9 ? t + 2 * Math.PI : Math.max(0, t);
  };
  const coast = edges
    .filter((e) => sideCount.get(e) === 1)
    .map((e) => ({ e, a: angle(e) }))
    .sort((x, y) => x.a - y.a || (x.e < y.e ? -1 : 1))
    .map((x) => x.e);
  const g: Geometry = { hexes, hexSet, vertices, vertexSet, edges, edgeSet, vertexLand, vertexBoardEdges, vertexBoardNeighbours, coast };
  geometryCache.set(size, g);
  return g;
}

// ---- What goes on each island -----------------------------------------------

export const ISLAND: Record<
  IslandSize,
  {
    tiles: Record<HexKind, number>;
    tokens: number[];
    harbours: HarbourKind[];
    bank: number;
    deck: Record<'ranger' | 'heirloom' | 'pathfinders' | 'harvest' | 'market', number>;
  }
> = {
  standard: {
    tiles: { woods: 4, claypit: 3, meadow: 4, fields: 4, quarry: 3, dunes: 1 },
    tokens: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
    harbours: ['any', 'any', 'any', 'any', ...RESOURCES],
    bank: 19,
    deck: { ranger: 14, heirloom: 5, pathfinders: 2, harvest: 2, market: 2 },
  },
  large: {
    tiles: { woods: 6, claypit: 5, meadow: 6, fields: 6, quarry: 5, dunes: 3 },
    tokens: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12],
    harbours: ['any', 'any', 'any', 'any', 'any', 'any', ...RESOURCES],
    bank: 24,
    deck: { ranger: 20, heirloom: 5, pathfinders: 3, harvest: 3, market: 3 },
  },
};

/** Coastal edge index of harbour `i`: spread evenly round the coast. */
export function harbourPositions(size: IslandSize): number[] {
  const coast = geometry(size).coast.length;
  const count = ISLAND[size].harbours.length;
  return Array.from({ length: count }, (_, i) => Math.floor((i * coast) / count));
}

// ---- Generation ------------------------------------------------------------

export type Next = () => number;

export function shuffle<T>(items: T[], next: Next): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Hex index pairs that are neighbours on this island, and triples that meet at a corner. */
const adjacencyCache = new Map<IslandSize, { pairs: [number, number][]; triples: [number, number, number][] }>();
function adjacency(size: IslandSize): { pairs: [number, number][]; triples: [number, number, number][] } {
  const cached = adjacencyCache.get(size);
  if (cached) return cached;
  const g = geometry(size);
  const index = new Map(g.hexes.map((h, i) => [h, i]));
  const pairs: [number, number][] = [];
  g.hexes.forEach((h, i) => {
    const { q, r } = parseHex(h)!;
    for (const [nq, nr] of hexNeighbours(q, r)) {
      const j = index.get(hexId(nq, nr));
      if (j !== undefined && j > i) pairs.push([i, j]);
    }
  });
  const triples: [number, number, number][] = [];
  for (const v of g.vertices) {
    const land = g.vertexLand.get(v)!;
    if (land.length === 3) triples.push(land.map((h) => index.get(h)!) as [number, number, number]);
  }
  adjacencyCache.set(size, { pairs, triples });
  return { pairs, triples };
}

/** Whether a layout (kind and token per hex, island order) keeps the three balance rules. */
export function balanced(size: IslandSize, kinds: HexKind[], tokens: (number | null)[]): boolean {
  return tilesBalanced(size, kinds) && tokensBalanced(size, tokens);
}

function tilesBalanced(size: IslandSize, kinds: HexKind[]): boolean {
  // No three hexes meeting at a corner all the same resource.
  return adjacency(size).triples.every(([a, b, c]) => !(kinds[a] !== 'dunes' && kinds[a] === kinds[b] && kinds[b] === kinds[c]));
}

function tokensBalanced(size: IslandSize, tokens: (number | null)[]): boolean {
  for (const [a, b] of adjacency(size).pairs) {
    const x = tokens[a];
    const y = tokens[b];
    if (x === null || y === null) continue;
    // No neighbouring 6/8s, and no neighbours sharing a number.
    if ((x === 6 || x === 8) && (y === 6 || y === 8)) return false;
    if (x === y) return false;
  }
  return true;
}

/**
 * Fixed layouts that keep every balance rule (asserted in a test), used if
 * 2000 random tries all fail. Kinds and tokens in island order.
 */
export const FALLBACK: Record<IslandSize, { kinds: HexKind[]; tokens: (number | null)[] }> = {
  standard: {
    kinds: ['quarry', 'fields', 'quarry', 'meadow', 'claypit', 'fields', 'woods', 'woods', 'dunes', 'meadow', 'woods', 'claypit', 'woods', 'fields', 'claypit', 'fields', 'quarry', 'meadow', 'meadow'],
    tokens: [8, 3, 5, 4, 5, 12, 11, 8, null, 9, 4, 6, 10, 6, 11, 3, 9, 2, 10],
  },
  large: {
    kinds: ['meadow', 'claypit', 'meadow', 'fields', 'claypit', 'fields', 'woods', 'woods', 'quarry', 'meadow', 'dunes', 'claypit', 'claypit', 'meadow', 'quarry', 'dunes', 'claypit', 'fields', 'woods', 'woods', 'meadow', 'quarry', 'quarry', 'meadow', 'fields', 'quarry', 'woods', 'dunes', 'fields', 'woods', 'fields'],
    tokens: [11, 9, 5, 12, 3, 2, 10, 6, 11, 8, null, 6, 3, 9, 4, null, 4, 11, 5, 6, 10, 8, 10, 8, 3, 5, 4, null, 12, 2, 9],
  },
};

const MAX_TRIES = 2000;

const SEARCH_BUDGET = 4000;

/** Tokens over the non-dunes hexes keeping the token rules, or null if the search ran out. */
function placeTokens(size: IslandSize, kinds: HexKind[], pool: readonly number[], next: Next): (number | null)[] | null {
  const { pairs } = adjacency(size);
  const near: number[][] = kinds.map(() => []);
  for (const [a, b] of pairs) {
    near[a].push(b);
    near[b].push(a);
  }
  const order = shuffle(
    kinds.map((k, i) => (k === 'dunes' ? -1 : i)).filter((i) => i >= 0),
    next,
  );
  const left = new Map<number, number>();
  for (const t of pool) left.set(t, (left.get(t) ?? 0) + 1);
  const out: (number | null)[] = kinds.map(() => null);
  let budget = SEARCH_BUDGET;
  const red = (t: number) => t === 6 || t === 8;
  const fits = (i: number, t: number) =>
    near[i].every((j) => {
      const u = out[j];
      return u === null || (u !== t && !(red(u) && red(t)));
    });
  const place = (n: number): boolean => {
    if (n === order.length) return true;
    if (--budget < 0) return false;
    const i = order[n];
    const values = shuffle([...left.keys()].filter((t) => left.get(t)! > 0), next);
    for (const t of values) {
      if (!fits(i, t)) continue;
      out[i] = t;
      left.set(t, left.get(t)! - 1);
      if (place(n + 1)) return true;
      left.set(t, left.get(t)! + 1);
      out[i] = null;
      if (budget < 0) return false;
    }
    return false;
  };
  return place(0) ? out : null;
}

/** A fresh island: tiles and tokens shuffled until balanced, harbour kinds shuffled round the coast. */
export function generateIsland(size: IslandSize, next: Next, maxTries = MAX_TRIES): Board & { fallback: boolean } {
  const g = geometry(size);
  const spec = ISLAND[size];
  const tilePool: HexKind[] = (Object.entries(spec.tiles) as [HexKind, number][]).flatMap(([k, n]) => Array<HexKind>(n).fill(k));
  let kinds: HexKind[] | null = null;
  let tokens: (number | null)[] | null = null;
  let tries = 0;
  while (tries < maxTries && !tokens) {
    tries++;
    const k = shuffle([...tilePool], next);
    if (!tilesBalanced(size, k)) continue;
    // Tokens go on by a shuffled backtracking search over this tile layout,
    // which finds a balanced placement almost always; a search that runs past
    // its budget counts as a failed try and the tiles are shuffled again.
    const placed = placeTokens(size, k, spec.tokens, next);
    if (placed) {
      kinds = k;
      tokens = placed;
    }
  }
  const fallback = !tokens;
  if (!kinds || !tokens) ({ kinds, tokens } = FALLBACK[size]);
  const hexes: Hex[] = g.hexes.map((id, i) => {
    const { q, r } = parseHex(id)!;
    const kind = kinds![i];
    const token = tokens![i];
    return { id, q, r, kind, resource: kind === 'dunes' ? null : PRODUCES[kind], token, pips: pips(token) };
  });
  const harbourKinds = shuffle([...spec.harbours], next);
  const harbours: Harbour[] = harbourPositions(size).map((at, i) => ({
    edge: g.coast[at],
    kind: harbourKinds[i],
    rate: harbourKinds[i] === 'any' ? 3 : 2,
  }));
  return { size, hexes, harbours, fallback };
}

/** The tile kind that makes a resource. */
export function kindFor(resource: Resource): HexKind {
  return KIND_OF[resource];
}
