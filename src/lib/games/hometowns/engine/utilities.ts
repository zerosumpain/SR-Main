// M2 Utilities (spec §3.5, §5.14). There are no wires and no pipes: a power
// grid is a connected road component with a power plant on it, and a water
// grid one with a water source. A lot or a building is on the component of
// its attachment road (the nearest road within reach, space.ts), so the
// player's road toy is also the utility network.
//
// Each grid compares supply with demand. If it falls short there is a
// brownout and tiles are cut in a fixed order: Industry, then Shops, Leisure
// and Farms, then Offices, then Homes farthest from a plant, and civic
// buildings last; within a class the farthest go first (then the higher
// tile). The County Road's component can instead buy its shortfall from
// Kingsport (the buyUtilities standing order, from Village), and any surplus
// there is sold to Kingsport. Money is not posted here: WP2d posts importCost
// and exportIncome in M13.
//
// Contract imports and exports (§5.14) need the day's contracts, which the
// snapshot does not carry yet (WP3); until it does, Kingsport is the only
// outside supplier.

import type { Params } from './params';
import { areaClass, modelOf, runFor, scratch, scratchI32, scratchU8, type SpaceModel, type SpaceRun } from './space';
import { MAP, TILES } from './tiles';
import { FUNDING_KEYS, Z_FARMS, Z_HOMES, Z_INDUSTRY, Z_OFFICES, type MonthContext, type TownState, type UtilitiesSlot } from './types';
import { calendarEvent } from './world';

/** Brownout classes in cut order (§3.5). */
export const CUT_INDUSTRY = 0;
export const CUT_SHOPS = 1;
export const CUT_OFFICES = 2;
export const CUT_HOMES = 3;
export const CUT_CIVIC = 4;

/**
 * The things that draw power or water, as parallel arrays: every completed
 * zoned tile (one tile each), then every active civic building (its
 * footprint). Suppliers (plants and water sources) are kept apart.
 */
interface Units {
  n: number;
  /** First tile (zoned units) or −1 − building list index (civic units). */
  tile: Int32Array;
  attach: Int32Array;
  comp: Int32Array;
  power: Float64Array;
  water: Float64Array;
  cut: Uint8Array;
  /** Footprints of civic units, by −1 − tile. */
  civicTiles: number[][];
}

interface Plant {
  attach: number;
  comp: number;
  power: number;
  water: number;
  tiles: number[];
}

function cutClass(zone: number): number {
  if (zone === Z_INDUSTRY) return CUT_INDUSTRY;
  if (zone === Z_OFFICES) return CUT_OFFICES;
  if (zone === Z_HOMES) return CUT_HOMES;
  return CUT_SHOPS; // Shops, Leisure and Farms
}

function unitsOf(t: TownState, model: SpaceModel, p: Params, winter: boolean): { units: Units; plants: Plant[] } {
  const u = p.utilities;
  const net = model.net;
  const winterF = winter ? u.winterPower : 1;
  const cap = TILES + model.buildings.length;
  const units: Units = {
    n: 0,
    tile: scratchI32('ut.tile', cap),
    attach: scratchI32('ut.attach', cap),
    comp: scratchI32('ut.comp', cap),
    power: scratch('ut.power', cap),
    water: scratch('ut.water', cap),
    cut: scratchU8('ut.cut', cap),
    civicTiles: [],
  };
  let n = 0;
  for (let i = 0; i < TILES; i++) {
    if (model.level[i] === 0) continue;
    const z = model.zone[i];
    let power: number;
    let water: number;
    if (z === Z_HOMES) {
      power = model.res[i] * u.powerPerResident;
      water = model.res[i] * u.waterPerResident;
    } else {
      const j = model.jobs[i];
      power = z === Z_INDUSTRY ? j * u.powerPerIndustryJob : z === Z_FARMS ? 0 : j * u.powerPerJob;
      water = z === Z_INDUSTRY ? j * u.waterPerIndustryJob : j * u.waterPerJob;
    }
    const a = net.attach[i];
    units.tile[n] = i;
    units.attach[n] = a;
    units.comp[n] = a >= 0 ? net.comp[a] : -1;
    units.power[n] = power * winterF;
    units.water[n] = water;
    units.cut[n] = cutClass(z);
    n++;
  }
  const plants: Plant[] = [];
  const plantFund = Math.min(1, p.fields.fundEffect[t.funding[FUNDING_KEYS.indexOf('utilities')] ?? 1] ?? 1);
  for (const b of model.buildings) {
    if (!b.active) continue;
    const comp = b.attach >= 0 ? net.comp[b.attach] : -1;
    const sup = b.def.supply;
    if (sup) {
      const mult = b.def.siteMult && b.def.siteMult.sites.includes(t.siteKind) ? b.def.siteMult.supply : 1;
      const f = mult * (b.def.staff > 0 ? b.staffFill : 1) * plantFund;
      plants.push({ attach: b.attach, comp, power: (sup.power ?? 0) * f, water: (sup.water ?? 0) * f, tiles: b.tiles });
      continue;
    }
    const cls = areaClass(b.w * b.h);
    units.tile[n] = -1 - units.civicTiles.length;
    units.civicTiles.push(b.tiles);
    units.attach[n] = b.attach;
    units.comp[n] = comp;
    units.power[n] = u.civicPower[cls] * winterF;
    units.water[n] = u.civicWater[cls] + b.staffNeeded * u.waterPerJob;
    units.cut[n] = CUT_CIVIC;
    n++;
  }
  units.n = n;
  return { units, plants };
}

