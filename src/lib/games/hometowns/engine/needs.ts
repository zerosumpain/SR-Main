// Stars and needs (WP2b, spec §5.6 and §5.15's U_happy): the eleven 0–100
// indices every town is judged on, the needs ladders that become the wants
// bubbles, and the perceived stars other towns' movers read.
//
// Residents judge their own town on its actual stars; movers elsewhere see
// the perceived stars, smoothed with τ 6 months, so a slider flip never
// causes twitchy migration and a good reputation is an asset worth keeping
// (§5.20). The one star that differs by audience is Jobs: residents feel
// their own unemployment, while a mover weighs the chance of a job here
// (JobProspect: vacancies against the unemployed queue), so perception
// smooths the movers' version.
//
// WP2b also keeps the culture stock CS here (unowned in §13.2, and the
// Culture star is its only reader in the people model): it fills with venue
// culture, old buildings and a mix of people, and drains with τ 36 months.

import { BUILDINGS, buildingIndex } from './content';
import { flowsFor, population } from './core';
import { clamp, smooth, T } from './fx';
import { neutral } from './derived';
import { tileFacts } from './housing';
import { hasBuilding, hasPolicy, housingOf, memoFor, scratchOf, tierPersons } from './people';
import {
  B_FUND,
  B_KIND,
  B_X,
  B_Y,
  CAT_ZONE,
  CELLS_PER_SIDE,
  DISTRICTS,
  MARK_HERITAGE,
  MAP,
  TILES,
  districtOf,
  footprint,
  planesOf,
  tileIndex,
  VARIANT_HOTEL,
} from './tiles';
import {
  COHORT_COUNT,
  COHORT_S,
  COVERAGES,
  STAGE_C,
  STAGE_P,
  STAGE_R,
  STAGE_W,
  STARS,
  STAR_COUNT,
  STAR_TOWN,
  Z_HOMES,
  Z_LEISURE,
  Z_SHOPS,
  person,
  starTier,
  type MonthContext,
  type NeedsSlot,
  type StarsSlot,
  type TownState,
} from './types';

const S = (k: (typeof STARS)[number]): number => STARS.indexOf(k);
export const STAR_JOBS = S('jobs');
export const STAR_HOMES = S('homes');
export const STAR_TAX = S('tax');
const COV_FUN = COVERAGES.indexOf('fun');
const COV_NATURE = COVERAGES.indexOf('nature');

/**
 * Star effects printed on the §6.7 policy cards (content.ts POLICIES). WP2d
 * owns the cards; the numbers are applied here because the stars are.
 */
const POLICY_STARS: readonly [card: string, star: number, points: number][] = [
  ['litterPickers', S('nature'), 5],
  ['greenEnergyPledge', S('nature'), 5],
  ['nightMarket', S('fun'), 8],
  ['farmersMarket', S('fun'), 5],
  ['neighbourhoodWatch', S('fun'), -2],
  ['tourismPromotion', S('buzz'), 5],
];
/** Green Energy Pledge: culture +1 a month (§6.7). */
const GREEN_CULTURE = 1;

function policyPoints(t: TownState, star: number): number {
  let n = 0;
  for (const [card, s, pts] of POLICY_STARS) if (s === star && hasPolicy(t, card)) n += pts;
  return n;
}

