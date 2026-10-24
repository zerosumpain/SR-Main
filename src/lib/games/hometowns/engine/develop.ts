// Development (WP2e; spec §5.2 steps 2–4, §2.3, §3.3, A11, A12, A23, A24):
// how zoned land fills with cottages, shops and works, levels up, declines,
// catches fire now and then, and how a founding town gets its first people.
//
// Three steps plug into the step table:
//   - the tick step `stepDevelop` (after construction): repairs count down,
//     a quarter of the map takes its development roll (every tile during the
//     Founding Fortnight), winners become construction starts up to the
//     Builders cap, then mild incidents and the founders' carts;
//   - M1b `stepSupply`: homes, jobs and beds counted from the tiles, the
//     month's development slot, and the A9 reachability flags;
//   - M14b `stepDevelopMemo`: last thing in the month, it keeps what the
//     next four ticks need from this month's fields.
//
// Why a memo. A tick's growth score uses the fields (land value, pollution,
// safety, access, coverage), but the month's blackboard dies at month end,
// and recomputing every field each tick would cost four month steps. So the
// tick reads last month's fields, the way §5.2 reads them, from a compact
// copy in `t.dev`: per cell and zone the desirability L_k(x) (only for cells
// that hold that zone), fire coverage and the hotel test, and per tile the
// power, water and missing-service months. It is lagged state, like A26's
// pollution lag, so a revived town ticks exactly as one that never stopped.
// Anything stored elsewhere (land value, the pollution lag, meters, people,
// marks) is read live.
//
// `t.dev` is "<tick part>|<month part>", both base64: the tick part is small
// and changes most ticks (incident allowance, the builders turned away this
// month, and sparse per-tile notes: the level a tile is upgrading from, and
// a closed tile's ticks left); the month part is RLE'd and written once a
// month, so a tick never re-encodes it.
//
// Conventions shared with the other packages. A tile under construction
// already shows its new level in `lvl` with ticks left in `construction`
// (WP1's construction step finishes it). A level-up keeps the old level's
// homes and jobs open while the scaffolding is up: only the increment is
// pipeline. A tile closed by an incident carries MARK_DAMAGED; its capacity
// counts as pipeline until it is repaired. Nothing here moves money except a
// civic building's repair, and nobody is removed: residents above a declined
// tile's capacity are re-housed or squeezed by WP2b's monthly allocation.
//
// The hot loops copy imported constants into module locals and inline the
// tile bit layouts (tiles.ts), as housing.ts does: an imported binding is a
// property read on every access once the module is transformed for tests or
// the server, and the tick scan touches thousands of tiles.

import { TICKS_PER_MONTH, TICKS_PER_YEAR } from './clock';
import { ZONE_DEFS, tileMix } from './content';
import { fromBase64, rleDecode, rleEncode, toBase64 } from './codec';
import { flow, flowIndex, population, postPeople, postWhole } from './core';
import { neutral } from './derived';
import { sigma } from './fx';
import { allocate, cohortPersons } from './housing';
import { placeCost } from './ops';
import type { Params } from './params';
import { appendTileEvent } from './records';
import { TF_RIVER, T_ROCK, T_WATER, terrainOf } from './terrain';
import {
  B_DAMAGED,
  B_KIND,
  B_X,
  B_Y,
  CAT_ZONE,
  CELLS,
  MAP,
  MARK_DAMAGED,
  MARK_HERITAGE,
  TILES,
  USE_EMPTY,
  VARIANT_HOTEL,
  decodeCells,
  makeLvl,
  pairGet,
  pairSet,
  planesForWrite,
  planesOf,
  type Planes,
} from './tiles';
import {
  COVERAGES,
  SECTOR_COUNT,
  STAGE_C,
  STAGE_P,
  STAGE_W,
  ZONES,
  ZONE_METER,
  ZONE_SECTOR,
  Z_FARMS,
  Z_HOMES,
  Z_INDUSTRY,
  Z_LEISURE,
  Z_OFFICES,
  Z_SHOPS,
  cohort,
  person,
  type CoverageSlot,
  type DevelopmentSlot,
  type FieldsSlot,
  type MonthContext,
  type TickContext,
  type TownState,
} from './types';

type DevelopParams = Params['develop'];

// ---- Local copies of the layouts the loops use --------------------------------------------

const N_TILES = TILES;
const N_CELLS = CELLS;
const N_MAP = MAP;
const N_SECTORS = SECTOR_COUNT;
const N_ZONES = ZONES.length;
const CAT_Z = CAT_ZONE;
const EMPTY = USE_EMPTY;
const DAMAGED = MARK_DAMAGED;
const HERITAGE = MARK_HERITAGE;
const HOTEL = VARIANT_HOTEL;
const RIVER = TF_RIVER;
const TK_WATER = T_WATER;
const TK_ROCK = T_ROCK;
const ZH = Z_HOMES;
const ZS = Z_SHOPS;
const ZL = Z_LEISURE;
const ZI = Z_INDUSTRY;
const ZO = Z_OFFICES;
const ZF = Z_FARMS;
const ZCAP: readonly (readonly number[])[] = ZONE_DEFS.map((z) => [...z.capacity]);
const ZMIN: readonly number[] = ZONE_DEFS.map((z) => z.minLevel);
const ZTIERCAP: readonly (readonly number[])[] = ZONE_DEFS.map((z) => [...z.tierCap]);
const ZUNLOCK: readonly number[] = ZONE_DEFS.map((z) => z.unlock);
const ZUNTIL: readonly number[] = ZONE_DEFS.map((z) => z.zoneUntil);
const HOTEL_BEDS: readonly number[] = [...(ZONE_DEFS[Z_LEISURE].beds ?? [])];
const ZSECTOR: readonly number[] = [...ZONE_SECTOR];
const ZMETER: readonly number[] = [...ZONE_METER];
const COV_FIRE = COVERAGES.indexOf('fire');
const COV_SCHOOL = COVERAGES.indexOf('school');
const COV_NATURE = COVERAGES.indexOf('nature');
const COV_FUN = COVERAGES.indexOf('fun');
const COV_CULTURE = COVERAGES.indexOf('culture');
const COV_TRANSIT = COVERAGES.indexOf('transit');

// The tile bit layouts of tiles.ts, inlined: use = category << 12 | payload; lvl = level | tier << 3 | style << 5.
const catOf = (u: number) => u >>> 12;
const payloadOf = (u: number) => u & 0xfff;
const levelOf = (l: number) => l & 7;
const tierOf = (l: number) => (l >> 3) & 3;
const styleOf = (l: number) => (l >> 5) & 7;
/** cellOf for the 64-wide map: (y >> 1)·32 + (x >> 1). */
const cellAt = (i: number) => ((i >> 7) << 5) | ((i & 63) >> 1);
const parcelBit = (i: number) => ((i >> 10) << 2) | ((i & 63) >> 4);
const isBuildable = (v: number) => (v & 7) !== TK_WATER && (v & 7) !== TK_ROCK;

const U32 = 4294967296;
/** Salts on the develop stream (a, b = tile, salt), apart from WP2b's re-tiering salt. */
const SALT_GROW = 0;
const SALT_DECLINE = 1;
const SALT_STYLE = 2;
/** A Regional Day is a game year (48 ticks), so "younger than 21 days" counts town ticks. */
const TICKS_PER_DAY = TICKS_PER_YEAR;

// ---- The stored memo (t.dev) ---------------------------------------------------------

const DEV_VERSION = 1;
/** Kinds of the sparse per-tile notes (high nibble of the value). */
const AUX_UPGRADE = 1;
const AUX_DAMAGED = 2;
const auxKind = (v: number) => v >> 4;
const auxValue = (v: number) => v & 15;
const aux = (kind: number, value: number) => (kind << 4) | (value & 15);

