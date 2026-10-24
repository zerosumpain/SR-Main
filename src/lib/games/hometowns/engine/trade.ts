// The market, town side (WP2c, spec §5.12 with A7 and A8): what residents,
// in-commuters, linked towns' shoppers and visitors spend here (M7b), and
// where the town's goods and food go.
//
// Two goods are traded, Goods and Food. Each month a town makes them
// (industry and farm staff) and uses them (shop and leisure stock, and
// construction). A8 fixes who sells first: local output serves local use at
// the county price with no shipping; then it fills the day's allocations to
// linked towns; then the town tops up a small stock; only what is left goes
// to Kingsport, at an export price that rewards good freight. A buyer short of
// local supply takes its allocations, then its stock, then imports from
// Kingsport at the dear end of the band. The county price sits inside
// Kingsport's band, so trading inside the family beats Kingsport for both
// sides. No money moves here: firms' takings are private, and the town's
// share of them is the tax WP2d collects from these slots.
//
// The helpers below are shared with business.ts (M8), which values each
// sector's takings with the same sale order, and with tourism.ts.

import { ZONE_DEFS, buildingIndex } from './content';
import { flowsFor } from './core';
import { clamp, smooth } from './fx';
import { neutral } from './derived';
import { B_KIND, B_X, B_Y, CAT_ZONE, TILES, cellOf, constructionLeft, decodeCells, lvlLevel, pairPlane, planesOf, tileIndex, useCat, usePayload, zonedTiles } from './tiles';
import {
  SECTOR_COUNT,
  ZONE_SECTOR,
  Z_FARMS,
  Z_HOMES,
  type Allocation,
  type DerivedCache,
  type GoodsSlot,
  type MarketMemo,
  type MonthContext,
  type SpendSlot,
  type TownState,
} from './types';

export const GOOD = 0;
export const FOOD = 1;
const GOOD_NAMES = ['goods', 'food'] as const;

/** SECTOR indices (types.ts SECTORS order). */
export const S_FARMS = 0;
export const S_INDUSTRY = 1;
export const S_SHOPS = 2;
export const S_LEISURE = 3;
export const S_OFFICES = 4;

// ---- Small shared helpers -----------------------------------------------------------------

/** The town's market memo, created on first use (absent on a town that never ran a WP2c month). */
export function memoOf(t: TownState): MarketMemo {
  if (!t.marketMemo)
    t.marketMemo = { surplus: [0, 0], lowMonths: new Array<number>(SECTOR_COUNT).fill(0), sat: 60, visitors: 0, bedDemand: 0, attrQ: 0, pull: 0, shopAppeal: 0 };
  return t.marketMemo;
}

export function policyOn(t: TownState, card: string): boolean {
  for (const a of t.policies) if (a.card === card) return true;
  return false;
}

export function eventIs(m: MonthContext, id: string): boolean {
  return m.world.event?.id === id;
}

const FREIGHT_YARD = buildingIndex('freightYard');
const RAIL_STATION = buildingIndex('railStation');
const HARBOUR = buildingIndex('harbour');

function hasFinished(t: TownState, kind: number): boolean {
  for (const b of t.buildings) if (b[B_KIND] === kind && constructionLeft(t, tileIndex(b[B_X], b[B_Y])) === 0) return true;
  return false;
}

/**
 * FreightScore (§5.4): the County Road, plus a rail freight yard on a line,
 * a harbour, a river barge and Flatland, capped. Only the export price reads
 * it here; WP2a's freight field uses the same terms.
 */
export function freightScore(t: TownState, m: MonthContext): number {
  const [road, rail, harbour, river, flat, cap] = m.params.fields.freightScore;
  let s = road;
  if (hasFinished(t, FREIGHT_YARD) && hasFinished(t, RAIL_STATION)) s += rail;
  if (hasFinished(t, HARBOUR)) s += harbour;
  if (t.siteKind === 'river') s += river;
  if (t.siteKind === 'flatland') s += flat;
  return s > cap ? cap : s;
}

// ---- Prices ---------------------------------------------------------------------------------

export interface Prices {
  /** £ per unit at the county price (inside Kingsport's band), Kingsport's export and import prices, and the reference value at index 1.0. */
  county: number[];
  exportP: number[];
  importP: number[];
  unit: number[];
}

