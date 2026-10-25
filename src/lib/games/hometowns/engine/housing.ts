// Housing (WP2b, spec §5.8 with A9 and A13): who lives in which homes, what
// they pay, how much more housing the town wants, and how neighbourhoods
// change tier over time.
//
// Two month steps live here. M7a (household budgets) runs the allocation on
// the people as they stand before migration, to price rents and
// affordability for the shops and the tax office. M12 (housing) runs after
// migration: neighbourhoods re-tier (gentrification) and filter down
// (Forrester), Aspirants move up into vacancies, the allocation runs again
// for this month's vacancy and squeezed counts, and the Homes meters move.
//
// The meters use Sterman's supply-line correction: homes already under
// construction count against demand, and the waiting list (applicants and
// aspirants) counts for it, so a town that has started enough homes stops
// asking for more before they open, which is what stops the cobweb boom and
// bust (§5.20). Homes tax is deliberately not in the meter: it acts once,
// through migration, so the Why stays honest.

import { monthF64, monthI32, monthU8 } from './pool';
import { BUILDINGS, ZONE_DEFS } from './content';
import { flow, moveStock } from './core';
import { clamp, M, T } from './fx';
import { bp } from './num';
import { hasPolicy, housingOf, memoFor, scratchOf } from './people';
import { appendTileEvent } from './records';
import {
  B_KIND,
  B_X,
  B_Y,
  CAT_ZONE,
  DISTRICTS,
  MARK_AFFORDABLE,
  MARK_DAMAGED,
  TILES,
  cellOf,
  decodeCellsShared,
  districtOf,
  lvlLevel,
  lvlStyle,
  lvlTier,
  makeLvl,
  planesForWrite,
  planesOf,
  tileIndex,
  zonedTiles,
} from './tiles';
import {
  COHORT_COUNT,
  COHORT_S,
  PERSON_S,
  STAGE_C,
  STAGE_P,
  STAGE_R,
  STAGE_W,
  Z_HOMES,
  person,
  type HousingSlot,
  type MonthContext,
  type TownState,
} from './types';

const HOMES_CAP = ZONE_DEFS[Z_HOMES].capacity;

// ---- Tile scans -------------------------------------------------------------------------
//
// These loops run over all 4,096 tiles several times a month, so they read
// the planes' bit fields directly (the layout is tiles.ts's: category in the
// top 4 bits of `use`, level in the low 3 bits of `lvl`, tier in the next 2)
// and keep the constants they need in locals.

const N_TILES = TILES;
const N_DISTRICTS = DISTRICTS;
const ZONE_HOMES_USE = (CAT_ZONE << 12) | Z_HOMES;
const DAMAGED = MARK_DAMAGED;
const AFFORDABLE = MARK_AFFORDABLE;

/** 1 for every tile with construction ticks left (pipeline, not yet open). */
export function constructionMask(t: TownState): Uint8Array {
  const out = monthU8(N_TILES);
  for (let i = 0; i + 1 < t.construction.length; i += 2) if (t.construction[i + 1] > 0) out[t.construction[i]] = 1;
  return out;
}

/** The MARK_* bits of every tile. */
export function marksMask(t: TownState): Uint8Array {
  const out = monthU8(N_TILES);
  for (let i = 0; i + 1 < t.marks.length; i += 2) out[t.marks[i]] = t.marks[i + 1] & 255;
  return out;
}

export interface HomeTiles {
  count: number;
  tile: Int32Array;
  tier: Uint8Array;
  level: Uint8Array;
  /** Persons the tile houses at its level (§3.3). */
  persons: Float64Array;
  affordable: Uint8Array;
}

/** What one month's people steps need to know about the tiles, scanned once (TileFacts in the scratch). */
export interface TileFacts {
  busy: Uint8Array;
  marks: Uint8Array;
  homes: HomeTiles;
  jobs: Uint8Array;
}

