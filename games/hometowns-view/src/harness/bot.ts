// The harness's bot mayor: a plain "grower" that plays a town through the
// real move API (applyCommand), exactly as a phone would, so harness mode has
// a living town to draw without a server (spec §9.16).
//
// It is NOT one of the Lab's twelve bots (those are WP5's, in engine/bots/,
// and read the wire and affordances). It reads the TownState directly and
// follows a fixed street plan, which keeps it short and predictable:
//
//   * Roads go on a fixed grid: every fifth column and row through the
//     County Road (x = 32) and the founding lane's row (y = 46). Blocks
//     between grid lines are 4×4, so every block tile is within 2 tiles of a
//     road (the development rule, §3.4), and grid-line tiles are never zoned,
//     so a later road always has room.
//   * It opens one road segment (5 tiles) at a time, nearest the Town Hall
//     first, and only when the zoned lots it already has are mostly taken.
//   * Each new segment's lots are zoned in proportion to the positive demand
//     meters, homes nearest the centre and industry furthest out.
//   * It keeps power and water ahead of an estimate of demand, adds civic
//     buildings as the town grows, and spends promotion parcel rights.
//
// Everything it does is a pure function of the county state and `now`
// (no Math.random, no clock), so a seed replays the same town every time.

import {
  BUILDINGS,
  B_BUILT,
  B_KIND,
  EngineError,
  MAP,
  USE_EMPTY,
  ZONE_DEFS,
  CAT_ROAD,
  CAT_ZONE,
  applyCommand,
  buildable,
  buildingIndex,
  checklistOf,
  constructionLeft,
  inMap,
  lvlLevel,
  openableParcels,
  paramsFor,
  parcelOpen,
  placeCost,
  planesOf,
  population,
  roadDef,
  terrainOf,
  tileIndex,
  useCat,
  ZONES,
  type CountyState,
  type DrawnRoad,
  type Op,
  type BuildingDef,
  type TownState,
  type ZoneKind,
} from '../engine';

/** The street grid: every fifth column through x = 32 and every fifth row through y = 46. */
export const GRID_X: readonly number[] = range(32 % 5, MAP, 5);
export const GRID_Y: readonly number[] = range(46 % 5, MAP, 5);
export const CENTRE: readonly [number, number] = [32, 46];
const SPACING = 5;

const onGridX = (x: number) => (x - GRID_X[0]) % SPACING === 0;
const onGridY = (y: number) => (y - GRID_Y[0]) % SPACING === 0;
export const onGrid = (x: number, y: number): boolean => onGridX(x) || onGridY(y);

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v < to; v += step) out.push(v);
  return out;
}

/** A road segment between two neighbouring grid nodes: [x0, y0, x1, y1]. */
export type Segment = [number, number, number, number];

/** Every grid segment on the map, in a fixed order (verticals, then horizontals). */
export const SEGMENTS: readonly Segment[] = (() => {
  const out: Segment[] = [];
  for (const x of GRID_X) for (let k = 0; k + 1 < GRID_Y.length; k++) out.push([x, GRID_Y[k], x, GRID_Y[k + 1]]);
  for (const y of GRID_Y) for (let k = 0; k + 1 < GRID_X.length; k++) out.push([GRID_X[k], y, GRID_X[k + 1], y]);
  return out;
})();

export function segmentTiles(s: Segment): number[] {
  const [x0, y0, x1, y1] = s;
  const out: number[] = [];
  if (x0 === x1) for (let y = y0; y <= y1; y++) out.push(tileIndex(x0, y));
  else for (let x = x0; x <= x1; x++) out.push(tileIndex(x, y0));
  return out;
}

const centreDistance = (x: number, y: number) => Math.abs(x - CENTRE[0]) + Math.abs(y - CENTRE[1]);

/** Open, buildable land (the move API's own test, so the bot never plans a refused tile). */
function landOk(t: TownState, x: number, y: number): boolean {
  return inMap(x, y) && parcelOpen(t, x, y) && buildable(terrainOf(t)[tileIndex(x, y)]);
}