/**
 * This month's prices per [goods, food]. Kingsport buys goods at
 * £1,000·World_goods·(0.80 + 0.12·FreightScore) and sells at ×1.25; food's
 * band is £48–£75 (A7). The county index comes from the snapshot and is
 * clamped into the band, so a World move inside the day never leaves it
 * outside.
 */
export function pricesOf(t: TownState, m: MonthContext): Prices {
  const f = m.params.firms;
  const wg = m.world.goods;
  const harvest = eventIs(m, 'bumperHarvest') ? f.bumperHarvest : 1;
  const eg = f.goodsUnit * wg * (f.exportPrice[0] + f.exportPrice[1] * freightScore(t, m));
  const ig = f.goodsUnit * wg * f.goodsImport;
  const ef = f.foodBand[0] * wg * harvest;
  const iF = f.foodBand[1] * wg * harvest;
  const pg = clamp(f.goodsUnit * m.snapshot.prices.goods, eg, ig);
  const pf = clamp(f.foodUnit * m.snapshot.prices.food * harvest, ef, iF);
  return { county: [pg, pf], exportP: [eg, ef], importP: [ig, iF], unit: [f.goodsUnit, f.foodUnit] };
}

// ---- The sale order (A8) ----------------------------------------------------------------------

export interface Leg {
  /** Index into the snapshot's allocations. */
  index: number;
  units: number;
  price: number;
}

export interface Settlement {
  /** Own output used locally, shipped per out-leg (same order), into stock, and exported. */
  local: number;
  shipped: number[];
  toStock: number;
  exported: number;
  /** Units received per in-leg (all of it: Kingsport covers a short seller at once, §5.12). */
  received: number[];
  fromStock: number;
  imported: number;
  /** £ the town's producers took, and £ the town's buyers paid for what they used. */
  revenue: number;
  inputCost: number;
  stockAfter: number;
}

/**
 * Settles one good for a month in the A8 order. Pure: the same inputs give
 * the same answer, which is how business.ts values an empty sector's
 * would-be output (with no stock and no allocations).
 */
export function settle(
  prod: number,
  use: number,
  stock: number,
  stockTarget: number,
  county: number,
  exportP: number,
  importP: number,
  outs: readonly Leg[] = [],
  ins: readonly Leg[] = [],
): Settlement {
  let avail = prod > 0 ? prod : 0;
  const need = use > 0 ? use : 0;
  // 1. Local output serves local use at the county price, no shipping.
  const local = Math.min(avail, need);
  avail -= local;
  let deficit = need - local;
  let revenue = local * county;
  let inputCost = local * county;
  // 2. Then the day's allocations to linked towns, in allocation order.
  const shipped: number[] = [];
  for (const o of outs) {
    const s = Math.min(avail, o.units > 0 ? o.units : 0);
    avail -= s;
    revenue += s * o.price;
    shipped.push(s);
  }
  // The buyer's side: allocations arrive in full, then stock, then Kingsport.
  const received: number[] = [];
  let inUnits = 0;
  let inValue = 0;
  for (const l of ins) {
    const u = l.units > 0 ? l.units : 0;
    received.push(u);
    inUnits += u;
    inValue += u * l.price;
  }
  const fromIn = Math.min(deficit, inUnits);
  deficit -= fromIn;
  if (inUnits > 0) inputCost += (fromIn * inValue) / inUnits;
  let s = stock > 0 ? stock : 0;
  // Received beyond need is stocked (it was bought; it is used later).
  s += inUnits - fromIn;
  const fromStock = Math.min(s, deficit);
  s -= fromStock;
  deficit -= fromStock;
  inputCost += fromStock * county;
  const imported = deficit;
  inputCost += imported * importP;
  // 3. Own leftovers top the stock up to its target (sold locally), and the rest is exported.
  const room = stockTarget - s > 0 ? stockTarget - s : 0;
  const toStock = Math.min(avail, room);
  avail -= toStock;
  s += toStock;
  revenue += toStock * county;
  const exported = avail;
  revenue += exported * exportP;
  return { local, shipped, toStock, exported, received, fromStock, imported, revenue, inputCost, stockAfter: s };
}

/** This town's out- and in-legs of good `g` from the snapshot's allocations. */
export function legsOf(m: MonthContext, g: number): { outs: Leg[]; ins: Leg[] } {
  const all: readonly Allocation[] = m.snapshot.allocations ?? [];
  const outs: Leg[] = [];
  const ins: Leg[] = [];
  const name = GOOD_NAMES[g];
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    if (a.good !== name || a.seller === a.buyer) continue;
    if (a.seller === m.townIndex) outs.push({ index: i, units: a.units, price: a.price });
    else if (a.buyer === m.townIndex) ins.push({ index: i, units: a.units, price: a.price });
  }
  return { outs, ins };
}