/** The town-level stars that do not depend on the labour and housing markets (M9 reads them too). */
export function baseStars(t: TownState, m: MonthContext): { schools: number; health: number; safety: number; fun: number; culture: number; nature: number; around: number; buzz: number } {
  const sp = m.params.stars;
  const cov = m.derived.coverage;
  const fields = m.derived.fields;
  const eduQ = cov ? cov.eduQ : [0, 0, 0];
  const schools = 100 * (t.tier <= 1 ? clamp(eduQ[0], 0, 1) : 0.6 * clamp(eduQ[0], 0, 1) + 0.4 * clamp(eduQ[1], 0, 1));

  // Health (A14): capacity against demand, covered share and quality.
  const n = population(t);
  let retirees = 0;
  for (let h = 0; h < 3; h++) retirees += t.people[person(STAGE_R, h)];
  const demand = n / 250 + retirees / 150;
  const capH = (cov ? cov.healthCap : 0) + flowsFor(m).sharedHealth;
  const capRatio = demand > 0 ? Math.min(1, capH / demand) : capH > 0 ? 1 : 0;
  const health = cov ? clamp(100 * capRatio * clamp(cov.healthCovered, 0, 1) * clamp(cov.healthQuality, 0, 1), 0, 100) : 0;

  const safety = fields ? clamp(fields.safety, 0, 100) : 100;
  const fun = clamp((cov ? cov.town[COV_FUN] : 0) + (cov?.funVenue ? sp.funVenue : 0) + policyPoints(t, S('fun')), 0, 100);
  const culture = (100 * t.culture) / (t.culture + sp.cultureHalf);
  const nature = clamp(100 - sp.nature[0] * t.ps - sp.nature[1] + sp.nature[2] * (cov ? cov.town[COV_NATURE] : 0) + policyPoints(t, S('nature')), 0, 100);

  // Getting around: the workforce-weighted mean commute.
  const travel = m.derived.travel;
  const lab = m.derived.labour;
  let commute = sp.commute[0];
  if (travel) {
    let w = 0;
    let c = 0;
    for (let h = 0; h < 3; h++) {
      const k = lab ? lab.workforce[h] : 1;
      w += k;
      c += k * travel.avgCommute[h];
    }
    commute = w > 0 ? c / w : (travel.avgCommute[0] + travel.avgCommute[1] + travel.avgCommute[2]) / 3;
  }
  const around = clamp(100 - sp.commute[1] * (commute - sp.commute[0]), 0, 100);
  const buzz = clamp(t.rep * (sp.buzz[0] + sp.buzz[1] * t.aw) + flowsFor(m).buzz + policyPoints(t, S('buzz')), 0, 100);
  return { schools, health, safety, fun, culture, nature, around, buzz };
}

/**
 * The household tax rate tier h feels, in homes-tax basis points: homes tax,
 * plus (from Town, where the dial exists) sales tax's distance from its
 * default, weighted by the tier's shop and leisure spending against the share
 * of income that goes on rent (stars.salesTaxRentShare). A shopper pays sales
 * tax as surely as a householder pays homes tax.
 */
export function householdTaxBp(t: TownState, h: number, p: MonthContext['params']): number {
  const homes = t.taxes.homes[h] ?? 0;
  if (t.tier < 2) return homes;
  const f = p.firms;
  const weight = ((f.retailShare[h] ?? 0) + (f.leisureShare[h] ?? 0)) / p.stars.salesTaxRentShare;
  return Math.max(0, homes + weight * (t.taxes.sales - p.finance.defaults.sales));
}

/** The Tax star for homes tax `bpRate` (basis points) at sensitivity `sens` (§5.6). */
export function taxStar(bpRate: number, sens: number, m: Pick<MonthContext, 'params'>): number {
  return clamp(100 - m.params.stars.taxSlope * (bpRate / 100 - 3) * sens, 0, 100);
}

export interface TownStars {
  /** Actual stars, STAR layout (residents' Jobs). */
  actual: number[];
  /** The movers' view, STAR layout (JobProspect for Jobs). */
  movers: number[];
}

/** All the stars (§5.6) from this month's blackboard. */
export function townStars(t: TownState, m: MonthContext): TownStars {
  const sp = m.params.stars;
  const lab = m.derived.labour ?? neutral.labour();
  const hs = housingOf(m);
  const b = baseStars(t, m);
  const actual = new Array<number>(STAR_COUNT).fill(0);
  const persons = [0, 1, 2].map((h) => tierPersons(t, h, true));
  const total = persons[0] + persons[1] + persons[2];
  const weighted = (xs: number[]) => (total > 0 ? (xs[0] * persons[0] + xs[1] * persons[1] + xs[2] * persons[2]) / total : (xs[0] + xs[1] + xs[2]) / 3);

  const jobs = [0, 0, 0];
  const prospect = [0, 0, 0];
  const homes = [0, 0, 0];
  const tax = [0, 0, 0];
  for (let h = 0; h < 3; h++) {
    const u = lab.workforce[h] > 0 ? lab.unemployed[h] / lab.workforce[h] : 0;
    jobs[h] = clamp(100 * (1 - u / sp.jobsU), 0, 100);
    prospect[h] = clamp(50 + 50 * T((lab.vacancies[h] - lab.unemployed[h]) / (sp.prospect[0] * lab.workforce[h] + sp.prospect[1])), 0, 100);
    const [share, homesMin] = m.params.housing.homesVacancy;
    homes[h] = clamp(hs.afford[h] * (0.5 + 0.5 * Math.min(1, hs.vacant[h] / (share * hs.cap[h] + homesMin))), 0, 100);
    tax[h] = taxStar(householdTaxBp(t, h, m.params), sp.taxSens[h], m);
    actual[starTier(0, h)] = jobs[h];
    actual[starTier(1, h)] = homes[h];
    actual[starTier(2, h)] = tax[h];
  }
  actual[STAR_JOBS] = weighted(jobs);
  actual[STAR_HOMES] = weighted(homes);
  actual[STAR_TAX] = weighted(tax);
  actual[S('schools')] = b.schools;
  actual[S('health')] = b.health;
  actual[S('safety')] = b.safety;
  actual[S('fun')] = b.fun;
  actual[S('culture')] = b.culture;
  actual[S('nature')] = b.nature;
  actual[S('around')] = b.around;
  actual[S('buzz')] = b.buzz;

  const movers = [...actual];
  for (let h = 0; h < 3; h++) movers[starTier(0, h)] = prospect[h];
  movers[STAR_JOBS] = weighted(prospect);
  return { actual, movers };
}

