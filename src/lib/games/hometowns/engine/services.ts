// Services and coverage (spec §5.4, §6.3–§6.5, A14, A41). Every civic
// building spreads its strength over the 32×32 cells with the §5.4 falloff,
// scaled by how well it is run:
//
//   eff = fundEffect · staffFill · (powered ? 1 : ½) · (road ? 1 : ½) · min(1, Cap / Demand)
//
// where Demand is what the people inside its radius ask of it: residents for
// police and fire, beds for health (N/250 + N_R/150), primary or secondary
// pupils for schools. An overcrowded school therefore shows as faded
// coverage, which makes placement puzzles without agents. This file also
// owns the service numbers other packages read (A41): seats and pupils,
// EduQ per level, health capacity and quality, the library share, and staff
// demand per building and tier (A2: Hamlet-tier buildings hire £ only).
//
// Units: radii are in tiles (the catalogue's), distances in cells between
// centres, so a radius r covers fully to r/4 cells and fades out at r/2.
// Health capacity is in beds of 250 people, which is what the Health star's
// Cap/(N/250 + N_R/150) compares.

import { utilitiesOf } from './utilities';
import { cellBox, cellDistance, falloff, modelOf, scratch, type BuildingInfo, type SpaceRun } from './space';
import { CELLS, CELLS_PER_SIDE, TILES, cellOf } from './tiles';
import { T_FOREST, T_WATER, terrainKind } from './terrain';
import { flowsFor } from './core';
import { COVERAGES, FUNDING_KEYS, type CoverageKind, type CoverageSlot } from './types';

export const COV: Record<CoverageKind, number> = { police: 0, fire: 1, health: 2, school: 3, fun: 4, culture: 5, nature: 6, transit: 7 };

export interface Services {
  slot: CoverageSlot;
  /** Transit coverage per cell from bus stops (with a working depot) and from rail stations. */
  bus: Float64Array;
  rail: Float64Array;
  /** Youth Club reach per cell, 0–1 (crime pressure × (1 − 0.2·youth), §6.5). */
  youth: Float64Array;
  /** Landmark land-value bonus per cell. */
  lvBonus: Float64Array;
  /** Park tiles and tree (forest terrain) tiles per cell (pollution absorption). */
  parkTiles: Float64Array;
  trees: Float64Array;
}

const PARK_GROUP = 'park';

/**
 * A weighted Manhattan blur over cells: out[c] = Σ_{d(c, c') ≤ reach} w[c']·(1 − d/(reach + 1)).
 * The nature terms (trees, water, parks within 3 cells, linear falloff).
 */
export function diamondBlur(w: Float64Array, reach: number): Float64Array {
  const out = new Float64Array(CELLS);
  for (let c = 0; c < CELLS; c++) {
    const v = w[c];
    if (v === 0) continue;
    const cx = c % CELLS_PER_SIDE;
    const cy = (c - cx) / CELLS_PER_SIDE;
    for (let dy = -reach; dy <= reach; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= CELLS_PER_SIDE) continue;
      const ay = dy < 0 ? -dy : dy;
      for (let dx = -(reach - ay); dx <= reach - ay; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= CELLS_PER_SIDE) continue;
        const d = ay + (dx < 0 ? -dx : dx);
        out[yy * CELLS_PER_SIDE + xx] += v * (1 - d / (reach + 1));
      }
    }
  }
  return out;
}

const TERRAIN_NATURE = new WeakMap<Uint8Array, { key: string; nature: Float64Array; trees: Float64Array }>();

/** Nature from terrain alone (trees and water within reach) and tree tiles per cell, memoised per terrain plane. */
export function terrainNature(terrain: Uint8Array, tree: number, water: number, reach: number): { nature: Float64Array; trees: Float64Array } {
  const key = `${tree}:${water}:${reach}`;
  const hit = TERRAIN_NATURE.get(terrain);
  if (hit && hit.key === key) return hit;
  const w = new Float64Array(CELLS);
  const trees = new Float64Array(CELLS);
  for (let i = 0; i < TILES; i++) {
    const k = terrainKind(terrain[i]);
    if (k === T_FOREST) {
      w[cellOf(i)] += tree;
      trees[cellOf(i)] += 1;
    } else if (k === T_WATER) w[cellOf(i)] += water;
  }
  const out = { key, nature: diamondBlur(w, reach), trees };
  TERRAIN_NATURE.set(terrain, out);
  return out;
}