function scanTiles(t: TownState): TileFacts {
  const p = planesOf(t);
  const use = p.use;
  const lvl = p.lvl;
  const busy = constructionMask(t);
  const marks = marksMask(t);
  // Every home is a zoned tile, so the zoned count bounds the list (readers stop at count).
  const zoned = zonedTiles(use);
  const cap = zoned.length;
  const homes: HomeTiles = {
    count: 0,
    tile: monthI32(cap),
    tier: monthU8(cap),
    level: monthU8(cap),
    persons: monthF64(cap),
    affordable: monthU8(cap),
  };
  const jobs = monthU8(N_DISTRICTS);
  for (let q = 0; q < zoned.length; q++) {
    const i = zoned[q];
    const u = use[i];
    if (u >>> 12 !== CAT_ZONE) continue;
    const level = lvl[i] & 7;
    if (level === 0 || busy[i]) continue;
    if (u !== ZONE_HOMES_USE) {
      jobs[((i >> 9) << 3) | ((i & 63) >> 3)] = 1; // districtOf(i) for the 64-wide map
      continue;
    }
    if (marks[i] & DAMAGED) continue;
    const k = homes.count++;
    homes.tile[k] = i;
    homes.tier[k] = Math.min(2, (lvl[i] >> 3) & 3);
    homes.level[k] = level;
    homes.persons[k] = HOMES_CAP[level - 1] ?? 0;
    homes.affordable[k] = marks[i] & AFFORDABLE ? 1 : 0;
  }
  for (const b of t.buildings) {
    const def = BUILDINGS[b[B_KIND]];
    const at = tileIndex(b[B_X], b[B_Y]);
    if (def && def.staff > 0 && !busy[at]) jobs[districtOf(at)] = 1;
  }
  return { busy, marks, homes, jobs };
}

/**
 * The tile facts for this month (scanned on first use and kept in the
 * month's scratch; re-tiering drops them), or freshly scanned outside a month.
 */
export function tileFacts(t: TownState, m?: MonthContext): TileFacts {
  if (!m) return scanTiles(t);
  const s = scratchOf(m);
  if (!s.facts) s.facts = scanTiles(t);
  return s.facts;
}

/** Completed, undamaged Homes tiles (the ones that house people, §5.8), in tile order. */
export function homeTiles(t: TownState, m?: MonthContext): HomeTiles {
  return tileFacts(t, m).homes;
}

/** 1 for districts holding any open job: a built non-Homes zone tile or a finished staffed civic building. */
export function jobDistricts(t: TownState, m?: MonthContext): Uint8Array {
  return tileFacts(t, m).jobs;
}

// ---- Allocation ---------------------------------------------------------------------------

export interface Allocation {
  /** Persons housed in each tier's homes. */
  occ: number[];
  vacant: number[];
  /** Persons housed and squeezed, by COHORT (Families are Parents with their Children). */
  housed: number[];
  squeezed: number[];
  /** Squeezed by the tier whose homes they want (Students with £). */
  squeezedTier: number[];
}

/** Persons by COHORT from a people[] array. */
export function cohortPersons(people: readonly number[]): number[] {
  const out = new Array<number>(COHORT_COUNT).fill(0);
  for (let h = 0; h < 3; h++) {
    out[h * 3] = people[person(STAGE_W, h)];
    out[h * 3 + 1] = people[person(STAGE_P, h)] + people[person(STAGE_C, h)];
    out[h * 3 + 2] = people[person(STAGE_R, h)];
  }
  out[COHORT_S] = people[PERSON_S];
  return out;
}

/**
 * One allocation move: cohort k takes what it can of tier h's free homes.
 * A module function, not a closure, so the month's hot callers (squeezedTotal
 * runs a few hundred times a month) allocate nothing per call.
 */
function takeHomes(cohorts: readonly number[], housed: number[], avail: number[], k: number, h: number): void {
  const n = Math.min(cohorts[k] - housed[k], avail[h]);
  if (n <= 0) return;
  housed[k] += n;
  avail[h] -= n;
}

/**
 * The deterministic allocation (§5.8): every cohort fills its own tier's
 * homes first (Families, then Retirees, then Workers); then Families and
 * Retirees may take one tier down; Students take £ homes, then ££; anyone
 * left is squeezed. Pure: the same people and capacities give the same
 * answer wherever it runs.
 */
export function allocate(cohorts: readonly number[], cap: readonly number[]): Allocation {
  const avail = cap.map((c) => Math.max(0, Math.floor(c)));
  const housed = new Array<number>(COHORT_COUNT).fill(0);
  for (const kind of [1, 2, 0]) for (let h = 0; h < 3; h++) takeHomes(cohorts, housed, avail, h * 3 + kind, h);
  for (const kind of [1, 2]) for (let h = 1; h < 3; h++) takeHomes(cohorts, housed, avail, h * 3 + kind, h - 1);
  takeHomes(cohorts, housed, avail, COHORT_S, 0);
  takeHomes(cohorts, housed, avail, COHORT_S, 1);
  const squeezed = cohorts.map((n, k) => n - housed[k]);
  const squeezedTier = [0, 0, 0];
  for (let k = 0; k < COHORT_COUNT; k++) squeezedTier[k === COHORT_S ? 0 : Math.floor(k / 3)] += squeezed[k];
  const occ = cap.map((c, h) => Math.max(0, Math.floor(c)) - avail[h]);
  return { occ, vacant: avail, housed, squeezed, squeezedTier };
}