// ---- Needs ladders (§5.6) ---------------------------------------------------------------------

export interface NeedItem {
  id: string;
  /** The lowest wealth tier whose ladder includes it (ladders are cumulative). */
  tier: number;
  /** The town tier from which it can be built; before that it does not count as unmet. */
  unlock: number;
  /** Only Families need it (a school place). */
  families: boolean;
}

export const NEED_ITEMS: readonly NeedItem[] = [
  { id: 'water', tier: 0, unlock: 0, families: false },
  { id: 'power', tier: 0, unlock: 1, families: false },
  { id: 'shop', tier: 0, unlock: 0, families: false },
  { id: 'green', tier: 0, unlock: 0, families: false },
  { id: 'surgery', tier: 0, unlock: 1, families: false },
  { id: 'primary', tier: 0, unlock: 0, families: true },
  { id: 'busStop', tier: 0, unlock: 2, families: false },
  { id: 'secondary', tier: 1, unlock: 2, families: true },
  { id: 'police', tier: 1, unlock: 1, families: false },
  { id: 'highStreet', tier: 1, unlock: 1, families: false },
  { id: 'leisureVenue', tier: 1, unlock: 2, families: false },
  { id: 'library', tier: 1, unlock: 2, families: false },
  { id: 'cultureVenue', tier: 2, unlock: 2, families: false },
  { id: 'cleanAir', tier: 2, unlock: 0, families: false },
  { id: 'safeStreets', tier: 2, unlock: 0, families: false },
  { id: 'park', tier: 2, unlock: 1, families: false },
  { id: 'topJobs', tier: 2, unlock: 2, families: false },
  { id: 'restaurants', tier: 2, unlock: 2, families: false },
];

/** The items of tier h's ladder, in ladder order (indices into NEED_ITEMS). */
export function ladder(h: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < NEED_ITEMS.length; i++) if (NEED_ITEMS[i].tier <= h) out.push(i);
  return out;
}

/** NEED_ITEMS indices by id. */
const I = Object.fromEntries(NEED_ITEMS.map((it, i) => [it.id, i])) as Record<(typeof NEED_ITEMS)[number]['id'], number>;
const LADDERS = [ladder(0), ladder(1), ladder(2)];

/** Minutes thresholds of the time-based items (§5.6). */
const WITHIN = { shop: 10, highStreet: 15, leisureVenue: 15, cultureVenue: 20, topJobs: 30, restaurants: 10, highStreetTiles: 3 } as const;
const CLEAN_AIR = 40;
const SAFE_STREETS = 70;

const IDS = {
  greens: ['villageGreen', 'pocketPark', 'park', 'botanicGarden'].map(buildingIndex),
  parks: ['park', 'botanicGarden'].map(buildingIndex),
  leisure: ['cinema', 'swimmingPool', 'sportsPitches'].map(buildingIndex),
  culture: ['museum', 'theatre'].map(buildingIndex),
};

