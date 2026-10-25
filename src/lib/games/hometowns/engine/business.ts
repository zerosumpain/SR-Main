// Firms and the business meters (WP2c, spec §5.12 with A5, A6 and A7).
//
// Business demand is sector profit, so taxes, wages, rents and goods prices
// bite honestly. Each month (M8), for Farms, Industry, Shops, Leisure and
// Offices, the sector's takings are set against its wage bill, premises
// rent, business tax and inputs; the margin is smoothed (τ 4 months), and the
// meter moves a quarter of the way toward a target that is strongly positive
// only above the normal 8% margin. Three corrections keep it honest:
//   - the supply line (A6): jobs already under construction are costed in,
//     so a sector does not keep ordering shops while the last ones are still
//     scaffolding (the probe's 0 → 8,500 → 3,000 office boom and bust);
//   - unfilled slots (A5) and the labour gate: a sector that cannot staff
//     what it has does not want more;
//   - the bootstrap: an empty sector is valued as if it had 5 jobs, so a
//     hamlet with spending and no shop wants one, but the margin of that
//     imagined sector is capped at +30% (A6).
// Farms earn 100 food units a tile at £60 (A7), and sell locally first (A8),
// so a farm is profitable while the town eats what it grows and only
// marginal on Kingsport's £48.
//
// Firms' takings are private: nothing here moves the town's money. WP2d
// taxes the turnover this step reports.

import { ZONE_DEFS } from './content';
import { clamp, powFx, smooth, T } from './fx';
import { neutral } from './derived';
import { bp } from './num';
import {
  FOOD,
  GOOD,
  S_FARMS,
  S_INDUSTRY,
  S_LEISURE,
  S_OFFICES,
  S_SHOPS,
  foodOutput,
  goodsOutput,
  hasBuildingDone,
  memoOf,
  policyOn,
  pricesOf,
  sectorLv,
  sectorTiles,
  settle,
  tradeScratch,
} from './trade';
import {
  COVERAGES,
  METERS,
  METER_FARMS,
  METER_INDUSTRY,
  METER_LEISURE,
  METER_OFFICES,
  METER_SHOPS,
  MARGIN_PRIME,
  SECTOR_COUNT,
  Z_FARMS,
  Z_INDUSTRY,
  Z_LEISURE,
  Z_OFFICES,
  Z_SHOPS,
  type FirmsSlot,
  type MonthContext,
  type TownState,
} from './types';

/** SECTOR → its meter and its zone. */
export const SECTOR_METER: readonly number[] = [METER_FARMS, METER_INDUSTRY, METER_SHOPS, METER_LEISURE, METER_OFFICES];
export const SECTOR_ZONE: readonly number[] = [Z_FARMS, Z_INDUSTRY, Z_SHOPS, Z_LEISURE, Z_OFFICES];
const COV_FUN = COVERAGES.indexOf('fun');

/** One sector's month: what it took, what it cost, and why. */
export interface SectorBooks {
  /** Takings the margin is judged on (an empty sector's would-be takings). */
  rev: number;
  wages: number;
  rent: number;
  tax: number;
  /** Sales tax on the retail and leisure takings (from Town): the till hands it to the town. */
  salesTax: number;
  inputs: number;
  cost: number;
  /** The business-tax base: takings less a Start-up Holiday's exempt share. */
  taxable: number;
  /** Jobs the books are for (built, or the bootstrap's 5), and the pipeline's expected cost. */
  jobs: number;
  pipeCost: number;
  bootstrap: boolean;
  /** This month's margin and supply-line margin, before smoothing (bootstrap capped at +30%). */
  margin: number;
  marginPipe: number;
}

/**
 * Can the town zone this kind at its tier (§3.3: Leisure and Offices from
 * Town, Farms only up to Town)? A9 caps a meter the mayor cannot act on;
 * WP2e's supply count also reports tiles no zoned land could serve.
 */
/** Sales tax is collected from Town tier (§5.13). */
const SALES_TAX_TIER = 2;

export function zoneOpen(t: TownState, zone: number): boolean {
  const z = ZONE_DEFS[zone];
  return t.tier >= z.unlock && t.tier <= z.zoneUntil;
}