/** Free for a new road or building: empty, or a zoned lot with nothing built or under way. */
function freeTile(t: TownState, i: number): boolean {
  const p = planesOf(t);
  const u = p.use[i];
  if (u === USE_EMPTY) return true;
  return useCat(u) === CAT_ZONE && lvlLevel(p.lvl[i]) === 0 && constructionLeft(t, i) === 0;
}

const isRoadTile = (t: TownState, i: number) => useCat(planesOf(t).use[i]) === CAT_ROAD;

/** 'built' (all road), 'open' (can be drawn now), or 'blocked'. */
export function segmentState(t: TownState, s: Segment): 'built' | 'open' | 'blocked' {
  let all = true;
  for (const i of segmentTiles(s)) {
    if (isRoadTile(t, i)) continue;
    all = false;
    const x = i % MAP;
    const y = (i - x) / MAP;
    if (!landOk(t, x, y) || !freeTile(t, i)) return 'blocked';
  }
  return all ? 'built' : 'open';
}

/** The open segments that touch the existing road network, nearest the centre first. */
export function nextSegments(t: TownState): Segment[] {
  const out: [number, Segment][] = [];
  for (const s of SEGMENTS) {
    if (segmentState(t, s) !== 'open') continue;
    if (!segmentTiles(s).some((i) => isRoadTile(t, i))) continue;
    out.push([centreDistance((s[0] + s[2]) / 2, (s[1] + s[3]) / 2), s]);
  }
  out.sort((a, b) => a[0] - b[0] || SEGMENTS.indexOf(a[1]) - SEGMENTS.indexOf(b[1]));
  return out.map(([, s]) => s);
}

/** The empty, zonable lots beside a segment (off the grid lines), nearest the segment, then the centre. */
export function lotsBeside(t: TownState, s: Segment): [number, number][] {
  const seen = new Set<number>();
  const out: [number, number, number][] = [];
  for (const i of segmentTiles(s)) {
    const sx = i % MAP;
    const sy = (i - sx) / MAP;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = sx + dx;
        const y = sy + dy;
        if (!inMap(x, y) || onGrid(x, y)) continue;
        const k = tileIndex(x, y);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!landOk(t, x, y) || planesOf(t).use[k] !== USE_EMPTY) continue;
        out.push([Math.max(Math.abs(dx), Math.abs(dy)) * 1000 + centreDistance(x, y), x, y]);
      }
  }
  out.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
  return out.map(([, x, y]) => [x, y]);
}

// ---- Zoning by demand ---------------------------------------------------------------------------

/** Zones this town may paint now (unlocked, and not past the tier where new ones stop). */
export function zonableKinds(t: TownState): number[] {
  const out: number[] = [];
  for (let z = 0; z < ZONE_DEFS.length; z++) if (t.tier >= ZONE_DEFS[z].unlock && t.tier <= ZONE_DEFS[z].zoneUntil) out.push(z);
  return out;
}

/** How much the bot wants each zone kind, from the meters (homes take the best of the three tiers). */
export function zoneWeights(t: TownState, distance: number): number[] {
  const m = t.meters;
  const w = new Array<number>(ZONES.length).fill(0);
  const allowed = zonableKinds(t);
  const want = [Math.max(m[0], m[1], m[2]) + 10, m[3], m[4], m[5], m[6], m[7]];
  for (const z of allowed) w[z] = Math.max(0, want[z]);
  // Industry keeps away from the centre (its smoke lowers homes' land value), offices stay central, farms go out.
  if (distance < 12) w[3] = 0;
  if (distance > 16) w[4] = 0;
  if (distance < 6) w[5] = 0;
  return w;
}

/** Splits n lots across zone kinds by weight (largest remainder, ties by zone order). */
export function apportion(n: number, weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const out = new Array<number>(weights.length).fill(0);
  if (total <= 0 || n <= 0) return out;
  const rem: [number, number][] = [];
  let given = 0;
  for (let z = 0; z < weights.length; z++) {
    const exact = (n * weights[z]) / total;
    out[z] = Math.floor(exact);
    given += out[z];
    rem.push([exact - out[z], z]);
  }
  rem.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; given < n; k++, given++) out[rem[k % rem.length][1]] += 1;
  return out;
}