/**
 * A17 for WP3 (§8.3 step 2): what a seller owes when it shipped less than
 * its allocation. Kingsport filled the buyer at once; the seller pays
 * (import price − agreed price) × units short, capped at 10% of the
 * allocation's value.
 */
export function shortfallCharge(a: Allocation, shipped: number, importPrice: number, cap = 0.1): number {
  const short = a.units - shipped > 0 ? a.units - shipped : 0;
  const gap = importPrice - a.price > 0 ? importPrice - a.price : 0;
  const owed = short * gap;
  const most = cap * a.units * a.price;
  return owed < most ? owed : most;
}

// ---- What the tiles hold, per sector -----------------------------------------------------------

export interface SectorTiles {
  /** Built (finished) job capacity per SECTOR, and the part at L5. */
  jobs: number[];
  l5: number[];
  /** Jobs on tiles younger than 12 months (Start-up Holiday). */
  young: number[];
  /** Job-weighted land value sums per SECTOR (divide by jobs), and over every zoned tile. */
  lvSum: number[];
  lvAll: number;
  zonedTiles: number;
  /** Construction starts a month, in levels (2 goods each). */
  startsPerMonth: number;
}

const SECTOR_TILES = new WeakMap<DerivedCache, SectorTiles>();

/** One pass over the planes, shared by M7b and M8 (memoised on the month's blackboard). */
export function sectorTiles(t: TownState, m: MonthContext): SectorTiles {
  const hit = SECTOR_TILES.get(m.derived);
  if (hit) return hit;
  const p = planesOf(t);
  const lv = decodeCells(t.lv);
  const ticks = m.params.develop.buildTicks;
  const out: SectorTiles = {
    jobs: new Array<number>(SECTOR_COUNT).fill(0),
    l5: new Array<number>(SECTOR_COUNT).fill(0),
    young: new Array<number>(SECTOR_COUNT).fill(0),
    lvSum: new Array<number>(SECTOR_COUNT).fill(0),
    lvAll: 0,
    zonedTiles: 0,
    startsPerMonth: 0,
  };
  const building = pairPlane(t.construction);
  const zoned = zonedTiles(p.use);
  for (let q = 0; q < zoned.length; q++) {
    const i = zoned[q];
    if (useCat(p.use[i]) !== CAT_ZONE) continue;
    const z = usePayload(p.use[i]);
    out.zonedTiles += 1;
    out.lvAll += lv[cellOf(i)];
    const level = lvlLevel(p.lvl[i]);
    if (level === 0) continue;
    const left = building[i];
    if (left > 0) {
      // A start of `level` takes ticks[level − 1] ticks, so it accounts for 4/ticks starts a month.
      out.startsPerMonth += 4 / Math.max(1, ticks[level - 1] ?? 1);
      continue;
    }
    if (z === Z_HOMES) continue;
    const s = ZONE_SECTOR[z];
    const size = ZONE_DEFS[z].capacity[level - 1] ?? 0;
    out.jobs[s] += size;
    out.lvSum[s] += size * lv[cellOf(i)];
    if (level >= 5) out.l5[s] += size;
    if (p.age[i] < 12) out.young[s] += size;
  }
  SECTOR_TILES.set(m.derived, out);
  return out;
}

/** Mean land value of sector s's tiles (or of the town's zoned land, or 60, for an empty sector). */
export function sectorLv(st: SectorTiles, s: number): number {
  if (st.jobs[s] > 0) return st.lvSum[s] / st.jobs[s];
  return st.zonedTiles > 0 ? st.lvAll / st.zonedTiles : 60;
}

// ---- Production ---------------------------------------------------------------------------------

/** Output-equivalent staff of SECTOR s (trainees count ×0.8, A4), from the labour slot. */
export function sectorStaff(m: MonthContext, s: number): number {
  const lab = m.derived.labour;
  if (!lab) return 0;
  return lab.sectorEffective?.[s] ?? lab.sectorFilled[s] ?? 0;
}

/**
 * Goods from `staff` industry staff: 3.5 units a month × Prod, with L5's
 * clean makers' sheds at ×1.3 (by their share of the sector's jobs).
 */