const SQ_HOUSED: number[] = new Array<number>(COHORT_COUNT).fill(0);
const SQ_AVAIL: number[] = [];

/**
 * Σ allocate(cohorts, cap).squeezed, in cohort order, without building the
 * allocation: houseNewcomers' binary search calls it a few hundred times a
 * month. The same arithmetic as allocate, on two reused arrays.
 */
function squeezedTotal(cohorts: readonly number[], cap: readonly number[]): number {
  const housed = SQ_HOUSED;
  housed.fill(0);
  const avail = SQ_AVAIL;
  avail.length = cap.length;
  for (let h = 0; h < cap.length; h++) avail[h] = Math.max(0, Math.floor(cap[h]));
  for (let a = 0; a < 3; a++) {
    const kind = TAKE_OWN[a];
    for (let h = 0; h < 3; h++) takeHomes(cohorts, housed, avail, h * 3 + kind, h);
  }
  for (let a = 0; a < 2; a++) {
    const kind = TAKE_DOWN[a];
    for (let h = 1; h < 3; h++) takeHomes(cohorts, housed, avail, h * 3 + kind, h - 1);
  }
  takeHomes(cohorts, housed, avail, COHORT_S, 0);
  takeHomes(cohorts, housed, avail, COHORT_S, 1);
  let n = 0;
  for (let k = 0; k < cohorts.length; k++) n += cohorts[k] - housed[k];
  return n;
}
/** allocate's kind orders: own tier (Families, Retirees, Workers), then one tier down. */
const TAKE_OWN = [1, 2, 0];
const TAKE_DOWN = [1, 2];

/** Newcomers housed in the allocation's priority order: Families, Retirees, Workers, then Students. */
const NEWCOMER_ORDER = [1, 4, 7, 2, 5, 8, 0, 3, 6, 9];

/**
 * How many of each cohort's would-be newcomers (`waiting`, by COHORT) the
 * town can house without squeezing out anyone already living there. The
 * allocation re-sorts everyone each month (Families before Workers), so a
 * newcomer Family that took a £ home one tier down would otherwise move up
 * into a ££ home next month and leave a resident ££ Worker, who cannot go
 * down a tier, without one. Each cohort's count is the largest that keeps the
 * residents' squeeze unchanged (a binary search: the squeeze only grows as
 * people are added).
 */
export function houseNewcomers(residents: readonly number[], cap: readonly number[], waiting: readonly number[]): number[] {
  const current = [...residents];
  const base = squeezedTotal(current, cap);
  const housed = new Array<number>(COHORT_COUNT).fill(0);
  for (const k of NEWCOMER_ORDER) {
    let lo = 0;
    let hi = Math.max(0, Math.floor(waiting[k]));
    while (lo < hi) {
      const mid = lo + Math.ceil((hi - lo) / 2);
      current[k] += mid;
      const ok = squeezedTotal(current, cap) === base;
      current[k] -= mid;
      if (ok) lo = mid;
      else hi = mid - 1;
    }
    current[k] += lo;
    housed[k] = lo;
  }
  return housed;
}

/** Homes capacity after short lets (§5.8): a busy tourist town loses some ££ homes to visitor beds. */
export function effectiveCap(t: TownState, m: MonthContext, cap: readonly number[]): number[] {
  const out = cap.map((c) => Math.max(0, Math.floor(c)));
  const ratio = m.derived.tourism?.visitorRatio ?? 0;
  const [at, share] = m.params.housing.shortLets;
  if (ratio > at && !hasPolicy(t, 'shortLetLimits')) out[1] = out[1] - Math.floor(out[1] * share);
  return out;
}

// ---- M7a households ---------------------------------------------------------------------------