/** Order lots are handed out in: central kinds first, so homes sit inside and industry outside. */
const ZONE_FILL_ORDER = [4, 1, 2, 0, 5, 3];

// ---- Utilities and services -------------------------------------------------------------------------

function supplyOf(t: TownState, what: 'power' | 'water'): number {
  let s = 0;
  for (const b of t.buildings) s += BUILDINGS[b[0]]?.supply?.[what] ?? 0;
  return s;
}

/** Jobs on the map: built non-homes lots × their capacity. */
export function jobsEstimate(t: TownState): number {
  const p = planesOf(t);
  let jobs = 0;
  for (let i = 0; i < p.use.length; i++) {
    const u = p.use[i];
    if (useCat(u) !== CAT_ZONE) continue;
    const z = u & 0xfff;
    const lv = lvlLevel(p.lvl[i]);
    if (z === 0 || lv === 0) continue;
    jobs += ZONE_DEFS[z].capacity[lv - 1] ?? 0;
  }
  for (const b of t.buildings) jobs += BUILDINGS[b[0]]?.staff ?? 0;
  return jobs;
}

/** Power and water the town will want soon: residents, jobs and a margin for the pipeline. */
export function utilityDemand(t: TownState): { power: number; water: number } {
  const pop = population(t);
  const jobs = jobsEstimate(t);
  return { power: Math.ceil(1.25 * (pop + 1.3 * jobs) + 60), water: Math.ceil(1.25 * (pop + 0.7 * jobs) + 60) };
}

/**
 * Background services by size, after the checklist's needs:
 * [building id, from tier, until tier, one per this many residents, first at this population].
 */
export const SERVICE_PLAN: readonly [string, number, number, number, number][] = [
  ['villageGreen', 0, 1, 400, 40],
  ['schoolHouse', 0, 0, 500, 150],
  ['pocketPark', 0, 1, 600, 250],
  ['fireVolunteers', 1, 1, 1500, 300],
  ['constablePost', 1, 1, 2500, 300],
  ['surgery', 1, 1, 2000, 300],
  ['villageSchool', 1, 1, 1500, 400],
  ['park', 1, 4, 2500, 600],
  ['playground', 1, 2, 3000, 900],
  ['communityHall', 1, 2, 6000, 1200],
  ['primarySchool', 2, 4, 3500, 0],
  ['healthCentre', 2, 4, 10000, 0],
  ['fireStation', 2, 4, 15000, 0],
  ['policeStation', 2, 4, 15000, 0],
  ['secondarySchool', 2, 4, 12000, 5000],
  ['library', 2, 4, 20000, 8000],
  ['sportsPitches', 2, 4, 20000, 8000],
  ['museum', 2, 4, 40000, 12000],
  ['hospital', 3, 4, 60000, 0],
  ['theatre', 3, 4, 60000, 30000],
];

/** The next background service the town is short of, or null. */
export function serviceWanted(t: TownState): string | null {
  const pop = population(t);
  for (const [id, from, until, per, first] of SERVICE_PLAN) {
    if (t.tier < from || t.tier > until || pop < first) continue;
    if (count(t, id) < Math.max(1, Math.ceil(pop / per))) return id;
  }
  return null;
}

const count = (t: TownState, id: string) => {
  const kind = buildingIndex(id);
  let n = 0;
  for (const b of t.buildings) if (b[0] === kind) n++;
  return n;
};