/** Expected wage of one job of sector s when staffed: the actual bill per head, else an entry (£) wage. */
function wagePerJob(m: MonthContext, s: number): number {
  const lab = m.derived.labour;
  const filled = lab?.sectorFilled[s] ?? 0;
  const bill = lab?.sectorWages?.[s];
  if (bill !== undefined && filled > 0) return bill / filled;
  const w0 = lab?.wage[0] ?? 0;
  return w0 > 0 ? w0 : m.params.labour.W0[0];
}

/**
 * The books of sector s for `rev` takings at `jobs` jobs and `wages` wage
 * bill (pure apart from reading this month's prices and land values). Rent
 * is jobs × rentPerJob × (0.6 + 0.4·LV̄/80); business tax is on turnover (a
 * Start-up Holiday exempts young tiles' share); inputs are §5.12's share of
 * sales when the stock comes from Kingsport, scaled down by what the town's
 * buyers actually paid for local or allocated stock, so cheaper stock raises
 * margins (A8: "a shopping town and a factory town are each other's best
 * friends").
 */
export function sectorBooks(t: TownState, m: MonthContext, s: number, rev: number, jobs: number, wages: number, pipeJobs: number, bootstrap: boolean): SectorBooks {
  const f = m.params.firms;
  const st = sectorTiles(t, m);
  const sc = tradeScratch(m);
  const pf = sc ? sc.priceFactor : [1, 1];
  const rent = jobs * f.rentPerJob[s] * (f.rentLv[0] + (f.rentLv[1] * sectorLv(st, s)) / f.rentLv[2]);
  const exempt = policyOn(t, 'startupHoliday') ? (bootstrap ? 1 : st.jobs[s] > 0 ? st.young[s] / st.jobs[s] : 0) : 0;
  const taxable = rev * (1 - exempt);
  const tax = bp(t.taxes.business) * taxable;
  // Sales tax is a wedge in the shops' and cafés' margins (§5.17, §18 row 22:
  // "bases that bite in margins"): the town's sales-tax line is a share of
  // their takings, so the firms keep the rest. Without this a 10% sales tax
  // was free money for any town without a linked neighbour to shop in.
  // Hotel rooms pay hotel tax instead (it bites through the tourist share).
  const salesBase = t.tier < SALES_TAX_TIER ? 0 : s === S_SHOPS ? rev : s === S_LEISURE ? Math.min(rev, sc?.leisureSales ?? rev) : 0;
  const salesTax = bp(t.taxes.sales) * salesBase;
  const factor = s === S_SHOPS ? f.shopFoodShare * pf[FOOD] + (1 - f.shopFoodShare) * pf[GOOD] : s === S_LEISURE ? pf[GOOD] : 1;
  const inputs = f.inputs[s] * rev * factor;
  let cost = wages + rent + tax + salesTax + inputs;
  if (s === S_INDUSTRY && policyOn(t, 'cleanAirRules')) cost *= f.cleanAirCost;
  // A6: jobs still under construction will cost what a filled job costs now.
  const filled = m.derived.labour?.sectorFilled[s] ?? 0;
  // c̄ is this month's cost per filled job; a sector nobody staffs yet adds the wage it would pay.
  const perJob = filled >= 1 ? cost / filled : cost / Math.max(1, jobs) + wagePerJob(m, s);
  const pipeCost = bootstrap ? 0 : pipeJobs * perJob;
  const base = cost > 1 ? cost : 1;
  let margin = (rev - cost) / base;
  let marginPipe = (rev - cost - pipeCost) / (base + pipeCost);
  if (bootstrap) {
    if (margin > f.bootstrapMarginCap) margin = f.bootstrapMarginCap;
    if (marginPipe > f.bootstrapMarginCap) marginPipe = f.bootstrapMarginCap;
  }
  return { rev, wages, rent, tax, salesTax, inputs, cost, taxable, jobs, pipeCost, bootstrap, margin, marginPipe };
}