// Coverage-style items are read from per-cell bit masks (one pass over the
// buildings sets them all), time-based items from per-district minutes to the
// nearest district that has the thing, and both are then summed over the
// homes in a single pass.
const MASK_GREEN = 1;
const MASK_PARK = 2;
const MASK_HEALTH = 4;
const MASK_PRIMARY = 8;
const MASK_SECONDARY = 16;
const MASK_LIBRARY = 32;
const MASK_BUS = 64;
const MASK_POLICE = 128;
const N_CELLS_SIDE = CELLS_PER_SIDE;
const N_DISTRICTS = DISTRICTS;
const N_TILES = TILES;
const HERITAGE = MARK_HERITAGE;

/** Which masks a building kind sets (index = BUILDINGS index). */
const KIND_MASKS: readonly number[] = BUILDINGS.map((def, k) => {
  let bits = 0;
  if (IDS.greens.includes(k)) bits |= MASK_GREEN;
  if (IDS.parks.includes(k)) bits |= MASK_PARK;
  if (def.group === 'health') bits |= MASK_HEALTH;
  if (def.group === 'primary') bits |= MASK_PRIMARY;
  if (def.group === 'secondary') bits |= MASK_SECONDARY;
  if (def.group === 'library') bits |= MASK_LIBRARY;
  if ((def.cover?.transit ?? 0) > 0) bits |= MASK_BUS;
  if ((def.cover?.police ?? 0) > 0) bits |= MASK_POLICE;
  return bits;
});

/** Per cell, the MASK_* bits of every finished building that reaches it (Manhattan tiles from its centre ≤ its radius). */
function reachMasks(t: TownState, busy: Uint8Array): Uint8Array {
  const out = new Uint8Array(N_CELLS_SIDE * N_CELLS_SIDE);
  for (const b of t.buildings) {
    const bits = KIND_MASKS[b[B_KIND]] ?? 0;
    if (!bits || busy[tileIndex(b[B_X], b[B_Y])]) continue;
    const def = BUILDINGS[b[B_KIND]];
    const [w, h] = footprint(def.w, def.h, b[3]);
    // Work in half-tiles so the centre of a footprint and of a cell are both whole numbers.
    const cx2 = 2 * b[B_X] + w;
    const cy2 = 2 * b[B_Y] + h;
    const r2 = def.radius === Infinity ? 4 * MAP : 2 * def.radius;
    for (let cy = 0; cy < N_CELLS_SIDE; cy++) {
      const dy = Math.abs(4 * cy + 2 - cy2);
      if (dy > r2) continue;
      // dy + |4·cx + 2 − cx2| ≤ r2 is an interval of cx (the division by 4 is exact).
      const R = r2 - dy;
      const lo = Math.max(0, Math.ceil((cx2 - 2 - R) / 4));
      const hi = Math.min(N_CELLS_SIDE - 1, Math.floor((cx2 - 2 + R) / 4));
      for (let cx = lo; cx <= hi; cx++) out[cy * N_CELLS_SIDE + cx] |= bits;
    }
  }
  return out;
}

// District flags for the time-based items.
const D_SHOP = 0;
const D_LEISURE = 1;
const D_CULTURE = 2;
const D_TOPJOBS = 3;
const D_RESTAURANT = 4;
const D_KINDS = 5;