/** The building that answers each item of the next tier's checklist (§7), by the town's tier. */
const CHECK_ANSWERS: Record<string, (t: TownState) => string | null> = {
  water90: (t) => (t.tier >= 1 ? 'waterTower' : 'well'),
  school: () => 'schoolHouse',
  green70: (t) => (t.tier >= 1 ? 'park' : 'villageGreen'),
  surgery70: () => 'surgery',
  police50: () => 'constablePost',
  fire70: () => 'fireVolunteers',
  power95: (t) => (t.tier >= 1 ? 'generator' : 'windmill'),
  primary80: () => 'villageSchool',
  secondary75: () => 'secondarySchool',
  healthCentre: () => 'healthCentre',
  libraryMuseum: () => 'library',
  bus40: (t) => (!count(t, 'busDepot') ? 'busDepot' : count(t, 'busStop') < 4 + population(t) / 1500 ? 'busStop' : null),
  safety60: () => 'policeStation',
  university: () => 'university',
  culture60: () => 'museum',
  transit20: (t) => (!count(t, 'busDepot') ? 'busDepot' : count(t, 'busStop') < 4 + population(t) / 1500 ? 'busStop' : null),
  landmarks2: (t) => (count(t, 'townLandmark') ? 'clockTower' : 'townLandmark'),
};

/** Unmet items of the next tier's checklist, as known at the last month end. */
export function checklistNeeds(t: TownState): string[] {
  return checklistOf(t)
    .filter((i) => !i.met)
    .map((i) => i.id);
}

/** Buildings the checklist asks for now, in checklist order (each at most once). */
export function checklistBuildings(t: TownState): string[] {
  const out: string[] = [];
  for (const id of checklistNeeds(t)) {
    const b = CHECK_ANSWERS[id]?.(t);
    if (b && !out.includes(b)) out.push(b);
  }
  return out;
}

/**
 * Where a service reaches the most homes nobody of its kind reaches yet:
 * homes tiles (built or zoned) are weighted, the ones within the effective
 * radius of a same-group building are dropped, and every legal spot is
 * scored by the weight inside its radius (a 2-D prefix sum, so it is cheap).
 * Coverage fades from r/2 tiles to r (§5.4), so the bot plans on 0.6·r.
 */
export function findCoverSpot(t: TownState, def: BuildingDef): [number, number, 0 | 1] | null {
  const reach = Math.max(2, Math.round(0.6 * def.radius));
  const p = planesOf(t);
  const wgt = new Float64Array(MAP * MAP);
  for (let i = 0; i < p.use.length; i++) if (useCat(p.use[i]) === CAT_ZONE && (p.use[i] & 0xfff) === 0) wgt[i] = 1 + lvlLevel(p.lvl[i]);
  for (const b of t.buildings) {
    const other = BUILDINGS[b[0]];
    if (!other || other.group !== def.group) continue;
    const r = Math.max(1, Math.round(0.6 * other.radius));
    for (let y = Math.max(0, b[2] - r); y <= Math.min(MAP - 1, b[2] + r); y++)
      for (let x = Math.max(0, b[1] - r); x <= Math.min(MAP - 1, b[1] + r); x++) wgt[tileIndex(x, y)] = 0;
  }
  // Prefix sums: S[(y+1)·65 + (x+1)] = Σ wgt over [0..x] × [0..y].
  const W = MAP + 1;
  const S = new Float64Array(W * W);
  for (let y = 0; y < MAP; y++)
    for (let x = 0; x < MAP; x++) S[(y + 1) * W + x + 1] = wgt[tileIndex(x, y)] + S[y * W + x + 1] + S[(y + 1) * W + x] - S[y * W + x];
  const box = (x0: number, y0: number, x1: number, y1: number) => {
    const a = Math.max(0, x0);
    const b = Math.max(0, y0);
    const c = Math.min(MAP - 1, x1);
    const d = Math.min(MAP - 1, y1);
    if (c < a || d < b) return 0;
    return S[(d + 1) * W + c + 1] - S[b * W + c + 1] - S[(d + 1) * W + a] + S[b * W + a];
  };
  let best: [number, number, number, 0 | 1] | null = null;
  eachSpot(t, def.w, def.h, (x, y, w, h, rot) => {
    const cx = x + (w - 1) / 2;
    const cy = y + (h - 1) / 2;
    const v = box(Math.ceil(cx - reach), Math.ceil(cy - reach), Math.floor(cx + reach), Math.floor(cy + reach));
    // Ties go to the spot nearer the centre (a total order: the scan order breaks the rest).
    const score = v * 1000 - centreDistance(x, y);
    if (v > 0 && (!best || score > best[0])) best = [score, x, y, rot];
  });
  return best ? [best[1], best[2], best[3]] : null;
}