/** STEP M8 (WP2c): sector revenue, cost and margins; business meters → derived.firms (+ t.margins, t.meters[Shops…Farms]). */
export function stepFirms(t: TownState, m: MonthContext): void {
  const f = m.params.firms;
  const mp = m.params.meters;
  const lab = m.derived.labour ?? neutral.labour();
  const dev = m.derived.development ?? neutral.development();
  const tour = m.derived.tourism ?? neutral.tourism();
  const sc = tradeScratch(m);
  const memo = memoOf(t);
  const st = sectorTiles(t, m);
  const B = f.bootstrapJobs;

  const jobs = new Array<number>(SECTOR_COUNT).fill(0);
  const pipe = new Array<number>(SECTOR_COUNT).fill(0);
  for (let s = 0; s < SECTOR_COUNT; s++)
    for (let h = 0; h < 3; h++) {
      jobs[s] += dev.jobs[s * 3 + h] ?? 0;
      pipe[s] += dev.pipeJobs[s * 3 + h] ?? 0;
    }

  // Takings: what is aimed at each sector (open or not), and the goods sectors' sales in the A8 order.
  const prices = sc?.prices ?? pricesOf(t, m);
  const use = sc?.use ?? [0, 0];
  const wouldSell = (g: number, prod: number) => settle(prod, use[g], 0, 0, prices.county[g], prices.exportP[g], prices.importP[g]).revenue;
  const potential = new Array<number>(SECTOR_COUNT).fill(0);
  potential[S_SHOPS] = sc?.shopSales ?? 0;
  potential[S_LEISURE] = (sc?.leisureSales ?? 0) + (tour.beds > 0 ? (sc?.hotelSales ?? 0) : 0);
  potential[S_INDUSTRY] = jobs[S_INDUSTRY] > 0 ? (sc?.sale[GOOD].revenue ?? 0) : wouldSell(GOOD, goodsOutput(m, B, 0));
  potential[S_FARMS] = jobs[S_FARMS] > 0 ? (sc?.sale[FOOD].revenue ?? 0) : wouldSell(FOOD, foodOutput(t, m, B));
  let local = 0;
  for (const s of [S_FARMS, S_INDUSTRY, S_SHOPS, S_LEISURE]) if (jobs[s] > 0) local += potential[s];
  const outside = f.officeOutside * powFx(Math.max(0, lab.effJobs) / f.officeRef[0], f.officeRef[1]) * (1 + (hasBuildingDone(t, 'airfield') ? f.officeAirfield : 0)) * m.world.office;
  potential[S_OFFICES] = f.officeShare * local + outside;

  const out: FirmsSlot = neutral.firms();
  let turnover = 0;
  for (let s = 0; s < SECTOR_COUNT; s++) {
    const bootstrap = jobs[s] <= 0;
    const J = bootstrap ? Math.max(B, pipe[s]) : jobs[s];
    const wages = bootstrap ? J * wagePerJob(m, s) : (lab.sectorWages?.[s] ?? (lab.sectorFilled[s] ?? 0) * wagePerJob(m, s));
    const books = sectorBooks(t, m, s, potential[s], J, wages, pipe[s], bootstrap);

    // Smoothed margins: m̄ is reported, m̄′ (the supply-line margin) drives the meter.
    t.margins[s] = smooth(t.margins[s], books.margin, f.marginTau);
    t.margins[MARGIN_PRIME + s] = smooth(t.margins[MARGIN_PRIME + s], books.marginPipe, f.marginTau);
    memo.lowMonths[s] = !bootstrap && t.margins[s] < f.closeMargin ? memo.lowMonths[s] + 1 : 0;

    // A5: built slots nobody filled; the labour gate (an empty sector asks whether there are £ hands to hire).
    const filled = lab.sectorFilled[s] ?? 0;
    const unfilled = bootstrap ? 0 : Math.max(0, jobs[s] - filled);
    const fill = bootstrap ? Math.min(1, (lab.unemployed[0] ?? 0) / B) : (lab.fillRate[s] ?? 0);
    const gate = clamp((fill - f.labourGate[0]) / f.labourGate[1], 0, 1);
    const ucTerm = (mp.ucWeight * unfilled) / Math.max(jobs[s], mp.emptySectorJobs);
    const arg = mp.bizGain * (t.margins[MARGIN_PRIME + s] - mp.normalMargin - ucTerm);
    const ungated = 100 * T(arg);
    // The gate holds back growth only: a sector losing money still says so when it cannot hire.
    let target = ungated > 0 ? ungated * gate : ungated;
    const policy = s === S_SHOPS && policyOn(t, 'farmersMarket') ? f.farmersMarket : 0;
    target = clamp(target + policy, -100, 100);

    const k = SECTOR_METER[s];
    let D = t.meters[k] + mp.alpha * (target - t.meters[k]);
    const reachable = dev.reachableZone[SECTOR_ZONE[s]] !== false && zoneOpen(t, SECTOR_ZONE[s]);
    const capped = !reachable && D > mp.unreachableCap;
    if (capped) D = mp.unreachableCap;
    t.meters[k] = clamp(D, -100, 100);

    whyMeter(m, k, { books, ungated, target, gate, arg, ucTerm, policy, capped, D: t.meters[k] });

    const taken = bootstrap ? 0 : books.rev;
    out.rev[s] = taken;
    out.cost[s] = bootstrap ? 0 : books.cost;
    out.margin[s] = books.margin;
    out.target[s] = target;
    out.jobs[s] = jobs[s];
    out.pipeJobs[s] = pipe[s];
    out.unfilled[s] = unfilled;
    out.labourGate[s] = gate;
    // The business-tax base: open sectors' turnover (a Start-up Holiday's exempt share is left out).
    if (!bootstrap) turnover += books.taxable;
  }
  out.turnover = turnover;
  m.derived.firms = out;

  // Shop appeal's town part for the Regional Day's cross-border shopping (§5.12).
  const fun = m.derived.coverage?.town[COV_FUN] ?? 0;
  memo.shopAppeal = jobs[S_SHOPS] > 0 ? powFx(jobs[S_SHOPS], f.shopAppeal[0]) * (1 + (f.shopAppeal[1] * fun) / 100) : 0;
}