/** The needs ladders (§5.6, A10): met share per item per tier, Needs per cohort and tier, unmet counts. */
export function townNeeds(t: TownState, m: MonthContext): NeedsSlot {
  const np = m.params.stars;
  const util = m.derived.utilities;
  const fields = m.derived.fields;
  const cov = m.derived.coverage;
  const minutes = m.derived.travel ? m.derived.travel.minutes : null;
  const p = planesOf(t);
  const use = p.use;
  const lvl = p.lvl;
  const facts = tileFacts(t, m);
  const busy = facts.busy;
  const homes = facts.homes;

  // Where things are, by district.
  const flags = new Uint8Array(N_DISTRICTS);
  const highStreet = new Float64Array(N_DISTRICTS);
  for (let i = 0; i < N_TILES; i++) {
    const u = use[i];
    if (u >>> 12 !== CAT_ZONE || busy[i]) continue;
    const z = u & 0xfff;
    const level = lvl[i] & 7;
    if (z === Z_HOMES || level === 0) continue;
    const d = ((i >> 9) << 3) | ((i & 63) >> 3);
    if (z === Z_SHOPS) {
      flags[d] |= 1 << D_SHOP;
      if (level >= 2) highStreet[d] += 1;
    }
    if (z === Z_LEISURE && level >= 2 && ((lvl[i] >> 3) & 3) !== VARIANT_HOTEL) flags[d] |= 1 << D_RESTAURANT;
    if (level >= 3) flags[d] |= 1 << D_TOPJOBS; // the skill mix hires £££ from L3 (§3.3)
  }
  for (const b of t.buildings) {
    const at = tileIndex(b[B_X], b[B_Y]);
    if (busy[at]) continue;
    const def = BUILDINGS[b[B_KIND]];
    const d = districtOf(at);
    if (IDS.leisure.includes(b[B_KIND])) flags[d] |= 1 << D_LEISURE;
    if (IDS.culture.includes(b[B_KIND])) flags[d] |= 1 << D_CULTURE;
    if (def && def.tier >= 1 && def.staff > 0) flags[d] |= 1 << D_TOPJOBS;
  }
  // Minutes to the nearest district of each kind, and high-street tiles within 15 minutes.
  const near = new Float64Array(N_DISTRICTS * D_KINDS).fill(Infinity);
  const streets = new Float64Array(N_DISTRICTS);
  for (let a = 0; a < N_DISTRICTS; a++)
    for (let b = 0; b < N_DISTRICTS; b++) {
      const f = flags[b];
      if (!f && !highStreet[b]) continue;
      const mins = minutes ? minutes[a * N_DISTRICTS + b] : a === b ? 0 : Infinity;
      for (let k = 0; k < D_KINDS; k++) if (f & (1 << k) && mins < near[a * D_KINDS + k]) near[a * D_KINDS + k] = mins;
      if (highStreet[b] && mins <= WITHIN.highStreet) streets[a] += highStreet[b];
    }
  const university = hasBuilding(t, 'university');
  const masks = reachMasks(t, busy);
  const seatShare = (level: 'primary' | 'secondary') => (cov && cov.pupils[level] > 0 ? Math.min(1, cov.seats[level] / cov.pupils[level]) : 1);
  const priSeats = seatShare('primary');
  const secSeats = seatShare('secondary');
  const watered = util ? util.watered : null;
  const powered = util ? util.powered : null;
  const pollution = fields ? fields.pollution : null;
  const crime = fields ? fields.crime : null;

  // One pass over the homes: met value of every item, summed per tier (capacity-weighted;
  // occupancy is uniform within a tier) and over all homes.
  const items = NEED_ITEMS.length;
  const sums = new Float64Array(4 * items); // tiers 0–2, then all homes
  const weight = [0, 0, 0, 0];
  const v = new Float64Array(items);
  for (let k = 0; k < homes.count; k++) {
    const tile = homes.tile[k];
    const cell = ((tile >> 7) << 5) | ((tile & 63) >> 1); // cellOf for the 64-wide map
    const d = ((tile >> 9) << 3) | ((tile & 63) >> 3);
    const mk = masks[cell];
    const nd = d * D_KINDS;
    v[I.water] = watered ? watered[tile] : 1;
    v[I.power] = powered ? powered[tile] : 1;
    v[I.shop] = near[nd + D_SHOP] <= WITHIN.shop ? 1 : 0;
    v[I.green] = mk & MASK_GREEN ? 1 : 0;
    v[I.surgery] = mk & MASK_HEALTH ? 1 : 0;
    v[I.primary] = mk & MASK_PRIMARY ? priSeats : 0;
    v[I.busStop] = mk & MASK_BUS ? 1 : 0;
    v[I.secondary] = mk & MASK_SECONDARY ? secSeats : 0;
    v[I.police] = mk & MASK_POLICE ? 1 : 0;
    v[I.highStreet] = streets[d] >= WITHIN.highStreetTiles ? 1 : 0;
    v[I.leisureVenue] = near[nd + D_LEISURE] <= WITHIN.leisureVenue ? 1 : 0;
    v[I.library] = mk & MASK_LIBRARY ? 1 : 0;
    v[I.cultureVenue] = near[nd + D_CULTURE] <= WITHIN.cultureVenue ? 1 : 0;
    v[I.cleanAir] = pollution && pollution[cell] >= CLEAN_AIR ? 0 : 1;
    v[I.safeStreets] = crime && 100 - crime[cell] < SAFE_STREETS ? 0 : 1;
    v[I.park] = mk & MASK_PARK ? 1 : 0;
    v[I.topJobs] = university || near[nd + D_TOPJOBS] <= WITHIN.topJobs ? 1 : 0;
    v[I.restaurants] = near[nd + D_RESTAURANT] <= WITHIN.restaurants ? 1 : 0;
    const w = homes.persons[k];
    const h = homes.tier[k];
    weight[h] += w;
    weight[3] += w;
    for (let i = 0; i < items; i++) {
      sums[h * items + i] += w * v[i];
      sums[3 * items + i] += w * v[i];
    }
  }
  // A tier with no homes yet is judged on all homes, and a town with none at all on nothing (0).
  const share: number[][] = [[], [], []];
  for (let h = 0; h < 3; h++) {
    const row = weight[h] > 0 ? h : 3;
    for (let i = 0; i < items; i++) share[h][i] = weight[row] > 0 ? sums[row * items + i] / weight[row] : 0;
  }

  const available = (item: number) => t.tier >= NEED_ITEMS[item].unlock;
  const cohort = new Array<number>(COHORT_COUNT).fill(1);
  const ladderShares: number[][] = [[], [], []];
  const unmet = [0, 0, 0];
  const tier = [1, 1, 1];
  for (let h = 0; h < 3; h++) {
    const list = LADDERS[h];
    const families = t.people[person(STAGE_P, h)] > 0;
    for (const i of list) {
      ladderShares[h].push(available(i) ? share[h][i] : 1);
      if (available(i) && share[h][i] < np.needMet && (!NEED_ITEMS[i].families || families)) unmet[h]++;
    }
    for (let kind = 0; kind < 3; kind++) {
      let sum = 0;
      let n = 0;
      for (const i of list) {
        if (!available(i) || (NEED_ITEMS[i].families && kind !== 1)) continue;
        sum += share[h][i];
        n++;
      }
      cohort[h * 3 + kind] = n > 0 ? sum / n : 1;
    }
    const w = [t.people[person(STAGE_W, h)], t.people[person(STAGE_P, h)] + t.people[person(STAGE_C, h)], t.people[person(STAGE_R, h)]];
    const tw = w[0] + w[1] + w[2];
    tier[h] = tw > 0 ? (cohort[h * 3] * w[0] + cohort[h * 3 + 1] * w[1] + cohort[h * 3 + 2] * w[2]) / tw : (cohort[h * 3] + cohort[h * 3 + 1] + cohort[h * 3 + 2]) / 3;
  }
  // Students: the £ ladder without the school places.
  let sum = 0;
  let n = 0;
  for (const i of LADDERS[0]) {
    if (!available(i) || NEED_ITEMS[i].families) continue;
    sum += share[0][i];
    n++;
  }
  cohort[COHORT_S] = n > 0 ? sum / n : 1;
  return { tier, cohort, unmet, items: ladderShares };
}