/** Road distance (tiles) from the nearest plant's attachment road, within each component. */
function plantDistances(model: SpaceModel, plants: Plant[], which: 'power' | 'water'): Int32Array {
  const kind = model.net.kind;
  const dist = new Int32Array(TILES).fill(-1);
  const queue = new Int32Array(TILES);
  let head = 0;
  let tail = 0;
  for (const pl of plants) {
    if (pl[which] <= 0 || pl.attach < 0 || dist[pl.attach] === 0) continue;
    dist[pl.attach] = 0;
    queue[tail++] = pl.attach;
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % MAP;
    const di = dist[i] + 1;
    if (i >= MAP && kind[i - MAP] >= 0 && dist[i - MAP] < 0) {
      dist[i - MAP] = di;
      queue[tail++] = i - MAP;
    }
    if (x > 0 && kind[i - 1] >= 0 && dist[i - 1] < 0) {
      dist[i - 1] = di;
      queue[tail++] = i - 1;
    }
    if (x < MAP - 1 && kind[i + 1] >= 0 && dist[i + 1] < 0) {
      dist[i + 1] = di;
      queue[tail++] = i + 1;
    }
    if (i < TILES - MAP && kind[i + MAP] >= 0 && dist[i + MAP] < 0) {
      dist[i + MAP] = di;
      queue[tail++] = i + MAP;
    }
  }
  return dist;
}

interface GridResult {
  flags: Uint8Array;
  supply: number;
  demand: number;
  imported: number;
  exported: number;
  cut: Uint8Array;
}