/** Month-part tile byte: bit 0 unpowered, bit 1 dry, bits 2–4 months a built tile has missed a road, power or water. */
const TB_UNPOWERED = 1;
const TB_DRY = 2;
const tbMissing = (b: number) => (b >> 2) & 7;
/** Month-part cell byte: bit 7 known, bits 0–4 fire coverage / 5, bit 5 visitor access above the hotel test. */
const CB_KNOWN = 128;
const CB_VISITOR = 32;
const cbFire = (b: number) => (b & 31) * 5;
/** Desirability bytes: L + 128, 0 = not known for this cell (the fallback applies). */
const L_UNKNOWN = 0;
const encL = (L: number) => 128 + Math.max(-100, Math.min(100, Math.round(L)));

/** Homes tiers then sectors: the forced-decline occupancy counters' layout. */
const LOW_HOMES = 0;
const LOW_SECTOR = 3;
const LOW_COUNT = 3 + SECTOR_COUNT;

const M_LOW = 0;
const M_FILLED = M_LOW + LOW_COUNT;
const M_CLOSE = M_FILLED + 4 * SECTOR_COUNT;
const M_TILE = M_CLOSE + SECTOR_COUNT;
const M_CELL = M_TILE + TILES;
const M_L = M_CELL + CELLS;
const MONTH_BYTES = M_L + N_ZONES * CELLS;

interface DevState {
  /** The t.dev string this copy was decoded from or last written to. */
  src: string;
  /** Incidents still allowed this month (§5.2: at most 2% of buildings). */
  incidentsLeft: number;
  /** Winning rolls the Builders cap turned away this month ("Our builders are busy"). */
  turnedAway: number;
  /** Sorted [tile, aux] pairs. */
  aux: number[];
  /** Last month's memo bytes (MONTH_BYTES), or null before the first month step. */
  month: Uint8Array | null;
  /** The month part as stored. */
  monthSrc: string;
}

const DEV_CACHE = new WeakMap<TownState, DevState>();

function decodeTick(s: string, d: DevState): void {
  d.incidentsLeft = 0;
  d.turnedAway = 0;
  d.aux = [];
  if (!s) return;
  let b: Uint8Array;
  try {
    b = fromBase64(s);
  } catch {
    return;
  }
  if (b.length < 5 || b[0] !== DEV_VERSION) return;
  d.incidentsLeft = b[1];
  d.turnedAway = b[2];
  const n = b[3] | (b[4] << 8);
  for (let k = 0; k < n && 7 + 3 * k < b.length; k++) d.aux.push(b[5 + 3 * k] | (b[6 + 3 * k] << 8), b[7 + 3 * k]);
}

function encodeTick(d: DevState): string {
  const n = d.aux.length / 2;
  const b = new Uint8Array(5 + 3 * n);
  b[0] = DEV_VERSION;
  b[1] = Math.min(255, d.incidentsLeft);
  b[2] = Math.min(255, d.turnedAway);
  b[3] = n & 255;
  b[4] = n >>> 8;
  for (let k = 0; k < n; k++) {
    const tile = d.aux[2 * k];
    b[5 + 3 * k] = tile & 255;
    b[6 + 3 * k] = tile >>> 8;
    b[7 + 3 * k] = d.aux[2 * k + 1];
  }
  return toBase64(b);
}

function decodeMonth(s: string): Uint8Array | null {
  if (!s) return null;
  try {
    return rleDecode(fromBase64(s), MONTH_BYTES);
  } catch {
    return null;
  }
}

/** The decoded memo for reading or changing; write it back with writeDev. */
function devOf(t: TownState): DevState {
  const hit = DEV_CACHE.get(t);
  if (hit && hit.src === t.dev) return hit;
  const s = t.dev ?? '';
  const bar = s.indexOf('|');
  const tickPart = bar < 0 ? s : s.slice(0, bar);
  const monthPart = bar < 0 ? '' : s.slice(bar + 1);
  const d: DevState = { src: s, incidentsLeft: 0, turnedAway: 0, aux: [], month: null, monthSrc: '' };
  decodeTick(tickPart, d);
  if (hit && hit.monthSrc === monthPart && hit.month) {
    d.month = hit.month;
    d.monthSrc = monthPart;
  } else {
    d.month = decodeMonth(monthPart);
    d.monthSrc = d.month ? monthPart : '';
  }
  DEV_CACHE.set(t, d);
  return d;
}

/** Drops the decoded memo (after a revert replaced t.dev: a copy changed in place must not survive it). */
export function forgetDev(t: TownState): void {
  DEV_CACHE.delete(t);
}

function writeDev(t: TownState, d: DevState): void {
  const s = encodeTick(d) + '|' + d.monthSrc;
  d.src = s;
  t.dev = s;
}

// ---- The A24 stride --------------------------------------------------------------------

/** perm(i) = (i·mul + seed) mod 4096 (A24); mul is odd, so it is a bijection. Exact via the low 32 bits. */
export function stridePerm(i: number, seed: number, mul: number): number {
  return (Math.imul(i, mul | 0) + (seed | 0)) & (N_TILES - 1);
}

const ORDER_CACHE: { seed: number; mul: number; order: Int16Array }[] = [];

/** Tile indices in increasing perm(i): a tick visits order[q] for q ≡ tick (mod 4). */
export function strideOrder(seed: number, mul: number): Int16Array {
  for (const e of ORDER_CACHE) if (e.seed === seed && e.mul === mul) return e.order;
  const order = new Int16Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) order[stridePerm(i, seed, mul)] = i;
  ORDER_CACHE.push({ seed, mul, order });
  if (ORDER_CACHE.length > 16) ORDER_CACHE.shift();
  return order;
}

/** Is tile i visited on tick `tick`? (Every tile is, during the Founding Fortnight.) */
export function visitedOn(i: number, tick: number, seed: number, mul: number, sprint = false): boolean {
  return sprint || (stridePerm(i, seed, mul) & 3) === (tick & 3);
}

// ---- The §5.2 chances ---------------------------------------------------------------------

/** p_grow = 0.30·σ((z − 10)/15): ≈10% at z = 0, 29% at +60, 1% at −40. */
export function growChance(z: number, p: DevelopParams): number {
  return p.pGrow * sigma((z - p.zMid) / p.zScale);
}

/** p_levelup = 0.25·σ((z − 10)/15). */
export function levelUpChance(z: number, p: DevelopParams): number {
  return p.pLevel * sigma((z - p.zMid) / p.zScale);
}

/** p_decline = 0.10·σ((−z − 40)/12): ≈0.35% at z = 0 (gentle churn), 5% at −40. */
export function declineChance(z: number, p: DevelopParams): number {
  return p.pDecline * sigma((-z - p.declineMid) / p.declineScale);
}

/** Construction starts allowed this tick: Builders/4 with Builders = 6 + Pop/250 a month (before the carry). */
export function buildersPerTick(pop: number, p: DevelopParams): number {
  return (p.buildersBase + pop / p.buildersPer) / 4;
}

// ---- Desirability L_k(x) (§5.2) -------------------------------------------------------------

/** The field values one cell offers (all 0–100 except land value, 1–250). */
export interface Place {
  lv: number;
  poll: number;
  noise: number;
  safety: number;
  crime: number;
  school: number;
  nature: number;
  cust: number;
  visitor: number;
  freight: number;
  fun: number;
  culture: number;
  transit: number;
}

/**
 * What a cell looks like before any month step has measured it (a founding
 * town's first ticks, or a cell zoned since the last month): its stored land
 * value and pollution, and the values of a quiet new place for the rest (a
 * little crime, no services yet, middling access).
 */