/** STEP M7a (WP2b): rents, rent shares and affordability from the current allocation → derived.housing. */
export function stepHouseholds(t: TownState, m: MonthContext): void {
  const hp = m.params.housing;
  const dev = m.derived.development;
  const lab = m.derived.labour;
  const cap = effectiveCap(t, m, dev ? dev.cap : [0, 0, 0]);
  const alloc = allocate(cohortPersons(t.people), cap);
  scratchOf(m).squeezed = [...alloc.squeezed];

  // Land value and Keep Homes Affordable share over each tier's homes.
  const lv = decodeCellsShared(t.lv); // shared: read only
  const homes = homeTiles(t, m);
  const lvSum = [0, 0, 0];
  const capSum = [0, 0, 0];
  const affSum = [0, 0, 0];
  for (let i = 0; i < homes.count; i++) {
    const h = homes.tier[i];
    const w = homes.persons[i];
    lvSum[h] += w * lv[cellOf(homes.tile[i])];
    capSum[h] += w;
    if (homes.affordable[i]) affSum[h] += w;
  }

  const rent = [0, 0, 0];
  const rentShare = [0, 0, 0];
  const afford = [0, 0, 0];
  for (let h = 0; h < 3; h++) {
    const lvBar = capSum[h] > 0 ? lvSum[h] / capSum[h] : hp.LVref[h];
    const occRatio = cap[h] > 0 ? alloc.occ[h] / cap[h] : hp.occupancyRef;
    const affShare = capSum[h] > 0 ? affSum[h] / capSum[h] : 0;
    rent[h] =
      hp.R0[h] *
      (hp.rentLv[0] + (hp.rentLv[1] * lvBar) / hp.LVref[h]) *
      M(occRatio / hp.occupancyRef, hp.rentOcc[0], hp.rentOcc[1]) *
      (1 - (1 - hp.affordableRent) * affShare);
    const ipp = lab ? lab.incomePerPerson[h] : 0;
    rentShare[h] = (rent[h] * (1 + bp(t.taxes.homes[h] ?? 0))) / Math.max(1, ipp);
    afford[h] = clamp(100 * (1 - (rentShare[h] - hp.afford[0]) / hp.afford[1]), 0, 100);
  }

  let squeezed = 0;
  for (const n of alloc.squeezed) squeezed += n;
  const slot: HousingSlot = {
    cap,
    pipeline: dev ? dev.pipeline.map((x) => Math.max(0, Math.floor(x))) : [0, 0, 0],
    occ: alloc.occ,
    vacant: alloc.vacant,
    rent,
    rentShare,
    afford,
    squeezed,
    target: [0, 0, 0],
    reachable: dev ? [...dev.reachableHomes] : [true, true, true],
  };
  m.derived.housing = slot;
}

// ---- M12 housing ---------------------------------------------------------------------------

/** Salt for the re-tiering roll on the develop stream, far from WP2e's own draws. */
const RETIER_SALT = 0x5e7ee;

interface TierChange {
  /** Capacity moved between tiers by re-tiering and filtering. */
  capDelta: number[];
  /** Residents of re-tiered tiles (estimated from the tier's occupancy), by their old tier. */
  displaced: number[];
  retiered: number;
  filtered: number;
}

/**
 * Gentrification and filtering (§5.8). A Homes tile whose land value (less
 * half its pollution) has risen `retier[0]` above its tier's band, while the
 * next tier's meter is above `retier[1]`, re-tiers upward with p = 0.03 a
 * month (each tile is visited once a month, so this is the level-up visit's
 * chance), unless it is painted Keep Homes Affordable. In a slack ££ market
 * ££ homes filter down to £, lowest land value first; very old £££ homes
 * whose land value has fallen below the band filter to ££.
 */