/** Serves one utility over every grid: flags, cuts, imports and exports. */
function serve(model: SpaceModel, units: Units, plants: Plant[], which: 'power' | 'water', canImport: boolean): GridResult {
  const net = model.net;
  const C = net.comps;
  const supplyC = new Float64Array(C);
  const demandC = new Float64Array(C);
  const need = which === 'power' ? units.power : units.water;
  const N = units.n;
  let supply = 0;
  let demand = 0;
  // A plant off the road network serves nobody, so supply counts plants on a component.
  for (const pl of plants) {
    if (pl.comp < 0) continue;
    supply += pl[which];
    supplyC[pl.comp] += pl[which];
  }
  for (let k = 0; k < N; k++) {
    demand += need[k];
    if (units.comp[k] >= 0) demandC[units.comp[k]] += need[k];
  }
  const kc = net.kingsportComp;
  const live = new Uint8Array(C);
  for (let c = 0; c < C; c++) if (supplyC[c] > 0 || (c === kc && canImport)) live[c] = 1;
  let imported = 0;
  let exported = 0;
  const cut = new Uint8Array(N);
  let dist: Int32Array | null = null;
  for (let c = 0; c < C; c++) {
    if (!live[c]) continue;
    const short = demandC[c] - supplyC[c];
    if (c === kc && short < 0) exported += -short;
    if (short <= 0) continue;
    if (c === kc && canImport) {
      imported += short;
      continue;
    }
    // Brownout: cut in class order, farthest from a plant first, then the higher tile.
    if (!dist) dist = plantDistances(model, plants, which);
    const d = dist;
    const idx: number[] = [];
    for (let k = 0; k < N; k++) if (units.comp[k] === c && need[k] > 0) idx.push(k);
    const far = (k: number) => (units.attach[k] >= 0 ? d[units.attach[k]] : 0);
    const first = (k: number) => (units.tile[k] >= 0 ? units.tile[k] : units.civicTiles[-1 - units.tile[k]][0]);
    idx.sort((a, b) => units.cut[a] - units.cut[b] || far(b) - far(a) || first(b) - first(a));
    let over = short;
    for (const k of idx) {
      if (over <= 1e-9) break;
      cut[k] = 1;
      over -= need[k];
    }
  }
  // Flags: every tile attached to a live grid (empty lots included: they would be served), then the cut units cleared.
  const flags = new Uint8Array(TILES);
  const attach = net.attach;
  const comp = net.comp;
  for (let i = 0; i < TILES; i++) {
    const a = attach[i];
    if (a >= 0 && live[comp[a]]) flags[i] = 1;
  }
  for (const pl of plants) if (pl.comp >= 0 && live[pl.comp]) for (const ti of pl.tiles) flags[ti] = 1;
  for (let k = 0; k < N; k++) {
    const on = units.comp[k] >= 0 && live[units.comp[k]] && !cut[k] ? 1 : 0;
    const tile = units.tile[k];
    if (tile >= 0) flags[tile] = on;
    else for (const ti of units.civicTiles[-1 - tile]) flags[ti] = on;
  }
  return { flags, supply, demand, imported, exported, cut };
}

/** Is the auto-import standing order on and unlocked (§3.5: on by default from Village)? */
export function autoImport(t: TownState, p: Params): boolean {
  if (t.tier < p.utilities.importFromTier) return false;
  for (const o of t.orders) if (o.kind === 'buyUtilities') return o.on;
  return true;
}

/** M2 for one run: computed from stored state (and memoised on the run). */
export function utilitiesOf(run: SpaceRun): UtilitiesSlot {
  if (run.utilities) return run.utilities as UtilitiesSlot;
  const { t, p, ctx } = run;
  const model = modelOf(run);
  const winter = calendarEvent(ctx.world.event, ctx.calendarMonth)?.id === 'cosyWinter';
  const { units, plants } = unitsOf(t, model, p, winter);
  const imp = autoImport(t, p);
  const pw = serve(model, units, plants, 'power', imp);
  const wt = serve(model, units, plants, 'water', imp);
  let cutTiles = 0;
  for (let k = 0; k < units.n; k++) if (pw.cut[k] || wt.cut[k]) cutTiles += units.tile[k] >= 0 ? 1 : units.civicTiles[-1 - units.tile[k]].length;
  let built = 0;
  let powered = 0;
  let watered = 0;
  for (let i = 0; i < TILES; i++) {
    if (model.level[i] === 0) continue;
    built++;
    powered += pw.flags[i];
    watered += wt.flags[i];
  }
  const u = p.utilities;
  const slot: UtilitiesSlot = {
    powered: pw.flags,
    watered: wt.flags,
    powerSupply: pw.supply,
    powerDemand: pw.demand,
    waterSupply: wt.supply,
    waterDemand: wt.demand,
    powerImported: pw.imported,
    waterImported: wt.imported,
    powerExported: pw.exported,
    waterExported: wt.exported,
    importCost: pw.imported * u.importPower + wt.imported * u.importWater,
    exportIncome: pw.exported * u.exportPower + wt.exported * u.exportWater,
    cutTiles,
    poweredShare: built > 0 ? powered / built : 1,
    wateredShare: built > 0 ? watered / built : 1,
  };
  run.utilities = slot;
  return slot;
}

/** M2 Utilities → derived.utilities. */
export function stepUtilities(t: TownState, m: MonthContext): void {
  m.derived.utilities = utilitiesOf(runFor(t, m, m.derived));
}