export function fallbackPlace(lv: number, poll: number): Place {
  return { lv, poll, noise: 0, safety: 75, crime: 25, school: 0, nature: 20, cust: 50, visitor: 0, freight: 50, fun: 0, culture: 0, transit: 0 };
}

/** L_k(x) for the five field-driven zones, clamped to −100..+100 (Farms: farmDesirability). */
export function desirability(zone: number, x: Place, p: DevelopParams): number {
  let L = 0;
  if (zone === ZH) {
    const [a, b, c, d, e, f, g, h, i, j] = p.lHomes;
    L = a * (x.lv - b) + c * (x.safety - d) + e * ((x.school + x.nature) / 2 - f) - g * Math.max(0, x.poll - h) - i * Math.max(0, x.noise - j);
  } else if (zone === ZS) {
    const [a, b, c, d, e, f] = p.lShops;
    L = a * (x.cust - b) + c * (x.lv - d) - e * Math.max(0, x.crime - f);
  } else if (zone === ZL) {
    const [a, b, c, d, e, f, g, h] = p.lLeisure;
    L = a * (x.visitor - b) + c * (x.lv - d) + e * (x.fun + x.culture - f) - g * Math.max(0, x.crime - h);
  } else if (zone === ZI) {
    const [a, b, c, d] = p.lIndustry;
    L = a * (x.freight - b) + c * (d - x.lv);
  } else if (zone === ZO) {
    const [a, b, c, d, e, f] = p.lOffices;
    L = a * (x.lv - b) + c * (x.transit - d) + e * (x.culture - f);
  }
  return L < -100 ? -100 : L > 100 ? 100 : L;
}

/** Farms: +40 at Hamlet and Village, 0 from Town; +15 on Flatland or river soil. */
export function farmDesirability(t: TownState, terrainByte: number, p: DevelopParams): number {
  const L = (t.tier < 2 ? p.farmL[0] : p.farmL[1]) + (t.siteKind === 'flatland' || (terrainByte & RIVER) !== 0 ? p.farmSoil : 0);
  return L < -100 ? -100 : L > 100 ? 100 : L;
}

/** A cell's measured Place from the month's fields (M14b). */
function placeFrom(cell: number, lv: Uint8Array, f: FieldsSlot, cov: CoverageSlot): Place {
  const c = (k: number) => cov.cov[k]?.[cell] ?? 0;
  const crime = f.crime[cell];
  return {
    lv: lv[cell],
    poll: f.pollution[cell],
    noise: f.noise[cell],
    safety: 100 - crime,
    crime,
    school: c(COV_SCHOOL),
    nature: c(COV_NATURE),
    cust: f.custAccess[cell],
    visitor: f.visitorAccess[cell],
    freight: f.freight[cell],
    fun: c(COV_FUN),
    culture: c(COV_CULTURE),
    transit: c(COV_TRANSIT),
  };
}

// ---- Level caps (§3.3) -------------------------------------------------------------------------

/** The highest level land value `lv` allows (L1 always; L2 at 35, L3 70, L4 115, L5 165). */
export function lvLevel(lv: number, p: DevelopParams): number {
  const req = p.lvReq;
  let l = 1;
  for (let k = 1; k < req.length; k++) if (lv >= req[k]) l = k + 1;
  return l;
}

/** A tile's maximum level: min(tier cap, LV-allowed level), and no L4+ on a River site's flood plain. */
export function levelCap(t: TownState, zone: number, lv: number, terrainByte: number, p: DevelopParams): number {
  let cap = Math.min(ZTIERCAP[zone][t.tier] ?? 0, lvLevel(lv, p));
  if (cap > 3 && t.siteKind === 'river' && (terrainByte & RIVER) !== 0) cap = 3;
  return cap;
}

/** The Homes tiers land at `value` (LV − 0.5·Pollution) may take: £ always, ££ from 60, £££ from 130. */
function homesTierMax(value: number, p: DevelopParams): number {
  return value >= p.homesTierLv[1] ? 2 : value >= p.homesTierLv[0] ? 1 : 0;
}

// ---- Tile facts shared by the steps -------------------------------------------------------------

interface Facts {
  pl: Planes;
  busy: Uint8Array;
  marks: Uint8Array;
  /** Per tile: the AUX value (0 none). */
  aux: Uint8Array;
  lv: Uint8Array;
  poll: Uint8Array;
  terrain: Uint8Array;
}

function sparseMask(list: readonly number[], positiveOnly: boolean): Uint8Array {
  const out = new Uint8Array(N_TILES);
  for (let i = 0; i + 1 < list.length; i += 2) {
    const v = list[i + 1];
    if (positiveOnly ? v > 0 : v !== 0) out[list[i]] = v > 255 ? 255 : v;
  }
  return out;
}

function cellsOrZero(s: string): Uint8Array {
  if (!s) return new Uint8Array(N_CELLS);
  try {
    return decodeCells(s);
  } catch {
    return new Uint8Array(N_CELLS);
  }
}

function factsOf(t: TownState, d: DevState): Facts {
  return {
    pl: planesOf(t),
    busy: sparseMask(t.construction, true),
    marks: sparseMask(t.marks, false),
    aux: sparseMask(d.aux, false),
    lv: cellsOrZero(t.lv),
    poll: cellsOrZero(t.lag.poll),
    terrain: terrainOf(t),
  };
}

/** The level a busy tile is upgrading from (0: it is growing from an empty lot). */
function upgradeFrom(f: Facts, i: number): number {
  const a = f.aux[i];
  return a && auxKind(a) === AUX_UPGRADE ? auxValue(a) : 0;
}

/**
 * 1 where a road (not rail) lies within `reach` tiles (Chebyshev), the rule
 * of §3.4; the same mask as tiles.ts roadAccess, by two separable passes so
 * it costs little to rebuild every tick.
 */
function roadMask(use: Uint16Array, reach: number): Uint8Array {
  const row = new Uint8Array(N_TILES);
  for (let y = 0; y < N_MAP; y++) {
    const o = y * N_MAP;
    let last = -1000;
    for (let x = 0; x < N_MAP; x++) {
      if (use[o + x] >>> 12 === 1) last = x;
      if (x - last <= reach) row[o + x] = 1;
    }
    last = 1000;
    for (let x = N_MAP - 1; x >= 0; x--) {
      if (use[o + x] >>> 12 === 1) last = x;
      if (last - x <= reach) row[o + x] = 1;
    }
  }
  const out = new Uint8Array(N_TILES);
  for (let x = 0; x < N_MAP; x++) {
    let last = -1000;
    for (let y = 0; y < N_MAP; y++) {
      if (row[y * N_MAP + x]) last = y;
      if (y - last <= reach) out[y * N_MAP + x] = 1;
    }
    last = 1000;
    for (let y = N_MAP - 1; y >= 0; y--) {
      if (row[y * N_MAP + x]) last = y;
      if (last - y <= reach) out[y * N_MAP + x] = 1;
    }
  }
  return out;
}

// ---- Supply (M1b) -----------------------------------------------------------------------------

/** Jobs per tile by [zone][level] → [£, ££, £££], for one L2 entry mix (A2). */
interface JobTable {
  l2: readonly number[];
  jobs: number[][][];
}
let JOB_TABLE: JobTable | null = null;

function jobTable(l2: readonly number[]): number[][][] {
  if (JOB_TABLE && JOB_TABLE.l2 === l2) return JOB_TABLE.jobs;
  const jobs: number[][][] = [];
  for (let z = 0; z < N_ZONES; z++) {
    const byLevel: number[][] = [[0, 0, 0]];
    for (let level = 1; level <= 5; level++) {
      const size = ZCAP[z][level - 1] ?? 0;
      const mix = z === ZH ? [0, 0, 0] : tileMix(ZSECTOR[z], level, l2);
      byLevel.push([size * mix[0], size * mix[1], size * mix[2]]);
    }
    jobs.push(byLevel);
  }
  JOB_TABLE = { l2, jobs };
  return jobs;
}