/** What the people within a building's radius ask of it, in its capacity's units, or 0 for no capacity rule. */
function demandWithin(run: SpaceRun, b: BuildingInfo): { cap: number; demand: number } {
  const def = b.def;
  const group = def.group;
  const m = modelOf(run);
  const p = run.p;
  const isSchool = group === 'primary' || group === 'secondary';
  const isHealth = group === 'health';
  const hasCap = isSchool ? (def.seats ?? 0) > 0 : (group === 'police' || group === 'fire' || isHealth) && (def.capacity ?? 0) > 0;
  if (!hasCap) return { cap: 0, demand: 0 };
  let res = 0;
  let kids = 0;
  let ret = 0;
  const r = def.radius / 2;
  const [x0, x1, y0, y1] = cellBox(b.cx, b.cy, def.radius);
  for (let cy = y0; cy <= y1; cy++)
    for (let cx = x0; cx <= x1; cx++) {
      const c = cy * CELLS_PER_SIDE + cx;
      if (m.cellRes[c] === 0) continue;
      if (r !== Infinity && cellDistance(c, b.cx, b.cy) > r) continue;
      res += m.cellRes[c];
      kids += m.cellChildren[c];
      ret += m.cellRetired[c];
    }
  const sec = p.people.secondaryShare;
  if (group === 'primary') return { cap: def.seats ?? 0, demand: kids * (1 - sec) };
  if (group === 'secondary') return { cap: def.seats ?? 0, demand: kids * sec };
  if (isHealth) return { cap: (def.capacity ?? 0) / p.fields.healthPerBed, demand: res / p.fields.healthPerBed + ret / p.fields.healthPerBedRetired };
  return { cap: def.capacity ?? 0, demand: res };
}

/** Share of `weights` (per cell) reached by the given buildings, each cell counting min(1, Σ falloff) (or inside-radius with `binary`). */
function reachShare(buildings: BuildingInfo[], weights: Float64Array, binary = false): number {
  if (buildings.length === 0) return 0;
  const f = scratch('sv.reach', CELLS);
  for (const b of buildings) {
    const radius = b.def.radius;
    const [x0, x1, y0, y1] = cellBox(b.cx, b.cy, radius);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * CELLS_PER_SIDE + cx;
        if (weights[c] === 0) continue;
        const d = cellDistance(c, b.cx, b.cy);
        f[c] += binary ? (radius === Infinity || d <= radius / 2 ? 1 : 0) : falloff(d, radius);
      }
  }
  let tot = 0;
  let got = 0;
  for (let c = 0; c < CELLS; c++) {
    const w = weights[c];
    if (w === 0) continue;
    tot += w;
    got += w * (f[c] < 1 ? f[c] : 1);
  }
  return tot > 0 ? got / tot : 1;
}

/**
 * Adds one building's strengths over the cells in its reach with the §5.4
 * falloff (its own small function, so the engine inlines the distance and
 * falloff into the loop): coverage arrays, a landmark's land-value bonus, a
 * Youth Club's reach, and culture over the culture radius.
 */
function spreadBuilding(
  px: number,
  py: number,
  radius: number,
  cRadius: number,
  arrs: Float64Array[],
  strengths: number[],
  lvBonusS: number,
  lvBonus: Float64Array,
  youthS: number,
  youth: Float64Array,
  cultureS: number,
  culture: Float64Array,
): void {
  const nArr = arrs.length;
  const reach = Math.max(radius > 0 ? radius : 0, cultureS > 0 ? cRadius : 0) / 2;
  const [x0, x1, y0, y1] = cellBox(px, py, 2 * reach);
  for (let cy = y0; cy <= y1; cy++)
    for (let cx = x0; cx <= x1; cx++) {
      const c = cy * CELLS_PER_SIDE + cx;
      const d = cellDistance(c, px, py);
      if (d >= reach) continue;
      const fall = radius > 0 ? falloff(d, radius) : 0;
      if (fall > 0) {
        for (let k = 0; k < nArr; k++) arrs[k][c] += strengths[k] * fall;
        if (lvBonusS > 0) lvBonus[c] += lvBonusS * fall;
        if (youthS > 0) youth[c] += youthS * fall;
      }
      if (cultureS > 0) {
        const cf = falloff(d, cRadius);
        if (cf > 0) culture[c] += cultureS * cf;
      }
    }
}