// ---- Culture stock --------------------------------------------------------------------------

/** One month of the culture stock (§5.6): CS += Inflow − CS/τ. */
export function cultureInflow(t: TownState, m: MonthContext): number {
  const sp = m.params.stars;
  const fe = m.params.fields.fundEffect;
  const facts = tileFacts(t, m);
  const busy = facts.busy;
  let inflow = 0;
  for (const b of t.buildings) {
    const def = BUILDINGS[b[B_KIND]];
    if (!def?.culture || busy[tileIndex(b[B_X], b[B_Y])]) continue;
    inflow += def.culture * (fe[b[B_FUND]] ?? 1);
  }
  const p = planesOf(t);
  const use = p.use;
  const lvl = p.lvl;
  const age = p.age;
  const marks = facts.marks;
  const [perTile, oldAge, protectedMult] = sp.heritage;
  let heritage = 0;
  for (let i = 0; i < N_TILES; i++) {
    if (use[i] >>> 12 !== CAT_ZONE || (lvl[i] & 7) < 2 || age[i] < oldAge) continue;
    heritage += marks[i] & HERITAGE ? protectedMult : 1;
  }
  inflow += perTile * heritage;
  if (hasPolicy(t, 'greenEnergyPledge')) inflow += GREEN_CULTURE;
  // Diversity: 1 − Σ share² over the tiers.
  const n = [0, 1, 2].map((h) => tierPersons(t, h, true));
  const total = n[0] + n[1] + n[2];
  if (total > 0) {
    let sq = 0;
    for (const x of n) sq += (x / total) * (x / total);
    inflow += sp.diversity * (1 - sq);
  }
  return inflow;
}