/**
 * Counts homes, jobs and beds from the tiles into `s`. An open tile counts
 * whole; a tile under construction counts its old level as open and the
 * increment as pipeline (from nothing for a new build); a tile closed by an
 * incident counts as pipeline until it is repaired.
 */
function countSupply(f: Facts, p: Params, s: DevelopmentSlot): void {
  const J = jobTable(p.labour.entryMixL2);
  const { use, lvl } = f.pl;
  const busy = f.busy;
  const marks = f.marks;
  const cap = s.cap;
  const pipe = s.pipeline;
  const jobs = s.jobs;
  const pj = s.pipeJobs;
  for (let i = 0; i < N_TILES; i++) {
    const u = use[i];
    if (catOf(u) !== CAT_Z) continue;
    const z = payloadOf(u);
    if (z >= N_ZONES) continue;
    s.zoned[z] += 1;
    const l = lvl[i];
    const level = levelOf(l);
    if (level === 0) continue;
    const bits = tierOf(l);
    let from = level;
    let open = true;
    if (busy[i]) {
      // Scaffolding: a new build is not a built tile yet; an upgrade still is.
      from = upgradeFrom(f, i);
      if (from >= level) from = level - 1;
      open = false;
      if (from > 0) s.built[z] += 1;
    } else {
      // A closed tile is built but shut: all of it is pipeline until it reopens.
      if (marks[i] & DAMAGED) {
        from = 0;
        open = false;
      }
      s.built[z] += 1;
    }
    if (z === ZH) {
      const h = bits > 2 ? 2 : bits;
      const size = ZCAP[ZH][level - 1] ?? 0;
      const base = from > 0 ? (ZCAP[ZH][from - 1] ?? 0) : 0;
      cap[h] += open ? size : base;
      if (!open && size > base) pipe[h] += size - base;
      continue;
    }
    const sector = ZSECTOR[z];
    const now = J[z][level];
    const old = J[z][from > 0 ? from : 0];
    for (let h = 0; h < 3; h++) {
      if (open) jobs[sector * 3 + h] += now[h];
      else {
        jobs[sector * 3 + h] += old[h];
        if (now[h] > old[h]) pj[sector * 3 + h] += now[h] - old[h];
      }
    }
    if (z === ZL && bits === HOTEL && open) s.beds += HOTEL_BEDS[level - 1] ?? 0;
  }
}

/** Hotel beds built and under way (the Leisure variant test compares bed demand with both). */
function bedsIncludingPipeline(f: Facts): number {
  const { use, lvl } = f.pl;
  let n = 0;
  for (let i = 0; i < N_TILES; i++) {
    const u = use[i];
    if (catOf(u) !== CAT_Z || payloadOf(u) !== ZL) continue;
    const level = levelOf(lvl[i]);
    if (level > 0 && tierOf(lvl[i]) === HOTEL) n += HOTEL_BEDS[level - 1] ?? 0;
  }
  return n;
}

/**
 * The supply count from the tiles (§5.8 capacity, A2's skill mix): open
 * homes and jobs, the pipeline (scaffolding, and closed tiles waiting for
 * repair), hotel beds, zoned and built tiles per zone, and A9's reachability.
 */
export function supplyOf(t: TownState, p: Params): DevelopmentSlot {
  const s = neutral.development();
  const f = factsOf(t, devOf(t));
  countSupply(f, p, s);
  // Farmers' Market's catch (§6.7): farm jobs −10%, open and in the pipeline.
  if (t.policies.some((a) => a.card === 'farmersMarket')) {
    const k = ZSECTOR[ZF] * 3;
    for (let h = 0; h < 3; h++) {
      s.jobs[k + h] = Math.floor(s.jobs[k + h] * p.firms.farmersMarketFarmJobs);
      s.pipeJobs[k + h] = Math.floor(s.pipeJobs[k + h] * p.firms.farmersMarketFarmJobs);
    }
  }
  reachability(t, f, p.develop, s);
  return s;
}

/**
 * A9: could any open land take Homes tier h, or zone k? Homes £ always can.
 * ££ and £££ need a free or Homes tile whose LV − 0.5·Pollution reaches the
 * tier's band; a zone needs to be unlocked (and still zonable, or already
 * zoned), and a tile that is free or of that zone below its level cap whose
 * land value allows the zone's first level. Free means empty, or an empty
 * zoned lot that could be repainted.
 */
function reachability(t: TownState, f: Facts, p: DevelopParams, s: DevelopmentSlot): void {
  const homes = [true, false, false];
  const zone = new Array<boolean>(N_ZONES).fill(false);
  // Zones this tier can grow at all, and which of them it may still paint on free land.
  const live: boolean[] = [];
  const paint: boolean[] = [];
  for (let k = 0; k < N_ZONES; k++) {
    live.push((ZTIERCAP[k][t.tier] ?? 0) >= ZMIN[k]);
    paint.push(t.tier >= ZUNLOCK[k] && t.tier <= ZUNTIL[k]);
  }
  let left = 2;
  for (let k = 0; k < N_ZONES; k++) if (live[k]) left++;
  const { use, lvl } = f.pl;
  const parcels = t.parcels;
  for (let i = 0; i < N_TILES && left > 0; i++) {
    const u = use[i];
    const isZone = catOf(u) === CAT_Z;
    const z = isZone ? payloadOf(u) : -1;
    const level = isZone ? levelOf(lvl[i]) : 0;
    const free = (u === EMPTY || (isZone && level === 0 && !f.busy[i])) && ((parcels >> parcelBit(i)) & 1) === 1 && isBuildable(f.terrain[i]);
    if (!free && !isZone) continue;
    const c = cellAt(i);
    const lv = f.lv[c];
    // A9: a tile "could take" a Homes tier when it is free land in the tier's land-value band, or a
    // built home there that can still level up. A home already at its level cap adds nothing, just
    // as a built shop at its cap does not make Shops reachable below: a town whose every ££-band
    // home is built out reads the hatched +35, not a ££ meter pinned at +100 it cannot act on.
    const roomToGrow = free || (z === ZH && levelCap(t, ZH, lv, f.terrain[i], p) > level);
    if (roomToGrow) {
      const tm = homesTierMax(lv - 0.5 * f.poll[c], p);
      if (tm >= 1 && !homes[1]) {
        homes[1] = true;
        left--;
      }
      if (tm >= 2 && !homes[2]) {
        homes[2] = true;
        left--;
      }
    }
    for (let k = 0; k < N_ZONES; k++) {
      if (zone[k] || !live[k]) continue;
      if (free ? !paint[k] : z !== k) continue;
      const cap = levelCap(t, k, lv, f.terrain[i], p);
      if (free ? cap >= ZMIN[k] : cap > Math.max(level, ZMIN[k] - 1)) {
        zone[k] = true;
        left--;
      }
    }
  }
  s.reachableHomes = homes;
  s.reachableZone = zone;
}

/** STEP M1b (WP2e): supply from tiles → derived.development. */
export function stepSupply(t: TownState, m: MonthContext): void {
  m.derived.development = supplyOf(t, m.params);
}

// ---- The memo (M14b) ---------------------------------------------------------------------------

/**
 * STEP M14b (WP2e): keeps what the next four ticks need from this month's
 * fields and people (the module comment says why), and reports the month's
 * founders' carts to the Why. Writes no slot.
 */