function changeTiers(t: TownState, m: MonthContext, occRate: readonly number[]): TierChange {
  const hp = m.params.housing;
  const homes = homeTiles(t, m);
  const lv = decodeCellsShared(t.lv); // shared: read only
  const poll = m.derived.fields?.pollution;
  const memo = memoFor(t);
  const out: TierChange = { capDelta: [0, 0, 0], displaced: [0, 0, 0], retiered: 0, filtered: 0 };
  const p = planesOf(t);
  const setTier = (k: number, tier: number) => {
    const tile = homes.tile[k];
    const w = planesForWrite(t);
    w.lvl[tile] = makeLvl(lvlLevel(p.lvl[tile]), tier, lvlStyle(p.lvl[tile]));
    out.capDelta[homes.tier[k]] -= homes.persons[k];
    out.capDelta[tier] += homes.persons[k];
    appendTileEvent(t, m.tick, tile, 'retier', tier);
  };

  // Gentrification, tile by tile with a stateless roll.
  for (let k = 0; k < homes.count; k++) {
    const h = homes.tier[k];
    if (h >= 2 || homes.affordable[k]) continue;
    const cell = cellOf(homes.tile[k]);
    const value = lv[cell] - 0.5 * (poll ? poll[cell] : 0);
    if (value < hp.tierBands[h] + hp.retier[0] || t.meters[h + 1] <= hp.retier[1]) continue;
    if (m.rng('develop', homes.tile[k], RETIER_SALT) / 4294967296 >= hp.retierP) continue;
    out.displaced[h] += homes.persons[k] * occRate[h];
    setTier(k, h + 1);
    out.retiered++;
  }

  // Filtering, lowest land value first (ties by tile), a share of the eligible tiles a month.
  const filterDown = (from: number, rate: number, eligible: (k: number) => boolean, key: string) => {
    const pick: number[] = [];
    for (let k = 0; k < homes.count; k++) if (homes.tier[k] === from && lvlTier(planesOf(t).lvl[homes.tile[k]]) === from && eligible(k)) pick.push(k);
    if (pick.length === 0) return;
    const n = Math.min(pick.length, flow(t, key, pick.length * rate));
    if (n <= 0) return;
    pick.sort((a, b) => lv[cellOf(homes.tile[a])] - lv[cellOf(homes.tile[b])] || homes.tile[a] - homes.tile[b]);
    for (let i = 0; i < n; i++) setTier(pick[i], from - 1);
    out.filtered += n;
  };
  if (memo.vacHigh >= hp.filterVacancy[1]) filterDown(1, hp.filterVacancy[2], () => true, 'house.filterM');
  const [oldAge, rateH] = hp.filterOld;
  filterDown(2, rateH, (k) => planesOf(t).age[homes.tile[k]] >= oldAge && lv[cellOf(homes.tile[k])] < hp.tierBands[1], 'house.filterH');
  if (out.retiered + out.filtered > 0) scratchOf(m).facts = null;
  return out;
}

/** STEP M12 (WP2b): re-tiering and filtering, Aspirants moving up, the allocation, vacancy, squeezed and the Homes meters (completes derived.housing). */
export function stepHousing(t: TownState, m: MonthContext): void {
  const hs = housingOf(m);
  const mp = m.params.meters;
  const hp = m.params.housing;
  const memo = memoFor(t);
  const p = t.people;

  // Occupancy before any change, to estimate how many live in a re-tiered tile.
  const before = allocate(cohortPersons(p), hs.cap);
  const occRate = hs.cap.map((c, h) => (c > 0 ? before.occ[h] / c : 0));
  const change = changeTiers(t, m, occRate);
  const cap = hs.cap.map((c, h) => Math.max(0, Math.floor(c + change.capDelta[h])));

  // Aspirants move up into vacancies of the next tier's homes, then some give up.
  let alloc = allocate(cohortPersons(p), cap);
  for (let h = 0; h < 2; h++) {
    const up = Math.min(t.aspirants[h], alloc.vacant[h + 1], p[person(STAGE_W, h)]);
    if (up > 0) {
      const moved = moveStock(t, person(STAGE_W, h), person(STAGE_W, h + 1), up);
      t.aspirants[h] -= moved;
      alloc = allocate(cohortPersons(p), cap);
    }
    t.aspirants[h] -= flow(t, `house.aspDecay.${h}`, t.aspirants[h] * m.params.people.aspirantDecay);
    t.aspirants[h] = Math.max(0, Math.min(t.aspirants[h], p[person(STAGE_W, h)]));
  }

  // This month's squeezed residents; re-tiering's displaced who found no other home become forced movers next month.
  let squeezed = 0;
  for (const n of alloc.squeezed) squeezed += n;
  t.squeezed = squeezed;
  for (let h = 0; h < 3; h++) {
    const lost = Math.round(change.displaced[h]);
    memo.displaced[h] = Math.min(alloc.squeezedTier[h], memo.displaced[h] + lost);
  }

  // A slack ££ market, counted for filtering.
  memo.vacHigh = cap[1] > 0 && alloc.vacant[1] / cap[1] > hp.filterVacancy[0] ? Math.min(255, memo.vacHigh + 1) : 0;

  // The Homes meters (§5.8): occupied, squeezed and waiting against 95% of capacity plus the pipeline.
  const unmet = m.derived.needs?.unmet ?? [0, 0, 0];
  const keys = ['meter.homesL', 'meter.homesM', 'meter.homesH'];
  let pop = 0;
  for (const n of p) pop += n;
  const slack = homesSlack(pop, m.params);
  for (let h = 0; h < 3; h++) {
    let waiting = 0;
    for (let kind = 0; kind < 3; kind++) waiting += t.applicants[h * 3 + kind];
    if (h === 0) waiting += t.applicants[COHORT_S];
    const asp = h > 0 ? t.aspirants[h - 1] : 0;
    const pipe = hs.pipeline[h];
    const target = homesTarget(alloc.occ[h], alloc.squeezedTier[h], waiting, asp, cap[h], pipe, unmet[h], hs.reachable[h], m, slack);
    const prev = t.meters[h];
    t.meters[h] = clamp(prev + mp.alpha * (target.value - prev), -100, 100);
    hs.target[h] = target.value;
    for (const [key, amount] of target.terms) m.why.add(key, amount, keys[h]);
    m.why.set(keys[h], t.meters[h]);
  }

  // Complete the slot in place for the steps after this one.
  hs.cap = cap;
  hs.occ = alloc.occ;
  hs.vacant = alloc.vacant;
  hs.squeezed = squeezed;
}