/**
 * The meter's Why. The supply-line margin is takings over costs minus one,
 * so with C′ the costs plus the pipeline, m̃ = Rev/C′ − Σ line/C′: the
 * takings' term is positive, each cost line's negative. The target's
 * argument splits the same way (less the normal margin and the unfilled
 * slots), and each part takes its share of the ungated target; the labour
 * gate, a policy and the A9 cap are their own terms.
 */
function whyMeter(
  m: MonthContext,
  k: number,
  v: { books: SectorBooks; ungated: number; target: number; gate: number; arg: number; ucTerm: number; policy: number; capped: boolean; D: number },
): void {
  const q = `meter.${METERS[k]}`;
  m.why.set(q, v.D);
  const b = v.books;
  const gain = m.params.meters.bizGain;
  const c = Math.max(1, b.cost + b.pipeCost);
  // Cost lines scaled to the cost (Clean Air Rules multiply the whole), so they sum to it.
  const raw = b.wages + b.rent + b.tax + b.salesTax + b.inputs;
  const sc = raw > 0 ? b.cost / raw : 1;
  const parts: [string, number][] = b.bootstrap
    ? [['meter.biz.bootstrap', v.arg]]
    : [
        ['meter.biz.demand', (gain * b.rev) / c],
        ['meter.biz.wages', (-gain * b.wages * sc) / c],
        ['meter.biz.rent', (-gain * b.rent * sc) / c],
        // Business tax and, for shops and leisure, sales tax: one "taxes" term.
        ['meter.biz.tax', (-gain * (b.tax + b.salesTax) * sc) / c],
        ['meter.biz.inputs', (-gain * b.inputs * sc) / c],
        // The normal 8% a firm needs, and the cost of the jobs already being built (A6).
        ['meter.biz.margin', -gain * m.params.meters.normalMargin - (gain * b.pipeCost) / c],
        ['meter.biz.unfilled', -gain * v.ucTerm],
      ];
  // The parts sum to this month's argument; the target came from the smoothed one, so scale to it.
  let sum = 0;
  for (const [, a] of parts) sum += a;
  if (Math.abs(sum) > 1e-12) for (const [key, a] of parts) if (a !== 0) m.why.add(key, (v.ungated * a) / sum, q);
  const gated = v.ungated > 0 ? v.ungated * v.gate : v.ungated;
  if (gated !== v.ungated) m.why.add('meter.biz.labour', gated - v.ungated, q);
  if (v.policy) m.why.add('meter.biz.policy', v.policy, q);
  if (v.capped) m.why.add('meter.biz.unreachable', m.params.meters.unreachableCap - v.target, q);
}