export function stepDevelopMemo(t: TownState, m: MonthContext): void {
  const p = m.params.develop;
  const d = devOf(t);
  const f = factsOf(t, d);
  const prev = d.month;
  const out = new Uint8Array(MONTH_BYTES);
  const fields = m.derived.fields ?? neutral.fields(t);
  const cov = m.derived.coverage ?? neutral.coverage(t);
  const util = m.derived.utilities;
  const hs = m.derived.housing;
  const lab = m.derived.labour;

  // Months of low occupancy, by Homes tier and by sector (§5.2 forced decline), and each sector's workers.
  const bump = (k: number, low: boolean) => (out[M_LOW + k] = low ? Math.min(255, (prev ? prev[M_LOW + k] : 0) + 1) : 0);
  for (let h = 0; h < 3; h++) bump(LOW_HOMES + h, !!hs && hs.cap[h] > 0 && hs.occ[h] / hs.cap[h] < p.forcedDeclineOccupancy);
  for (let s = 0; s < N_SECTORS; s++) {
    bump(LOW_SECTOR + s, !!lab && lab.sectorJobs[s] > 0 && lab.fillRate[s] < p.forcedDeclineOccupancy);
    const filled = Math.max(0, Math.min(0xffffffff, Math.round(lab?.sectorFilled[s] ?? 0)));
    out[M_FILLED + 4 * s] = filled & 255;
    out[M_FILLED + 4 * s + 1] = (filled >>> 8) & 255;
    out[M_FILLED + 4 * s + 2] = (filled >>> 16) & 255;
    out[M_FILLED + 4 * s + 3] = (filled >>> 24) & 255;
  }

  // Per tile: power, water and the months a built tile has gone without a road, power or water.
  const { use, lvl } = f.pl;
  const road = roadMask(use, p.roadReach);
  const zoneInCell = new Uint8Array(N_CELLS);
  for (let i = 0; i < N_TILES; i++) {
    const u = use[i];
    if (catOf(u) !== CAT_Z) continue;
    const z = payloadOf(u);
    if (z >= N_ZONES) continue;
    zoneInCell[cellAt(i)] |= 1 << z;
    const unpowered = util ? !util.powered[i] : false;
    const dry = util ? !util.watered[i] : false;
    let b = (unpowered ? TB_UNPOWERED : 0) | (dry ? TB_DRY : 0);
    const level = levelOf(lvl[i]);
    if (level > 0 && !f.busy[i]) {
      const missing = !road[i] || (level >= 2 && (unpowered || dry));
      const before = prev ? tbMissing(prev[M_TILE + i]) : 0;
      if (missing) b |= Math.min(7, before + 1) << 2;
    }
    out[M_TILE + i] = b;
  }

  // Per cell: fire coverage, the hotel test, and L for each zone the cell holds.
  const lv = f.lv;
  const fire = cov.cov[COV_FIRE];
  for (let c = 0; c < N_CELLS; c++) {
    const vis = fields.visitorAccess[c] > p.hotelVisitorAccess;
    out[M_CELL + c] = CB_KNOWN | Math.max(0, Math.min(20, Math.round((fire?.[c] ?? 0) / 5))) | (vis ? CB_VISITOR : 0);
    const zs = zoneInCell[c];
    if (!zs) continue;
    const place = placeFrom(c, lv, fields, cov);
    for (let z = 0; z < N_ZONES; z++) if (zs & (1 << z) && z !== ZF) out[M_L + z * N_CELLS + c] = encL(desirability(z, place, p));
  }

  // A closing sector (§5.12) loses its worst-located tiles first: keep each sector's low-quantile L.
  const sectorL: number[][] = [];
  for (let s = 0; s < N_SECTORS; s++) sectorL.push([]);
  for (let i = 0; i < N_TILES; i++) {
    const u = use[i];
    if (catOf(u) !== CAT_Z) continue;
    const z = payloadOf(u);
    if (z === ZH || z >= N_ZONES || levelOf(lvl[i]) === 0 || f.busy[i]) continue;
    const L = z === ZF ? farmDesirability(t, f.terrain[i], p) : out[M_L + z * N_CELLS + cellAt(i)] - 128;
    sectorL[ZSECTOR[z]].push(L);
  }
  for (let s = 0; s < N_SECTORS; s++) {
    const xs = sectorL[s];
    if (xs.length === 0) continue;
    xs.sort((a, b) => a - b);
    out[M_CLOSE + s] = encL(xs[Math.min(xs.length - 1, Math.floor(xs.length * p.closeQuantile))]);
  }

  d.month = out;
  d.monthSrc = toBase64(rleEncode(out));
  writeDev(t, d);

  const carts = t.books.pop[flowIndex('carts')];
  if (carts) m.why.add('pop.carts', carts, 'pop');
}

// ---- The tick (§5.2 steps 2–4) --------------------------------------------------------------------

interface Candidate {
  tile: number;
  score: number;
  rank: number;
  level: number;
  lvl: number;
  from: number;
}

/** Live occupancy of each Homes tier and sector, from stored people and last month's workers. */
class Occupancy {
  private readonly homesCap: number[];
  private readonly jobs: number[];
  private occ: number[] | null = null;
  private constructor(
    private readonly t: TownState,
    private readonly filled: number[] | null,
    s: DevelopmentSlot,
  ) {
    this.homesCap = [...s.cap];
    this.jobs = new Array<number>(N_SECTORS).fill(0);
    for (let k = 0; k < N_SECTORS; k++) for (let h = 0; h < 3; h++) this.jobs[k] += s.jobs[k * 3 + h];
  }
  static of(t: TownState, f: Facts, p: Params, month: Uint8Array | null): Occupancy {
    let filled: number[] | null = null;
    if (month) {
      filled = [];
      for (let s = 0; s < N_SECTORS; s++) {
        const o = M_FILLED + 4 * s;
        filled.push(month[o] + month[o + 1] * 256 + month[o + 2] * 65536 + month[o + 3] * 16777216);
      }
    }
    const s = neutral.development();
    countSupply(f, p, s);
    return new Occupancy(t, filled, s);
  }
  /** Homes tier h's occupancy (1 with no homes of that tier). */
  homes(h: number): number {
    if (this.homesCap[h] <= 0) return 1;
    if (!this.occ) this.occ = allocate(cohortPersons(this.t.people), this.homesCap).occ;
    return this.occ[h] / this.homesCap[h];
  }
  /** Sector s's job fill (1 before any month has counted workers). */
  sector(s: number): number {
    if (!this.filled || this.jobs[s] <= 0) return 1;
    return Math.min(1, this.filled[s] / this.jobs[s]);
  }
  /** Vacant £ homes: how many founders' carts can be housed without squeezing anyone. */
  vacantModest(): number {
    return allocate(cohortPersons(this.t.people), this.homesCap).vacant[0];
  }
  /** A tile declined from `level` to `to`: later tiles this tick see the smaller supply. */
  declined(zone: number, level: number, tierBits: number, to: number): void {
    const lost = (ZCAP[zone][level - 1] ?? 0) - (to > 0 ? (ZCAP[zone][to - 1] ?? 0) : 0);
    if (zone === ZH) {
      const h = tierBits > 2 ? 2 : tierBits;
      this.homesCap[h] = Math.max(0, this.homesCap[h] - lost);
      this.occ = null;
    } else this.jobs[ZSECTOR[zone]] = Math.max(0, this.jobs[ZSECTOR[zone]] - lost);
  }
  peopleChanged(): void {
    this.occ = null;
  }
}

function orderOn(t: TownState, kind: string): boolean {
  for (const o of t.orders) if (o.kind === kind) return o.on;
  return true;
}