export function goodsOutput(m: MonthContext, staff: number, l5Share: number): number {
  const f = m.params.firms;
  const prod = m.derived.labour?.prod ?? 1;
  return staff * f.goodsPerJob * prod * (1 + (f.l5Output - 1) * l5Share);
}

/** Food from `staff` farm staff: 100 units a farm tile (3 jobs) a month, ×1.3 on Flatland (A7). */
export function foodOutput(t: TownState, m: MonthContext, staff: number): number {
  const f = m.params.firms;
  const perTile = ZONE_DEFS[Z_FARMS].capacity[0] || 3;
  return (staff / perTile) * f.farmFood * (t.siteKind === 'flatland' ? f.flatlandFood : 1);
}

// ---- The scratch M8 reads ------------------------------------------------------------------------

export interface TradeScratch {
  prices: Prices;
  /** Per [goods, food]: the settlement, and the would-be sale of an empty sector's bootstrap output. */
  sale: Settlement[];
  /** Shops' and leisure's would-be takings (all the spend aimed at them, open or not), £ a month. */
  shopSales: number;
  leisureSales: number;
  /** Hotel room takings, £. */
  hotelSales: number;
  /** Buyers' cost per unit used over Kingsport's import price, per good: 1 when everything is imported, less with local or family stock (§5.12). */
  priceFactor: number[];
  /** Units used locally per good. */
  use: number[];
}

const SCRATCH = new WeakMap<DerivedCache, TradeScratch>();

export function tradeScratch(m: MonthContext): TradeScratch | undefined {
  return SCRATCH.get(m.derived);
}

// ---- M7b ------------------------------------------------------------------------------------------