/** Seat-weighted quality of a school level × the education dial, capped at 1; and effective seats. */
function schoolQuality(list: BuildingInfo[], fund: number): { seats: number; effSeats: number; q: number } {
  let seats = 0;
  let eff = 0;
  let qs = 0;
  for (const b of list) {
    const s = b.def.seats ?? 0;
    seats += s;
    eff += s * b.staffFill;
    qs += s * (b.def.quality ?? 1);
  }
  const q = seats > 0 ? Math.min(1, (qs / seats) * fund) : 0;
  return { seats, effSeats: eff, q };
}

/** M3's coverage and service numbers for one run (memoised on it). */
export function servicesOf(run: SpaceRun): Services {
  if (run.services) return run.services as Services;
  const { t, p } = run;
  const m = modelOf(run);
  const util = run.derived?.utilities ?? utilitiesOf(run);
  const f = p.fields;
  const cov = COVERAGES.map(() => new Float64Array(CELLS));
  // Scratch where only this month's own steps read them (the published coverage arrays are fresh).
  const bus = scratch('sv.bus', CELLS);
  const rail = scratch('sv.rail', CELLS);
  const youth = scratch('sv.youth', CELLS);
  const lvBonus = new Float64Array(CELLS);
  const parkW = scratch('sv.parkW', CELLS);
  const parkTiles = scratch('sv.parkTiles', CELLS);
  const effect = new Float64Array(t.buildings.length);
  const staffNeeded = new Array<number>(t.buildings.length).fill(0);
  const staffDemand = [0, 0, 0];
  const busDepot = m.buildings.some((b) => b.active && b.def.id === 'busDepot');
  const cultureIndex = (100 * t.culture) / (t.culture + p.stars.cultureHalf);
  const primary: BuildingInfo[] = [];
  const secondary: BuildingInfo[] = [];
  const libraries: BuildingInfo[] = [];
  const health: BuildingInfo[] = [];
  let university: BuildingInfo | null = null;
  let healthBeds = 0;
  let qSum = 0;
  let funVenue = false;

  const cul0 = cov[COV.culture];
  for (const b of m.buildings) {
    const def = b.def;
    if (b.complete) {
      staffNeeded[b.index] = b.staffNeeded;
      for (let h = 0; h < 3; h++) staffDemand[h] += b.staffNeeded * b.staffMix[h];
    }
    if (!b.active) continue;
    const powered = util.powered[b.anchor] === 1;
    const run1 = b.fundEffect * (powered ? 1 : f.unpoweredEffect) * (b.attach >= 0 ? 1 : f.noRoadEffect);
    const { cap, demand } = demandWithin(run, b);
    const capRatio = cap > 0 && demand > 0 ? Math.min(1, cap / demand) : 1;
    effect[b.index] = run1 * capRatio;
    const eff = run1 * capRatio * b.staffFill;
    const g = def.group;
    if (g === 'primary') primary.push(b);
    else if (g === 'secondary') secondary.push(b);
    else if (g === 'library') libraries.push(b);
    else if (g === 'university') university = b;
    if (g === 'health') {
      health.push(b);
      healthBeds += ((def.capacity ?? 0) / f.healthPerBed) * b.staffFill;
      qSum += (def.cover?.health ?? 0) / 85;
    }
    if (def.id === 'cinema' || def.id === 'stadium') funVenue = true;
    if (g === PARK_GROUP)
      for (const ti of b.tiles) {
        parkW[cellOf(ti)] += f.naturePark;
        parkTiles[cellOf(ti)] += 1;
      }
    const arrs: Float64Array[] = [];
    const strengths: number[] = [];
    if (def.cover && !(def.id === 'busStop' && !busDepot))
      for (const k of COVERAGES) {
        const v = def.cover[k];
        if (!v) continue;
        arrs.push(k === 'transit' ? (def.id === 'busStop' ? bus : rail) : cov[COV[k]]);
        strengths.push(v * eff);
      }
    const nArr = arrs.length;
    const culture = def.culture ?? 0;
    const radius = def.radius;
    const youthClub = g === 'youth';
    if (nArr === 0 && culture <= 0 && !def.lvBonus && !youthClub) continue;
    const cRadius = radius > 0 ? radius : f.cultureRadius;
    spreadBuilding(
      b.cx,
      b.cy,
      radius,
      cRadius,
      arrs,
      strengths,
      def.lvBonus ? def.lvBonus * run1 : 0,
      lvBonus,
      youthClub ? eff : 0,
      youth,
      culture > 0 ? f.cultureVenue * culture * eff : 0,
      cul0,
    );
  }

  // Nature: terrain trees and water, park tiles, and the buildings' own nature strength.
  const tn = terrainNature(m.terrain, f.natureTree, f.natureWater, f.natureReach);
  const parks = diamondBlur(parkW, f.natureReach);
  const nat = cov[COV.nature];
  const cul = cov[COV.culture];
  const tr = cov[COV.transit];
  const tnNature = tn.nature;
  const fromStock = p.fields.cultureFromStock * cultureIndex;
  for (let c = 0; c < CELLS; c++) {
    nat[c] += tnNature[c] + parks[c];
    cul[c] += fromStock;
    tr[c] = bus[c] + rail[c];
    if (youth[c] > 1) youth[c] = 1;
  }
  // Each cell's clamp follows its own updates above, so clamping array by array is the same.
  for (let k = 0; k < cov.length; k++) {
    const a = cov[k];
    for (let c = 0; c < CELLS; c++) {
      const v = a[c];
      a[c] = v > 100 ? 100 : v < 0 ? 0 : v;
    }
  }

  // Population-weighted town coverage.
  const town = new Array<number>(COVERAGES.length).fill(0);
  const pc = m.popCells;
  const cellRes = m.cellRes;
  let resT = 0;
  for (let j = 0; j < pc.length; j++) resT += cellRes[pc[j]];
  if (resT > 0)
    for (let k = 0; k < cov.length; k++) {
      const a = cov[k];
      let s = 0;
      for (let j = 0; j < pc.length; j++) {
        const c = pc[j];
        s += cellRes[c] * a[c];
      }
      town[k] = s / resT;
    }

  // Seats, pupils and EduQ (§4.4): min(1, seats/pupils) · coverage share of Family homes · quality × the dial.
  const eduFund = p.fields.fundEffect[t.funding[FUNDING_KEYS.indexOf('education')] ?? 1] ?? 1;
  const sec = p.people.secondaryShare;
  const pupils = { primary: m.children * (1 - sec), secondary: m.children * sec, university: m.students };
  const families = m.cellFamilies;
  const eduQ = [0, 0, 0];
  const pri = schoolQuality(primary, eduFund);
  const sc = schoolQuality(secondary, eduFund);
  const ratio = (eff: number, n: number, seats: number) => (n > 0 ? Math.min(1, eff / n) : seats > 0 ? 1 : 0);
  eduQ[0] = ratio(pri.effSeats, pupils.primary, pri.seats) * reachShare(primary, families) * pri.q;
  eduQ[1] = ratio(sc.effSeats, pupils.secondary, sc.seats) * reachShare(secondary, families) * sc.q;
  const flows = flowsFor(run.ctx);
  const uni = university as BuildingInfo | null;
  let uniSeats = 0;
  if (uni) {
    const u = schoolQuality([uni], eduFund);
    uniSeats = u.seats;
    eduQ[2] = ratio(u.effSeats, pupils.university, u.seats) * u.q;
  }
  if (flows.sharedUniversity > 0) eduQ[2] = Math.max(eduQ[2], Math.min(1, flows.sharedUniversity / Math.max(1, 0.1 * m.children)));

  const slot: CoverageSlot = {
    cov,
    town,
    seats: { primary: pri.seats, secondary: sc.seats, university: uniSeats },
    pupils,
    healthCap: healthBeds + flows.sharedHealth / f.healthPerBed,
    eduQ,
    libraryShare: libraries.length ? reachShare(libraries, m.cellRes, true) : 0,
    healthCovered: health.length ? reachShare(health, m.cellRes) : 0,
    healthQuality: health.length ? qSum / health.length : 0,
    funVenue,
    staffDemand,
    effect,
    staffNeeded,
  };
  const out: Services = { slot, bus, rail, youth, lvBonus, parkTiles, trees: tn.trees };
  run.services = out;
  return out;
}