/** Calls `f` for every legal spot of a w×h building (both rotations), in a fixed scan order. */
function eachSpot(t: TownState, w: number, h: number, f: (x: number, y: number, fw: number, fh: number, rot: 0 | 1) => void): void {
  for (const rot of [0, 1] as const) {
    if (rot === 1 && w === h) continue;
    const [fw, fh] = rot === 1 ? [h, w] : [w, h];
    for (const gy of GRID_Y)
      for (const gx of GRID_X)
        for (let oy = 1; oy + fh <= SPACING; oy++)
          for (let ox = 1; ox + fw <= SPACING; ox++) if (fits(t, gx + ox, gy + oy, fw, fh)) f(gx + ox, gy + oy, fw, fh, rot);
  }
}

/**
 * Where a w×h building fits: inside a block, touching a built road, on free
 * land. `near` prefers the centre (services); otherwise the outskirts (power
 * plants). Returns [x, y, rot] or null.
 */
export function findSpot(t: TownState, w: number, h: number, near: boolean): [number, number, 0 | 1] | null {
  let best: [number, number, number, 0 | 1] | null = null;
  eachSpot(t, w, h, (x, y, _w, _h, rot) => {
    const d = centreDistance(x, y);
    const score = near ? d : -d;
    if (!best || score < best[0]) best = [score, x, y, rot];
  });
  return best ? [best[1], best[2], best[3]] : null;
}

function fits(t: TownState, x: number, y: number, w: number, h: number): boolean {
  let touches = false;
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      if (!landOk(t, xx, yy)) return false;
      const i = tileIndex(xx, yy);
      if (!freeTile(t, i)) return false;
      if (!touches)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = xx + dx;
          const ny = yy + dy;
          if (inMap(nx, ny) && isRoadTile(t, tileIndex(nx, ny))) touches = true;
        }
    }
  return touches;
}

// ---- The turn ------------------------------------------------------------------------------------------

export interface BotTurn {
  /** Ids of the moves that were applied. */
  moves: string[];
  /** Refusal sentences (EngineError), for the harness log. */
  refused: string[];
  /** A Regional Day was finishing: the harness should run catch-up and try again. */
  retry: boolean;
}

interface Ctx {
  c: CountyState;
  seat: string;
  t: TownState;
  now: number;
  floor: number;
  growthFloor: number;
  turn: BotTurn;
  serial: number;
}

/**
 * £ the bot keeps in hand: a cushion plus some months of running costs.
 * Growth (roads and zones, which bring rates in) may dig deeper than new
 * services (which only add upkeep).
 */
export function reserveFloor(t: TownState, forGrowth = false): number {
  const months = forGrowth ? 0.5 : 2;
  return (forGrowth ? 8000 : 15000) + months * (t.civicMemo?.spending ?? 0);
}

function plan(x: Ctx, ops: Op[], tag: string): boolean {
  if (!ops.length) return false;
  const planId = `${x.seat}-${tag}-${x.t.tick}-${x.serial++}`;
  return act(x, { type: 'build', planId, plan: ops }, planId);
}

function act(x: Ctx, cmd: Parameters<typeof applyCommand>[2], id: string): boolean {
  try {
    applyCommand(x.c, x.seat, cmd, x.now);
    x.turn.moves.push(id);
    return true;
  } catch (e) {
    if (!(e instanceof EngineError)) throw e;
    if (e.retry) x.turn.retry = true;
    x.turn.refused.push(e.message);
    return false;
  }
}

const affordable = (x: Ctx, cost: number, growth = false) => x.t.money.reserves - cost >= (growth ? x.growthFloor : x.floor);

function roadKind(t: TownState): DrawnRoad {
  return t.tier >= 2 ? 'street' : 'lane';
}

function roadCost(t: TownState, s: Segment): number {
  const def = roadDef(roadKind(t));
  let n = 0;
  for (const i of segmentTiles(s)) if (!isRoadTile(t, i)) n++;
  return n * def.build * (t.siteKind === 'hills' ? 1.5 : 1);
}