/**
 * The least a Homes ratio's denominator may be: `homesSlackTicks` ticks of
 * construction starts (Builders/4 a tick, §5.2) of L1 homes. The town adds
 * homes in steps of that size, so demand smaller than one step is noise, not
 * a signal to build, and an empty tier no longer flips from 0 to +99 between
 * 5 and 8 people waiting.
 */
export function homesSlack(pop: number, p: Pick<MonthContext, 'params'>['params']): number {
  const d = p.develop;
  return p.meters.homesSlackTicks * ((d.buildersBase + pop / d.buildersPer) / 4) * ZONE_DEFS[Z_HOMES].capacity[0];
}

/**
 * Target_H for one tier, with its Why terms (§5.8, A9, A10). The ratio's
 * deviation from 1 is split into its parts (occupancy against capacity, the
 * squeezed, the waiting list, aspirants, and the pipeline's discount), and
 * the tanh-shaped target is shared out over them in proportion.
 */
export function homesTarget(
  occ: number,
  squeezed: number,
  waiting: number,
  aspirants: number,
  cap: number,
  pipeline: number,
  unmet: number,
  reachable: boolean,
  m: Pick<MonthContext, 'params'>,
  slack = 5,
): { value: number; ratio: number; terms: [string, number][] } {
  const mp = m.params.meters;
  const occTarget = 1 - mp.vacancyTarget;
  // §5.8's "+5", floored at a build increment (homesSlackTicks): see homesSlack.
  const denom = Math.max(occTarget * (cap + pipeline) + 5, slack);
  const ratio = (occ + squeezed + waiting + aspirants) / denom;
  let core = 100 * T(mp.homesGain * (ratio - 1));
  // A tier with no homes built or building has nothing to be over-supplied with: its vacancy side reads
  // 0, not the bare ratio's 0/5 = -100, and with no residents of its own the needs penalty has no one
  // to speak for (newcomers already weighed the needs when they chose the town, §5.11), so only
  // waiting demand moves it (params rules.emptyHomesFloor, the mirror of A9's cap).
  const empty = cap + pipeline <= 0 && m.params.rules.emptyHomesFloor;
  if (empty && core < 0) core = 0;
  // Parts of (ratio − 1): each against capacity alone, then the pipeline's discount.
  const d0 = Math.max(occTarget * cap + 5, slack);
  const parts: [string, number][] = [
    ['meter.homes.vacancy', occ / d0 - 1],
    ['meter.homes.squeezed', squeezed / d0],
    ['meter.homes.waiting', waiting / d0],
    ['meter.homes.aspirants', aspirants / d0],
    ['meter.homes.pipeline', ratio - (occ + squeezed + waiting + aspirants) / d0],
  ];
  const dev = ratio - 1;
  const terms: [string, number][] = [];
  if (Math.abs(dev) > 1e-9) for (const [k, x] of parts) if (x !== 0) terms.push([k, (core * x) / dev]);
  const penalty = empty ? 0 : Math.min(mp.needFloor, mp.needPenalty * unmet);
  let value = core - penalty;
  if (penalty > 0) terms.push(['meter.homes.needs', -penalty]);
  if (!reachable && value > mp.unreachableCap) {
    terms.push(['meter.homes.unreachable', mp.unreachableCap - value]);
    value = mp.unreachableCap;
  }
  return { value: clamp(value, -100, 100), ratio, terms };
}