function policyActive(t: TownState, card: string): boolean {
  for (const a of t.policies) if (a.card === card) return true;
  return false;
}

/** A34: while an Away town's loss cap binds, decline rolls pause (§2.4). */
function awayCapBinds(t: TownState, ctx: TickContext): boolean {
  if (ctx.at - t.away.lastHelloAt < ctx.params.clock.awayAfterMs || t.away.weekStartPop <= 0) return false;
  return population(t) <= Math.ceil(t.away.weekStartPop * (1 - ctx.params.migration.awayLossCap));
}

/** Clears MARK_DAMAGED from a tile's marks (keeping any painted-area bits). */
function clearDamaged(t: TownState, tile: number): void {
  const bits = pairGet(t.marks, tile);
  if (bits & DAMAGED) pairSet(t.marks, tile, bits & ~DAMAGED);
}

/**
 * Step 1's other half: closed tiles and buildings count down and the Deputy
 * repairs them (§5.2 step 3, the "fix damaged buildings" order); notes that
 * no longer fit their tile (it was bulldozed, or its build finished) go.
 */
function repairs(t: TownState, ctx: TickContext, d: DevState): void {
  const fix = orderOn(t, 'fixDamaged');
  const { use, lvl } = planesOf(t);
  const busy = sparseMask(t.construction, true);
  const list = d.aux;
  let w = 0;
  for (let k = 0; k + 1 < list.length; k += 2) {
    const tile = list[k];
    const v = list[k + 1];
    const built = catOf(use[tile]) === CAT_Z && levelOf(lvl[tile]) > 0;
    let keep = v;
    if (auxKind(v) === AUX_UPGRADE) {
      if (!built || !busy[tile]) keep = 0;
    } else if (auxKind(v) === AUX_DAMAGED && built) {
      const left = auxValue(v);
      if (left > 1) keep = aux(AUX_DAMAGED, left - 1);
      else if (fix) {
        // A private building's repair is its owner's (insured): free to the town.
        keep = 0;
        clearDamaged(t, tile);
        appendTileEvent(t, ctx.tick, tile, 'repaired', payloadOf(use[tile]));
      }
    } else {
      keep = 0;
      clearDamaged(t, tile);
    }
    if (keep) {
      list[w++] = tile;
      list[w++] = keep;
    }
  }
  list.length = w;
  // A damaged mark with no note behind it (the tile was rebuilt by a move) is cleared too.
  let stale: number[] | null = null;
  let notes: Uint8Array | null = null;
  for (let k = 0; k + 1 < t.marks.length; k += 2) {
    if (!(t.marks[k + 1] & DAMAGED)) continue;
    notes ??= sparseMask(list, false);
    if (auxKind(notes[t.marks[k]]) !== AUX_DAMAGED) (stale ??= []).push(t.marks[k]);
  }
  if (stale) for (const tile of stale) clearDamaged(t, tile);

  // Civic buildings: B_DAMAGED is the ticks left closed; the repair costs 5% of the building unless fire cover there is above 50.
  const month = d.month;
  for (const b of t.buildings) {
    const left = b[B_DAMAGED];
    if (!(left > 0)) continue;
    if (left > 1) {
      b[B_DAMAGED] = left - 1;
      continue;
    }
    if (!fix) continue;
    b[B_DAMAGED] = 0;
    const tile = b[B_Y] * N_MAP + b[B_X];
    const cover = month ? cbFire(month[M_CELL + cellAt(tile)]) : 0;
    if (cover <= ctx.params.develop.repairFreeFireCov) {
      const cost = Math.round(placeCost(t, b[B_KIND], ctx.params) * ctx.params.develop.repairShare);
      if (cost > 0) postWhole(t, 'repairs', -cost);
    }
    appendTileEvent(t, ctx.tick, tile, 'repaired', 255);
  }
}

/** Ages every built zoned tile by a month at each month's first tick (age caps at 255, §3.2). */
function ageTiles(t: TownState, busy: Uint8Array): void {
  const read = planesOf(t);
  let any = false;
  for (let i = 0; i < N_TILES && !any; i++) any = catOf(read.use[i]) === CAT_Z && levelOf(read.lvl[i]) > 0 && !busy[i] && read.age[i] < 255;
  if (!any) return;
  const { use, lvl, age } = planesForWrite(t);
  for (let i = 0; i < N_TILES; i++) if (catOf(use[i]) === CAT_Z && levelOf(lvl[i]) > 0 && !busy[i] && age[i] < 255) age[i] += 1;
}

/** The "buildings" the 2% incident cap is a share of: built zoned tiles and finished civic buildings. */
function buildingCount(t: TownState, f: Facts): number {
  const { use, lvl } = f.pl;
  let n = 0;
  for (let i = 0; i < N_TILES; i++) if (catOf(use[i]) === CAT_Z && levelOf(lvl[i]) > 0 && !f.busy[i]) n++;
  for (const b of t.buildings) if (!f.busy[b[B_Y] * N_MAP + b[B_X]]) n++;
  return n;
}

/** One level down; below a zone's first level (Offices start at L3) the lot is empty again ("For Sale"). */
function declineTo(zone: number, level: number): number {
  const to = level - 1;
  return to < ZMIN[zone] ? 0 : to;
}

/**
 * STEP (tick, WP2e): §5.2 steps 2–4 (and the repair half of step 1), with
 * the Founding Fortnight's every-tile scan (§2.3) on sprint ticks.
 */