/** Bramble's three founding steps (§1.5, A12): a lane off the County Road, 12 Homes, 2 Farms and a Well. */
function founding(x: Ctx): void {
  const { t } = x;
  const lots: [number, number][] = [];
  // Lane segments off the County Road until there is room for the tutorial's 15 tiles.
  for (let k = 0; k < 3 && lots.length < 15; k++) {
    const s = nextSegments(t)[0];
    if (!s || !plan(x, [{ op: 'road', kind: 'lane', path: [...s] }], 'lane')) break;
    for (const l of lotsBeside(t, s)) if (!lots.some((m) => m[0] === l[0] && m[1] === l[1])) lots.push(l);
  }
  plan(x, lots.slice(0, 12).map(([lx, ly]): Op => ({ op: 'zone', zone: 'homes', rect: [lx, ly, 1, 1] })), 'homes');
  const rest: Op[] = lots.slice(12, 14).map(([lx, ly]): Op => ({ op: 'zone', zone: 'farms', rect: [lx, ly, 1, 1] }));
  const well = lots[14] ?? findSpot(t, 1, 1, true);
  if (well) rest.push({ op: 'place', id: 'well', x: well[0], y: well[1], rot: 0 });
  plan(x, rest, 'farms');
}

function keepUtilities(x: Ctx): void {
  const { t } = x;
  const d = utilityDemand(t);
  for (const what of ['power', 'water'] as const) {
    const short = d[what] - supplyOf(t, what);
    if (short <= 0) continue;
    const id = utilityChoice(t, what, short);
    if (!id) continue;
    place(x, id, what === 'power' && id !== 'windmill' && id !== 'windTurbine' ? false : true);
  }
}

function utilityChoice(t: TownState, what: 'power' | 'water', short: number): string | null {
  if (what === 'power') {
    if (t.tier >= 2 && short > 4000) return 'gasPlant';
    if (t.tier >= 2) return 'windTurbine';
    if (t.tier >= 1 && short > 300) return 'generator';
    return 'windmill';
  }
  if (t.tier >= 2 && short > 6000) return 'pumpingStation';
  if (t.tier >= 1 && short > 300) return 'waterTower';
  return 'well';
}

/** A building of the same kind placed within this many ticks (3 months) blocks another. */
const RECENT_TICKS = 12;

/** Running a surplus (or too new to know): background services only add upkeep, so they wait for one. */
export function inSurplus(t: TownState): boolean {
  const m = t.civicMemo;
  return !m || m.revenue >= 1.05 * m.spending;
}

/**
 * Places one building: services where they reach the most unserved homes,
 * clean utilities near the centre, polluting ones out on the edge.
 */
function place(x: Ctx, id: string, near: boolean): boolean {
  const { t } = x;
  const kind = buildingIndex(id);
  const def = BUILDINGS[kind];
  if (!def || t.tier < def.tier) return false;
  if (def.unique && count(t, id) > 0) return false;
  // Coverage and the checklist are judged at month end, after a building opens: give the last one time to count.
  if (t.buildings.some((b) => b[B_KIND] === kind && b[B_BUILT] > t.tick - RECENT_TICKS)) return false;
  if (!affordable(x, placeCost(t, kind, paramsFor(x.c.paramsVersion)))) return false;
  const covers = def.radius > 0 && def.radius !== Infinity && def.cover !== undefined;
  const spot = covers ? findCoverSpot(t, def) : findSpot(t, def.w, def.h, near && !def.pollution);
  if (!spot) return false;
  return plan(x, [{ op: 'place', id, x: spot[0], y: spot[1], rot: spot[2] }], id);
}

/** Zoned lots still waiting for a builder. */
export function emptyLots(t: TownState): { empty: number; zoned: number } {
  const p = planesOf(t);
  let empty = 0;
  let zoned = 0;
  for (let i = 0; i < p.use.length; i++) {
    if (useCat(p.use[i]) !== CAT_ZONE) continue;
    zoned++;
    if (lvlLevel(p.lvl[i]) === 0 && constructionLeft(t, i) === 0) empty++;
  }
  return { empty, zoned };
}