// ---- U_happy (§5.15, A13) ----------------------------------------------------------------------

/**
 * The Σ w·(I − 50)/50 terms of a cohort's utility from STAR-layout stars,
 * plus the needs term, in weight order (11 stars then needs). Students use
 * the £ tier's Jobs and Homes and their own Tax sensitivity.
 */
export function utilityTerms(k: number, stars: readonly number[], needs: number, homesTaxL: number, m: Pick<MonthContext, 'params'>, taxWeightMin = 0): number[] {
  const w = m.params.migration.weights[k];
  const h = k === COHORT_S ? 0 : Math.floor(k / 3);
  const out = new Array<number>(STAR_TOWN + 1);
  for (let f = 0; f < STAR_TOWN; f++) {
    let star = stars[f];
    if (f === STAR_JOBS) star = stars[starTier(0, h)];
    else if (f === STAR_HOMES) star = stars[starTier(1, h)];
    else if (f === STAR_TAX) star = k === COHORT_S ? taxStar(homesTaxL, m.params.stars.taxSens[3], m) : stars[starTier(2, h)];
    const weight = f === STAR_TAX ? Math.max(w[f], taxWeightMin) : w[f];
    out[f] = (weight * (star - 50)) / 50;
  }
  out[STAR_TOWN] = w[STAR_TOWN] * (2 * needs - 1);
  return out;
}

export function sumTerms(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/** STEP M10 (WP2b): the culture stock, the stars, the needs ladders, perception and U_happy → derived.stars, derived.needs (+ t.perceived, t.culture). */
export function stepStars(t: TownState, m: MonthContext): void {
  const sp = m.params.stars;
  t.culture = Math.max(0, t.culture + cultureInflow(t, m) - t.culture / sp.cultureTau);
  const stars = townStars(t, m);
  const needs = townNeeds(t, m);

  // Perception (§5.6): what other towns' movers see. A11: the first month step starts it at the truth.
  if (t.tick <= 3) t.perceived = stars.movers.map((x) => clamp(x, 0, 100));
  else t.perceived = t.perceived.map((x, i) => clamp(smooth(x, stars.movers[i], sp.perceptionTau), 0, 100));

  // U_happy per cohort (A13): actual stars, the Tax weight at least 0.6, minus overcrowding, overqualification and irritation.
  const lab = m.derived.labour ?? neutral.labour();
  const squeezed = scratchOf(m).squeezed;
  const tour = m.derived.tourism;
  // Tourism Promotion's catch (§6.7): residents tire of visitors sooner.
  const irritationAt = m.params.tourism.irritationAt - (hasPolicy(t, 'tourismPromotion') ? m.params.tourism.promotionIrritation : 0);
  const irritate = tour && tour.visitorRatio > irritationAt ? Math.min(sp.irritation[1], sp.irritation[0] * (tour.visitorRatio - irritationAt)) / sp.happyGain : 0;
  const uHappy = new Array<number>(COHORT_COUNT).fill(0);
  for (let k = 0; k < COHORT_COUNT; k++) {
    const h = k === COHORT_S ? 0 : Math.floor(k / 3);
    const kind = k === COHORT_S ? 0 : k % 3;
    let u = sumTerms(utilityTerms(k, stars.actual, needs.cohort[k], t.taxes.homes[0] ?? 0, m, m.params.finance.taxHappyWeightMin));
    const persons = tierPersons(t, h, h === 0);
    let sq = 0;
    for (let j = 0; j < COHORT_COUNT; j++) if ((j === COHORT_S ? 0 : Math.floor(j / 3)) === h) sq += squeezed[j];
    u -= sp.overcrowding * (persons > 0 ? sq / persons : 0);
    if (kind === 0 || kind === 1) u -= sp.overqualified * (lab.workforce[h] > 0 ? lab.underemployed[h] / lab.workforce[h] : 0);
    if (kind === 1 || kind === 2) u -= irritate;
    uHappy[k] = u;
  }

  memoFor(t).needs = [...needs.cohort];
  const slot: StarsSlot = { actual: stars.actual, uHappy };
  m.derived.stars = slot;
  m.derived.needs = needs;
}