export function stepDevelop(t: TownState, ctx: TickContext): void {
  const P = ctx.params;
  const p = P.develop;
  const d = devOf(t);
  repairs(t, ctx, d);
  const monthStart = (t.tick & 3) === 0;
  if (monthStart) {
    ageTiles(t, sparseMask(t.construction, true));
    d.turnedAway = 0;
  }
  const f = factsOf(t, d);
  const mishaps = ctx.mishaps === 'mild' && !ctx.sprint;
  if (monthStart) d.incidentsLeft = mishaps ? Math.max(0, flow(t, 'dev.incidents', p.incidentCap * buildingCount(t, f))) : 0;
  const month = d.month;
  const occ = Occupancy.of(t, f, P, month);
  const { use, lvl, age } = f.pl;
  const road = roadMask(use, p.roadReach);
  const order = strideOrder(t.seed, p.strideMul);
  const step = ctx.sprint ? 1 : 4;
  const holdDeclines = awayCapBinds(t, ctx);
  const marketLow = t.marketMemo?.lowMonths;
  const meters = t.meters;
  const busy = f.busy;
  const marks = f.marks;
  const lvCells = f.lv;
  const pollCells = f.poll;
  const terrain = f.terrain;
  const bedDemand = t.marketMemo?.bedDemand ?? 0;

  const desirabilityAt = (z: number, i: number, c: number): number => {
    if (z === ZF) return farmDesirability(t, terrain[i], p);
    const b = month ? month[M_L + z * N_CELLS + c] : L_UNKNOWN;
    return b === L_UNKNOWN ? desirability(z, fallbackPlace(lvCells[c], pollCells[c]), p) : b - 128;
  };

  const candidates: Candidate[] = [];
  const declines: number[] = [];
  const visitedBuilt: number[] = [];
  let beds = -1;
  for (let q = ctx.sprint ? 0 : t.tick & 3; q < N_TILES; q += step) {
    const i = order[q];
    const u = use[i];
    if (catOf(u) !== CAT_Z) continue;
    const z = payloadOf(u);
    if (z >= N_ZONES || busy[i] || marks[i] & DAMAGED) continue;
    const l = lvl[i];
    const level = levelOf(l);
    const bits = tierOf(l);
    const c = cellAt(i);
    const tb = month ? month[M_TILE + i] : 0;

    if (!road[i]) {
      // "Needs a road": a built tile declines one level with p 0.25; an empty lot waits.
      if (level > 0 && !holdDeclines && ctx.rng('develop', i, SALT_DECLINE) / U32 < p.noRoadDecline) {
        declines.push(i, declineTo(z, level));
        occ.declined(z, level, bits, declineTo(z, level));
      }
      continue;
    }

    const sector = ZSECTOR[z];
    const h = bits > 2 ? 2 : bits;
    if (level > 0) {
      visitedBuilt.push(i);
      // Forced decline: homes or jobs long under-filled, a missing road, power or water, or a closing sector's worst tiles.
      if (!holdDeclines && month) {
        const occNow = z === ZH ? occ.homes(h) : occ.sector(sector);
        const lowLong = month[M_LOW + (z === ZH ? LOW_HOMES + h : LOW_SECTOR + sector)] >= p.forcedDeclineMonths && occNow < p.forcedDeclineOccupancy;
        const missing = tbMissing(tb) >= p.missingServiceMonths;
        const closing =
          z !== ZH && !!marketLow && (marketLow[sector] ?? 0) >= p.closeMonths && month[M_CLOSE + sector] !== L_UNKNOWN && desirabilityAt(z, i, c) <= month[M_CLOSE + sector] - 128;
        if (lowLong || missing || closing) {
          declines.push(i, declineTo(z, level));
          occ.declined(z, level, bits, declineTo(z, level));
          continue;
        }
      }
    }

    // The growth score z = D + L − penalties (§5.2).
    const L = desirabilityAt(z, i, c);
    const poll = pollCells[c];
    let tierBits = bits;
    let D: number;
    if (z === ZH) {
      if (level === 0) {
        // Homes tier at growth: the eligible tier with the highest D_H + L_H (L_H is the same for every tier).
        const tm = homesTierMax(lvCells[c] - 0.5 * poll, p);
        tierBits = 0;
        for (let k = 1; k <= tm; k++) if (meters[k] > meters[tierBits]) tierBits = k;
      }
      D = meters[tierBits > 2 ? 2 : tierBits];
    } else D = meters[ZMETER[z]];
    const target = level === 0 ? ZMIN[z] : level + 1;
    // Hamlet L1 tiles need neither; anything at or growing to L2 and above needs power and water (§3.5).
    // The growth score judges the level the tile would grow into (an L1 cottage cannot level up to
    // L2 on a dark, dry road and then fall back three months later); the decline score judges the
    // level it stands at, so an L1 cottage never declines for want of power.
    const missing = (tb & TB_UNPOWERED ? p.unpoweredPenalty : 0) + (tb & TB_DRY ? p.dryPenalty : 0);
    const score = D + L - (target >= 2 ? missing : 0);
    const stayScore = D + L - (level >= 2 ? missing : 0);
    const cap = levelCap(t, z, lvCells[c], terrain[i], p);
    const homesBlocked = z === ZH && poll > p.homesPollutionBlock;

    if (level === 0) {
      if (target > cap || homesBlocked || (ZCAP[z][target - 1] ?? 0) <= 0) continue;
      if (ctx.rng('develop', i, SALT_GROW) / U32 >= growChance(score, p)) continue;
      if (z === ZL) {
        // A Leisure tile grows as a hotel where visitors can reach it and bed demand exceeds the beds (built and coming).
        if (beds < 0) beds = bedsIncludingPipeline(f);
        const vis = month ? (month[M_CELL + c] & CB_VISITOR) !== 0 : false;
        tierBits = vis && bedDemand > beds ? HOTEL : 0;
        if (tierBits === HOTEL) beds += HOTEL_BEDS[target - 1] ?? 0;
      }
      const style = ctx.rng('develop', i, SALT_STYLE) & 7;
      candidates.push({ tile: i, score, rank: ctx.rng('rank', i, 0), level: target, lvl: makeLvl(target, tierBits, style), from: 0 });
      continue;
    }

    // A built tile: level up (land value, cap, occupancy ≥ 90%, age ≥ 6 months), or perhaps decline.
    const occNow = z === ZH ? occ.homes(h) : occ.sector(sector);
    const canLevel =
      target <= cap && !homesBlocked && !(marks[i] & HERITAGE) && occNow >= p.levelUpOccupancy && age[i] >= p.levelUpAgeMonths && (ZCAP[z][target - 1] ?? 0) > 0;
    if (canLevel && ctx.rng('develop', i, SALT_GROW) / U32 < levelUpChance(score, p)) {
      candidates.push({ tile: i, score, rank: ctx.rng('rank', i, 0), level: target, lvl: makeLvl(target, bits, styleOf(l)), from: level });
      continue;
    }
    if (!holdDeclines && ctx.rng('develop', i, SALT_DECLINE) / U32 < declineChance(stayScore, p)) {
      declines.push(i, declineTo(z, level));
      occ.declined(z, level, bits, declineTo(z, level));
    }
  }

  // Declines are one level and never capped; nothing is removed but the level.
  if (declines.length) {
    const w = planesForWrite(t);
    for (let k = 0; k < declines.length; k += 2) {
      const tile = declines[k];
      const to = declines[k + 1];
      const old = w.lvl[tile];
      w.lvl[tile] = to > 0 ? makeLvl(to, tierOf(old), styleOf(old)) : 0;
      w.age[tile] = 0;
      appendTileEvent(t, ctx.tick, tile, 'declined', to);
    }
  }

  // The Builders cap: winners ranked by z (ties seeded), at most Builders/4 starts this tick, with a carry.
  const allow = Math.max(0, flow(t, 'dev.builders', buildersPerTick(population(t), p)));
  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score || a.rank - b.rank || a.tile - b.tile);
    const n = Math.min(allow, candidates.length);
    const w = planesForWrite(t);
    // The World's Builders' Shortage (§5.16): every start this tick takes one tick longer.
    const shortage = ctx.world.event?.id === 'buildersShortage' ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const c = candidates[k];
      w.lvl[c.tile] = c.lvl;
      w.age[c.tile] = 0;
      pairSet(t.construction, c.tile, (p.buildTicks[c.level - 1] ?? 2) + shortage);
      busy[c.tile] = 1;
      if (c.from > 0) pairSet(d.aux, c.tile, aux(AUX_UPGRADE, c.from));
      appendTileEvent(t, ctx.tick, c.tile, c.from > 0 ? 'levelUp' : 'started', c.level);
    }
    d.turnedAway = Math.min(255, d.turnedAway + candidates.length - n);
  }

  // Incidents (§5.2 step 3): a monthly chance per building, met once a month by the stride, capped at 2% a month.
  if (mishaps && d.incidentsLeft > 0) incidents(t, ctx, d, f, visitedBuilt, month);

  // Founders' carts (§2.3, A12).
  carts(t, ctx, occ);

  writeDev(t, d);
}