/** Tiles zoned for zone kind z. */
export function zoneCount(t: TownState, z: number): number {
  const p = planesOf(t);
  let n = 0;
  for (let i = 0; i < p.use.length; i++) if (useCat(p.use[i]) === CAT_ZONE && (p.use[i] & 0xfff) === z) n++;
  return n;
}

function expand(x: Ctx): void {
  const { t } = x;
  const pop = population(t);
  const segments = Math.min(4, 1 + Math.floor(pop / 4000));
  for (let k = 0; k < segments; k++) {
    const { empty, zoned } = emptyLots(t);
    if (empty > Math.max(6, zoned * 0.12)) return;
    // The nearest segment with lots beside it; failing that, the nearest one (a connector to fresh land).
    const options = nextSegments(t);
    const s = options.find((q) => lotsBeside(t, q).length >= 4) ?? options[0];
    if (!s) return;
    const mid = centreDistance((s[0] + s[2]) / 2, (s[1] + s[3]) / 2);
    const weights = zoneWeights(t, mid);
    const lots = lotsBeside(t, s);
    const counts = apportion(lots.length, weights);
    if (!lots.length && weights.some((w) => w > 0)) {
      if (!affordable(x, roadCost(t, s), true) || !plan(x, [{ op: 'road', kind: roadKind(t), path: [...s] }], 'road')) return;
      continue;
    }
    // The Village checklist wants a market of 6 shop lots, whatever the meter says.
    const shopsShort = zonableKinds(t).includes(1) ? Math.max(0, 6 - zoneCount(t, 1)) : 0;
    for (let n = 0; n < shopsShort && counts[0] > 0; n++) {
      counts[0]--;
      counts[1]++;
    }
    if (counts.every((n) => n === 0)) return; // nobody wants anything: no road for its own sake
    if (!affordable(x, roadCost(t, s), true)) return;
    const ops: Op[] = [{ op: 'road', kind: roadKind(t), path: [...s] }];
    let next = 0;
    for (const z of ZONE_FILL_ORDER)
      for (let n = 0; n < counts[z]; n++, next++) ops.push({ op: 'zone', zone: ZONES[z] as ZoneKind, rect: [lots[next][0], lots[next][1], 1, 1] });
    if (!plan(x, ops, 'grow')) return;
  }
}

function openParcel(x: Ctx): void {
  const { t } = x;
  if (t.parcelRights < 1) return;
  const options = openableParcels(t.parcels);
  if (!options.length) return;
  // The parcel whose centre is nearest the Town Hall.
  const centre = (p: number) => centreDistance((p % 4) * 16 + 8, Math.floor(p / 4) * 16 + 8);
  options.sort((a, b) => centre(a) - centre(b) || a - b);
  if (!affordable(x, 5000 * Math.max(1, t.tier), true)) return;
  plan(x, [{ op: 'parcel', p: options[0] }], 'parcel');
}

/**
 * One bot turn for `seat` at `now`. The harness calls it once a game month
 * (and once at founding). Refusals are collected, never thrown.
 */
export function botTurn(c: CountyState, seat: string, now: number): BotTurn {
  const turn: BotTurn = { moves: [], refused: [], retry: false };
  const t = c.towns.find((q) => q.seat === seat);
  if (!t || t.archived) return turn;
  const x: Ctx = { c, seat, t, now, floor: reserveFloor(t), growthFloor: reserveFloor(t, true), turn, serial: 0 };
  act(x, { type: 'hello' }, 'hello');
  if (t.tick === 0 && t.undo.length === 0) {
    founding(x);
    return turn;
  }
  if (t.money.helper) return turn; // Helper Mode: Bramble has paused new builds
  openParcel(x);
  keepUtilities(x);
  // The next tier's checklist first, then services by size: at most two new buildings a month.
  let placed = 0;
  for (const id of checklistBuildings(t)) if (placed < 2 && place(x, id, true)) placed++;
  const service = serviceWanted(t);
  if (service && placed < 2 && inSurplus(t)) place(x, service, true);
  expand(x);
  return turn;
}