/** STEP M7b (WP2c): household, commuter, shopper and visitor spending; goods and food production, use and trade → derived.spend, derived.goods (+ t.goodsStock, t.realised). */
export function stepSpending(t: TownState, m: MonthContext): void {
  const f = m.params.firms;
  const tp = m.params.tourism;
  const lab = m.derived.labour ?? neutral.labour();
  const dev = m.derived.development ?? neutral.development();
  const tour = m.derived.tourism ?? neutral.tourism();
  const fl = flowsFor(m);
  const st = sectorTiles(t, m);

  // Households spend α_h of income on retail and β_h on leisure (§5.12).
  let retail = 0;
  let leisure = 0;
  let inCommRetail = 0;
  for (let h = 0; h < 3; h++) {
    const inc = lab.income[h] > 0 ? lab.income[h] : 0;
    retail += f.retailShare[h] * inc;
    leisure += f.leisureShare[h] * inc;
    inCommRetail += f.retailShare[h] * (lab.commutersIn[h] ?? 0) * (lab.wage[h] ?? 0);
  }
  if (eventIs(m, 'bargainWeek')) retail *= f.bargainWeek;
  if (policyOn(t, 'nightMarket')) leisure *= f.nightMarket;
  inCommRetail *= f.inCommuterRetail;
  const leak = clamp(fl.leak, 0, f.leakCap);
  const shoppersOut = retail * leak;
  const shoppersIn = fl.shoppersIn > 0 ? fl.shoppersIn : 0;

  // Visitors' spend: a stay night's £60 split between shops and leisure, a day trip's £35 60/40.
  const nightSpend = tour.stays * tp.stayNights * tp.stayShopSpend;
  const tripSpend = tour.dayTrips * tp.dayTripSpend;
  const visitorShops = nightSpend * tp.stayShopShare + tripSpend * tp.dayTripShops;
  const visitorLeisure = nightSpend * (1 - tp.stayShopShare) + tripSpend * (1 - tp.dayTripShops);
  const hotelSales = tour.hotelNights * tp.hotelNight;

  // Spend aimed at each sector; only a sector with finished jobs actually takes it.
  let shopJobs = 0;
  let leisureJobs = 0;
  for (let h = 0; h < 3; h++) {
    shopJobs += dev.jobs[S_SHOPS * 3 + h] ?? 0;
    leisureJobs += dev.jobs[S_LEISURE * 3 + h] ?? 0;
  }
  const shopSales = retail - shoppersOut + shoppersIn + inCommRetail + visitorShops;
  const leisureSales = leisure + visitorLeisure;
  const shopsOpen = shopJobs > 0;
  const leisureOpen = leisureJobs > 0;
  const shopTaken = shopsOpen ? shopSales : 0;
  const leisureTaken = leisureOpen ? leisureSales + hotelSales : 0;

  // Local use (A8): shop and leisure stock at their input shares (Shops 50%: 40% food, 60% goods;
  // Leisure 30% goods), valued at the reference unit prices; plus 2 goods per level of construction.
  const inShops = f.inputs[S_SHOPS];
  const inLeisure = f.inputs[S_LEISURE];
  const construction = f.constructionGoods * st.startsPerMonth;
  const useFood = (shopTaken * inShops * f.shopFoodShare) / f.foodUnit;
  const useGoods = (shopTaken * inShops * (1 - f.shopFoodShare) + leisureTaken * inLeisure) / f.goodsUnit + construction;
  const use = [useGoods, useFood];

  // Production.
  const indStaff = sectorStaff(m, S_INDUSTRY);
  const farmStaff = sectorStaff(m, S_FARMS);
  const l5Share = st.jobs[S_INDUSTRY] > 0 ? st.l5[S_INDUSTRY] / st.jobs[S_INDUSTRY] : 0;
  const prod = [goodsOutput(m, indStaff, l5Share), foodOutput(t, m, farmStaff)];

  // Settle each good in the A8 order and record the day's realised shipments for the Regional Day.
  const prices = pricesOf(t, m);
  const memo = memoOf(t);
  const r = t.realised;
  const nAlloc = (m.snapshot.allocations ?? []).length;
  while (r.shipped.length < nAlloc) r.shipped.push(0);
  while (r.received.length < nAlloc) r.received.push(0);
  const sale: Settlement[] = [];
  const priceFactor = [1, 1];
  const slot: GoodsSlot = neutral.goods();
  for (let g = 0; g < 2; g++) {
    const { outs, ins } = legsOf(m, g);
    const stock = t.goodsStock[g] > 0 ? t.goodsStock[g] : 0;
    const s = settle(prod[g], use[g], stock, f.stockMonths * use[g], prices.county[g], prices.exportP[g], prices.importP[g], outs, ins);
    sale.push(s);
    t.goodsStock[g] = s.stockAfter;
    outs.forEach((o, k) => (r.shipped[o.index] += s.shipped[k]));
    ins.forEach((l, k) => (r.received[l.index] += s.received[k]));
    // §5.12's input shares are what stock costs from Kingsport; local and family stock is cheaper (A8).
    priceFactor[g] = use[g] > 0 ? s.inputCost / (use[g] * prices.importP[g]) : prod[g] > 0 ? prices.county[g] / prices.importP[g] : 1;
    memo.surplus[g] = smooth(memo.surplus[g], prod[g] - use[g], f.surplusTau);
    slot.production[g] = prod[g];
    slot.localUse[g] = use[g];
    slot.allocatedOut[g] = sum(s.shipped);
    slot.allocatedIn[g] = sum(s.received);
    slot.exported[g] = s.exported;
    slot.imported[g] = s.imported;
    slot.exportPrice[g] = prices.exportP[g];
    slot.importPrice[g] = prices.importP[g];
  }

  // Cross-border shopping actually realised today (WP3 moves the sales tax at the Regional Day).
  r.shopperSpendOut += shoppersOut;
  r.shopperSpendIn += shopsOpen ? shoppersIn : 0;

  const spend: SpendSlot = {
    retail,
    leisure,
    shoppersOut,
    shoppersIn: shopsOpen ? shoppersIn : 0,
    visitorShops: shopsOpen ? visitorShops : 0,
    visitorLeisure: leisureOpen ? visitorLeisure : 0,
    inCommuterRetail: shopsOpen ? inCommRetail : 0,
    // The sales-tax base: retail and leisure turnover, with visitors and shoppers in; hotel rooms pay hotel tax instead.
    turnover: shopTaken + (leisureOpen ? leisureSales : 0),
  };
  m.derived.spend = spend;
  m.derived.goods = slot;
  SCRATCH.set(m.derived, { prices, sale, shopSales, leisureSales, hotelSales, priceFactor, use });

  m.why.set('goodsNet', prod[GOOD] - use[GOOD]);
  m.why.add('goods.production', prod[GOOD], 'goodsNet');
  m.why.add('goods.use', -(use[GOOD] - construction), 'goodsNet');
  m.why.add('goods.construction', -construction, 'goodsNet');
}

function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/** A finished building of this id stands in the town (tourism's and offices' gates). */
export function hasBuildingDone(t: TownState, id: string): boolean {
  const k = buildingIndex(id);
  return k >= 0 && hasFinished(t, k);
}