function incidents(t: TownState, ctx: TickContext, d: DevState, f: Facts, visited: readonly number[], month: Uint8Array | null): void {
  const p = ctx.params.develop;
  const smoke = policyActive(t, 'smokeAlarms') ? p.smokeAlarms : 1;
  const { use, lvl } = planesOf(t);
  const chanceAt = (tile: number, risk: number) => {
    const cover = month ? cbFire(month[M_CELL + cellAt(tile)]) : 0;
    const open = 1 - Math.min(100, cover) / 100;
    return p.incidentBase * open * open * risk * smoke;
  };
  for (const i of visited) {
    if (d.incidentsLeft <= 0) return;
    // A tile that declined to an empty lot or started building this tick is skipped.
    if (levelOf(lvl[i]) === 0 || f.busy[i]) continue;
    const z = payloadOf(use[i]);
    if (ctx.rng('incident', i, 0) / U32 >= chanceAt(i, p.incidentRisk[z] ?? 1)) continue;
    pairSet(t.marks, i, pairGet(t.marks, i) | DAMAGED);
    pairSet(d.aux, i, aux(AUX_DAMAGED, p.incidentTicks));
    appendTileEvent(t, ctx.tick, i, 'incident', z);
    d.incidentsLeft--;
  }
  const civicRisk = p.incidentRisk[N_ZONES] ?? 0.5;
  for (const b of t.buildings) {
    if (d.incidentsLeft <= 0) return;
    const anchor = b[B_Y] * N_MAP + b[B_X];
    if (b[B_DAMAGED] > 0 || f.busy[anchor]) continue;
    if (!visitedOn(anchor, ctx.tick, t.seed, p.strideMul, ctx.sprint)) continue;
    if (ctx.rng('incident', anchor, 1 + b[B_KIND]) / U32 >= chanceAt(anchor, civicRisk)) continue;
    b[B_DAMAGED] = p.incidentTicks;
    appendTileEvent(t, ctx.tick, anchor, 'incident', 255);
    d.incidentsLeft--;
  }
}

/**
 * Founders' carts: while the town is under 300 people and younger than 21
 * days (the fortnight included), +min(20, £ vacancy) Outside World arrivals
 * a tick, half £ Workers and half £ Families (parents and children 1:1).
 * They bypass the 6% arrivals cap but never housing (A12).
 *
 * The rest of the tick's 20 found no home: they join the £ waiting list
 * (applicants, as any would-be arrival does in M11), up to one month of
 * carts in all. Without them the Homes meter would read an empty founding
 * town as over-built (nobody living or waiting against a pipeline of
 * cottages) and talk its own growth down in the first month (A11's +60
 * falls to about +20, and half of Bramble's foundings stall below 60).
 */
function carts(t: TownState, ctx: TickContext, occ: Occupancy): void {
  const p = ctx.params.develop;
  if (t.tick >= p.cartsDays * TICKS_PER_DAY + ctx.params.clock.sprintTicks) return;
  if (population(t) >= p.cartsUnderPop) return;
  // Homes that finished this tick are open now; closed ones are not.
  const n = Math.min(p.cartsPerTick, Math.max(0, occ.vacantModest()));
  if (n > 0) {
    const families = Math.floor(n / 2);
    const parents = Math.ceil(families / 2);
    postPeople(t, 'carts', person(STAGE_W, 0), n - families);
    postPeople(t, 'carts', person(STAGE_P, 0), parents);
    postPeople(t, 'carts', person(STAGE_C, 0), families - parents);
    occ.peopleChanged();
  }
  const kW = cohort(0, 0);
  const kF = cohort(0, 1);
  const room = p.cartsPerTick * TICKS_PER_MONTH - t.applicants[kW] - t.applicants[kF];
  const wait = Math.min(p.cartsPerTick - n, room);
  if (wait <= 0) return;
  const families = Math.floor(wait / 2);
  t.applicants[kW] += wait - families;
  t.applicants[kF] += families;
}

// ---- Reading the memo (the page, advisors, tests) --------------------------------------------------

/** Winning rolls the Builders cap turned away so far this month (Bramble: "Our builders are busy"). */
export function buildersTurnedAway(t: TownState): number {
  return devOf(t).turnedAway;
}

/** Ticks a zoned tile stays closed after an incident (0 if open). */
export function closedTicks(t: TownState, tile: number): number {
  const v = pairGet(devOf(t).aux, tile);
  return auxKind(v) === AUX_DAMAGED ? auxValue(v) : 0;
}

/** The level a busy tile is upgrading from (0 if it is a new build or not busy). */
export function upgradingFrom(t: TownState, tile: number): number {
  const v = pairGet(devOf(t).aux, tile);
  return auxKind(v) === AUX_UPGRADE ? auxValue(v) : 0;
}

/** Has a month step stored its fields for the ticks yet? */
export function hasMonthMemo(t: TownState): boolean {
  return devOf(t).month !== null;
}

/** Incidents still allowed this month. */
export function incidentsLeft(t: TownState): number {
  return devOf(t).incidentsLeft;
}

export interface GrowthExplained {
  /** The growth score z and this visit's chance (grow or level up; 0 when blocked). */
  z: number;
  chance: number;
  /** Why terms of the on-demand 'grow' quantity (§5.19). */
  terms: [key: string, amount: number][];
  /** What stops it, if anything. */
  blocked: 'noRoad' | 'levelCap' | 'landValue' | 'pollution' | 'busy' | 'closed' | 'notZoned' | null;
}

/** The inspector's "why isn't this growing?" for one tile, from stored state alone. */
export function explainGrowth(t: TownState, tile: number, P: Params): GrowthExplained {
  const p = P.develop;
  const d = devOf(t);
  const f = factsOf(t, d);
  const u = f.pl.use[tile];
  const none: GrowthExplained = { z: 0, chance: 0, terms: [], blocked: 'notZoned' };
  if (catOf(u) !== CAT_Z || payloadOf(u) >= N_ZONES) return none;
  const z = payloadOf(u);
  if (f.busy[tile]) return { ...none, blocked: 'busy' };
  if (f.marks[tile] & DAMAGED) return { ...none, blocked: 'closed' };
  const level = levelOf(f.pl.lvl[tile]);
  const bits = tierOf(f.pl.lvl[tile]);
  const c = cellAt(tile);
  const month = d.month;
  const tb = month ? month[M_TILE + tile] : 0;
  const b = month && z !== ZF ? month[M_L + z * N_CELLS + c] : L_UNKNOWN;
  const L = z === ZF ? farmDesirability(t, f.terrain[tile], p) : b === L_UNKNOWN ? desirability(z, fallbackPlace(f.lv[c], f.poll[c]), p) : b - 128;
  let h = bits > 2 ? 2 : bits;
  if (z === ZH && level === 0) {
    h = 0;
    const tm = homesTierMax(f.lv[c] - 0.5 * f.poll[c], p);
    for (let k = 1; k <= tm; k++) if (t.meters[k] > t.meters[h]) h = k;
  }
  const D = z === ZH ? t.meters[h] : t.meters[ZMETER[z]];
  const target = level === 0 ? ZMIN[z] : level + 1;
  const needsService = target >= 2;
  const unp = needsService && tb & TB_UNPOWERED ? -p.unpoweredPenalty : 0;
  const dry = needsService && tb & TB_DRY ? -p.dryPenalty : 0;
  const score = D + L + unp + dry;
  const terms: [string, number][] = [
    ['grow.meter', D],
    ['grow.desirability', L],
  ];
  if (unp) terms.push(['grow.unpowered', unp]);
  if (dry) terms.push(['grow.dry', dry]);
  const cap = levelCap(t, z, f.lv[c], f.terrain[tile], p);
  let blocked: GrowthExplained['blocked'] = null;
  if (!roadMask(f.pl.use, p.roadReach)[tile]) blocked = 'noRoad';
  else if (z === ZH && f.poll[c] > p.homesPollutionBlock) blocked = 'pollution';
  else if (target > cap) blocked = target > (ZTIERCAP[z][t.tier] ?? 0) ? 'levelCap' : 'landValue';
  if (blocked === 'noRoad') terms.push(['grow.noRoad', -100]);
  if (blocked === 'levelCap') terms.push(['grow.levelCap', -100]);
  if (blocked === 'landValue') terms.push(['grow.landValue', -100]);
  if (d.turnedAway > 0) terms.push(['grow.builders', -d.turnedAway]);
  const chance = blocked ? 0 : level === 0 ? growChance(score, p) : levelUpChance(score, p);
  return { z: score, chance, terms, blocked };
}
