// Tomorrow's flows between towns (WP3, spec §8.5, §5.10, §5.12), fixed once
// at the Regional Day's step 4 so that both towns of every pair read the
// same number all day: commuters, shoppers, day trips, the tourist pool and
// shares, goods and food allocations with the county prices, shared hospital
// and university places, and shared air. Towns read them only through the
// snapshot (flowsFor), never from each other (A20).
//
// Everything here is computed from every town's stored numbers at once, by
// pure functions over arrays indexed by town (fixFlows, allocateGoods), so
// the answer cannot depend on which town was stepped first. Where two towns
// compete for the same thing (vacancies, a seller's goods) they get it pro
// rata, never first come first served.
//
// Inputs come from the month steps' memos (peopleMemo, marketMemo): their
// last month-end numbers. The unemployed and vacancies there are after the
// day's commuting, so today's commuters are added back before tomorrow's are
// fixed; otherwise commuting would flicker on and off from day to day.

import { decodeCells } from './tiles';
import { expFx } from './fx';
import { population } from './core';
import { touristPoolBase, touristShares } from './tourism';
import { worldAt } from './world';
import { neutralFlows } from './core';
import { advanceLinks } from './offers';
import { isActive, MAX_TOWNS, monthsToday, pairLinks, regionOf, rp, pp, type PairLink } from './region-state';
import { PERSON_S, STAGE_C, STAGE_P, STAGE_R, STAGE_W, person, type Allocation, type CountyState, type RegionalContext, type TownDayFlows, type TownState } from './types';
import type { Params } from './params';
import type { RegionParams } from './region-params';

/** One town as tomorrow's flows see it. */
export interface FlowTown {
  active: boolean;
  pop: number;
  /** Workers looking for work, and vacant jobs, by tier (today's commuters added back). */
  unemployed: number[];
  vacancies: number[];
  /** Shop appeal's town part, and the sales tax in basis points. */
  shopAppeal: number;
  salesTax: number;
  /** Residents' retail spend, £ a month. */
  retail: number;
  /** Attr·Q and the tourist pull X (§5.10). */
  attrQ: number;
  pull: number;
  /** Persons needing a hospital place, and university places (shared places' 30% cap). */
  healthNeed: number;
  uniNeed: number;
}

export interface FlowsOut {
  towns: TownDayFlows[];
  /** C[(home·n + work)·3 + h], commuters per month. */
  commute: number[];
  /** DT[from·n + to], day trips per month. */
  dayTrips: number[];
}

const decay = (t: number, scale: number): number => (Number.isFinite(t) ? expFx(-t / scale) : 0);

/** §8.5 commuters, shoppers and day trips for a county of towns and pair links. Pure. */
export function fixFlows(towns: readonly FlowTown[], links: readonly PairLink[], q: RegionParams, leakCap: number, twin: (i: number, j: number) => boolean): FlowsOut {
  const n = towns.length;
  const out = towns.map(() => neutralFlows());
  const linked = (i: number, j: number) => i !== j && towns[i].active && towns[j].active && Number.isFinite(links[i * n + j].minutes);
  const tmin = (i: number, j: number) => links[i * n + j].minutes;

  // ---- Commuters: C[j→c][h] = U_j·e^(−t/20)·Vac_c / (Σ_k e^(−t/20)·Vac_k + 0.5·U_j + 1) ----
  const C = new Array<number>(n * n * 3).fill(0);
  for (let h = 0; h < 3; h++) {
    for (let j = 0; j < n; j++) {
      const U = Math.max(0, towns[j].unemployed[h] ?? 0);
      if (!(U > 0)) continue;
      let denom = q.commuteStay * U + 1;
      for (let k = 0; k < n; k++) if (linked(j, k)) denom += decay(tmin(j, k), q.commuteDecay) * Math.max(0, towns[k].vacancies[h] ?? 0);
      for (let c = 0; c < n; c++) {
        if (!linked(j, c)) continue;
        C[(j * n + c) * 3 + h] = (U * decay(tmin(j, c), q.commuteDecay) * Math.max(0, towns[c].vacancies[h] ?? 0)) / denom;
      }
    }
    // A work town fills at most its vacancies.
    for (let c = 0; c < n; c++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += C[(j * n + c) * 3 + h];
      const vac = Math.max(0, towns[c].vacancies[h] ?? 0);
      if (s > vac) for (let j = 0; j < n; j++) C[(j * n + c) * 3 + h] *= vac / s;
    }
  }

  // ---- Day trips: DT[j→c] = N_j·0.015·AQ_c/(AQ_c + AQ_j + 40)·e^(−t/40) (§5.10) ----
  const DT = new Array<number>(n * n).fill(0);
  for (let j = 0; j < n; j++)
    for (let c = 0; c < n; c++) {
      if (!linked(j, c)) continue;
      const aq = Math.max(0, towns[c].attrQ);
      if (!(aq > 0)) continue;
      let x = (towns[j].pop * q.dayTripRate * aq) / (aq + Math.max(0, towns[j].attrQ) + q.dayTripOffset);
      x *= decay(tmin(j, c), q.dayTripDecay);
      if (twin(j, c)) x *= q.twinDayTrips;
      DT[j * n + c] = x;
    }

  // ---- Link capacity: a pair's commuters (both ways) and day trips share its trips a day ----
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      if (!linked(a, b)) continue;
      let load = (DT[a * n + b] + DT[b * n + a]) * q.dayTripLoad;
      for (let h = 0; h < 3; h++) load += C[(a * n + b) * 3 + h] + C[(b * n + a) * 3 + h];
      const cap = links[a * n + b].trips;
      if (!(load > cap)) continue;
      const k = cap > 0 ? cap / load : 0;
      for (let h = 0; h < 3; h++) {
        C[(a * n + b) * 3 + h] *= k;
        C[(b * n + a) * 3 + h] *= k;
      }
      DT[a * n + b] *= k;
      DT[b * n + a] *= k;
    }
  for (let j = 0; j < n; j++)
    for (let c = 0; c < n; c++)
      for (let h = 0; h < 3; h++) {
        const x = C[(j * n + c) * 3 + h];
        out[j].commutersOut[h] += x;
        out[c].commutersIn[h] += x;
      }
  for (let j = 0; j < n; j++) for (let c = 0; c < n; c++) out[c].dayTripsIn += DT[j * n + c];

  // ---- Shoppers: Leak_c = 0.4·Σ_j a_j / (SA_c + Σ_j a_j), a_j = SA_j·gap·e^(−t/15) (§5.12) ----
  for (let c = 0; c < n; c++) {
    if (!towns[c].active) continue;
    const a = new Array<number>(n).fill(0);
    let sum = 0;
    for (let j = 0; j < n; j++) {
      if (!linked(c, j)) continue;
      // A dearer high street over the border draws fewer shoppers: −12% per point of sales-tax gap.
      const gapPts = (towns[j].salesTax - towns[c].salesTax) / 100;
      const gap = Math.min(q.salesTaxGapBand[1], Math.max(q.salesTaxGapBand[0], 1 - q.salesTaxGap * gapPts));
      a[j] = Math.max(0, towns[j].shopAppeal) * gap * decay(tmin(c, j), q.shopDecay);
      sum += a[j];
    }
    if (!(sum > 0)) continue;
    const leak = Math.min(leakCap, (q.shopLeak * sum) / (Math.max(0, towns[c].shopAppeal) + sum));
    out[c].leak = leak;
    for (let j = 0; j < n; j++) if (a[j] > 0) out[j].shoppersIn += (leak * towns[c].retail * a[j]) / sum;
  }
  return { towns: out, commute: C, dayTrips: DT };
}

// ---- Goods and food (§8.5): allocations, cheapest landed price first, pro rata within a price ----

export interface GoodsTown {
  active: boolean;
  /** Projected surplus (+) or need (−), units a month. */
  surplus: number;
}

/**
 * Buyers get allocations from sellers along links, cheapest landed price
 * (p_g + £2·t) first, so nearest first. Pairs at the same travel time
 * share pro rata on both sides (each seller's units over its buyers' needs,
 * each buyer's need over its sellers' units), so no town's index buys it a
 * better deal. Each pair is capped by its links' goods capacity; units are
 * whole; the rest of every need is met by Kingsport.
 */
export function allocateGoods(towns: readonly GoodsTown[], links: readonly PairLink[], unitPrice: number, shipping: number, floorPrice: number, good: Allocation['good']): Allocation[] {
  const n = towns.length;
  const S = towns.map((t) => (t.active && t.surplus > 0 ? t.surplus : 0));
  const D = towns.map((t) => (t.active && t.surplus < 0 ? -t.surplus : 0));
  const cap = links.map((l) => l.goods);
  const units = new Array<number>(n * n).fill(0);
  const times: number[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const m = links[i * n + j].minutes;
      if (i !== j && Number.isFinite(m) && !times.includes(m)) times.push(m);
    }
  times.sort((a, b) => a - b);
  for (const tm of times) {
    // A pair whose landed price nets the seller less than Kingsport would pay is not worth shipping.
    if (unitPrice - shipping * tm <= floorPrice) continue;
    for (let round = 0; round < 3; round++) {
      const sOut = new Array<number>(n).fill(0);
      const dIn = new Array<number>(n).fill(0);
      const ok = (i: number, j: number) => i !== j && links[i * n + j].minutes === tm && S[i] > 0 && D[j] > 0 && cap[i * n + j] - units[i * n + j] > 0;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (ok(i, j)) (sOut[i] += D[j], (dIn[j] += S[i]));
      const give = new Array<number>(n * n).fill(0);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          if (!ok(i, j)) continue;
          const x = Math.min((S[i] * D[j]) / sOut[i], (D[j] * S[i]) / dIn[j], cap[i * n + j] - units[i * n + j]);
          give[i * n + j] = Math.floor(x);
        }
      let moved = 0;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const x = give[i * n + j];
          if (x <= 0) continue;
          units[i * n + j] += x;
          S[i] -= x;
          D[j] -= x;
          moved += x;
        }
      if (moved === 0) break;
    }
  }
  const out: Allocation[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const u = units[i * n + j];
      if (u <= 0) continue;
      const price = Math.round((unitPrice - shipping * links[i * n + j].minutes) * 100) / 100;
      out.push({ good, seller: i, buyer: j, units: u, price });
    }
  return out;
}

/** §8.5 county price: p ← p·(1 + clamp(0.1·(D − S)/S, ±0.05)), inside Kingsport's band. */
export function nextPrice(p: number, supply: number, demand: number, lo: number, hi: number, q: RegionParams): number {
  let step = 0;
  if (supply > 0) step = Math.max(-q.priceStep, Math.min(q.priceStep, (q.priceGain * (demand - supply)) / supply));
  else if (demand > 0) step = q.priceStep;
  const next = p * (1 + step);
  return Math.round(Math.min(hi, Math.max(lo, next)) * 1e6) / 1e6;
}

// ---- The county side ------------------------------------------------------------------------------

/** Residents' retail spend from stored stocks (§5.12): α_h of an estimated income by tier. */
export function retailEstimate(t: TownState, p: Params): number {
  const lp = p.labour;
  const part = p.people.participation;
  const memo = t.peopleMemo;
  let retail = 0;
  for (let h = 0; h < 3; h++) {
    const W = t.people[person(STAGE_W, h)];
    const P = t.people[person(STAGE_P, h)];
    const R = t.people[person(STAGE_R, h)];
    let wf = part.W * W + part.P * P;
    if (h === 0) wf += part.S * t.people[PERSON_S];
    const u = Math.min(wf, memo?.unemployed?.[h] ?? 0);
    let inc = (wf - u) * lp.W0[h] + lp.pensionShare * lp.W0[0] * R + lp.supportShare * lp.W0[0] * u;
    if (h === 0) inc += lp.studentIncome * t.people[PERSON_S];
    retail += p.firms.retailShare[h] * inc;
  }
  return retail;
}

/** The flows' view of one town now. */
export function flowTown(c: CountyState, i: number): FlowTown {
  const t = c.towns[i];
  const p = pp(c);
  const months = Math.max(1, monthsToday(c, i));
  const memo = t.peopleMemo;
  const mm = t.marketMemo;
  const unemployed = [0, 0, 0];
  const vacancies = [0, 0, 0];
  for (let h = 0; h < 3; h++) {
    unemployed[h] = (memo?.unemployed?.[h] ?? 0) + (t.realised.commutersOut[h] ?? 0) / months;
    vacancies[h] = (memo?.vacancies?.[h] ?? 0) + (t.realised.commutersIn[h] ?? 0) / months;
  }
  let children = 0;
  for (let h = 0; h < 3; h++) children += t.people[person(STAGE_C, h)];
  return {
    active: isActive(t),
    pop: population(t),
    unemployed,
    vacancies,
    shopAppeal: mm?.shopAppeal ?? 0,
    salesTax: t.taxes.sales,
    retail: retailEstimate(t, p),
    attrQ: mm?.attrQ ?? 0,
    pull: mm?.pull ?? 0,
    healthNeed: population(t),
    uniNeed: 0.1 * (children + t.people[PERSON_S]),
  };
}

function hasPact(c: CountyState, kind: 'trail' | 'twin', i: number, j: number): boolean {
  return c.pacts.some((x) => x.kind === kind && ((x.a === i && x.b === j) || (x.a === j && x.b === i)));
}

/** Mean pollution of a town's east edge (the face its downwind neighbour sees). */
function eastEdge(t: TownState): number {
  const cells = decodeCells(t.lag.poll);
  let s = 0;
  for (let cy = 0; cy < 32; cy++) s += cells[cy * 32 + 31];
  return s / 32;
}

/** STEP §8.3 4 (WP3): fix tomorrow's flows, allocations and county prices. */
export function stepFixFlows(c: CountyState, r: RegionalContext): void {
  // Links whose notice ran out close, and accepted links whose roads now reach their signposts open.
  advanceLinks(c, r);
  const g = regionOf(c);
  const q = rp(c);
  const p = pp(c);
  const n = c.towns.length;
  const links = pairLinks(c);
  const towns = c.towns.map((_, i) => flowTown(c, i));
  const res = fixFlows(towns, links, q, p.firms.leakCap, (i, j) => hasPact(c, 'twin', i, j));
  const flows = res.towns;
  // Kept at a fixed stride of 6 so a town founded tomorrow does not shift the pairs.
  g.commute = new Array<number>(MAX_TOWNS * MAX_TOWNS * 3).fill(0);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let h = 0; h < 3; h++) g.commute[(a * MAX_TOWNS + b) * 3 + h] = res.commute[(a * n + b) * 3 + h];

  // ---- Tourism: the county pool and each town's share (§5.10), with adverts and the festival ----
  const day = r.dayIndex + 1;
  const pulls = towns.map((t) => t.pull);
  // Today's adverts start tomorrow and run 3 days (A20).
  for (const d of g.outbox) if (d.kind === 'advert') g.campaigns.push({ from: d.from, to: d.to, cohort: Number(d.item), untilDay: r.dayIndex + q.advertDays });
  g.campaigns = g.campaigns.filter((x) => x.untilDay >= day && x.from < n && x.to < n && isActive(c.towns[x.from]) && isActive(c.towns[x.to]));
  // Kept in a fixed order (advertiser, target, cohort, last day), not the order the moves arrived in.
  g.campaigns.sort((x, y) => x.from - y.from || x.to - y.to || x.cohort - y.cohort || x.untilDay - y.untilDay);
  for (const x of g.campaigns) pulls[x.from] *= 1 + q.advertTourism;
  const active = towns.map((t) => t.active);
  const shares = touristShares(pulls, active, p);
  let sumN = 0;
  for (const t of towns) if (t.active) sumN += t.pop;
  let pool = touristPoolBase(sumN, towns.map((t) => (t.active ? t.attrQ : 0)), p);
  if (g.festivalWeekend !== null && g.festivalWeekend === day) pool *= q.festivalWeekendTourism;
  const fest = c.festival && c.festival.host < n && isActive(c.towns[c.festival.host]) ? c.festival.host : -1;
  for (let i = 0; i < n; i++) {
    if (!active[i]) continue;
    let share = shares[i];
    if (i === fest) {
      const extra = share * q.festivalHost;
      share += extra;
      // Losing still pays: every linked town gets a quarter of the host's extra visitors as day trips.
      for (let j = 0; j < n; j++) if (j !== i && Number.isFinite(links[i * n + j].minutes) && active[j]) flows[j].dayTripsIn += q.festivalLinked * extra * pool;
    }
    flows[i].touristShare = Math.min(1, share);
    flows[i].touristPool = pool;
  }

  // ---- Shared places (§8.5): the agreed places × e^(−t/30), at most 30% of the partner's need ----
  // Each agreement's own places are kept on it (`used`), scaled down with the
  // others when the partner's total hits the cap, so tomorrow's fee charges
  // each provider for what it actually supplied and nothing for an agreement
  // that has not started.
  g.shares = g.shares.filter((s) => s.endDay === null || s.endDay > r.dayIndex);
  const offered = new Array<number>(n * 2).fill(0);
  const got = g.shares.map((s) => {
    if (s.startDay > day || s.provider >= n || s.user >= n || !active[s.provider] || !active[s.user]) return 0;
    const tm = links[s.provider * n + s.user].minutes;
    if (!Number.isFinite(tm)) return 0;
    const x = s.places * expFx(-tm / q.sharedDecay);
    offered[s.user * 2 + (s.service === 'health' ? 0 : 1)] += x;
    return x;
  });
  const capOf = (u: number, k: number) => q.sharedMaxShare * (k === 0 ? towns[u].healthNeed : towns[u].uniNeed);
  const scale = offered.map((x, at) => (x > 0 ? Math.min(1, Math.max(0, capOf(at >> 1, at & 1)) / x) : 0));
  g.shares.forEach((s, x) => {
    const at = s.user * 2 + (s.service === 'health' ? 0 : 1);
    s.used = got[x] > 0 ? got[x] * scale[at] : 0;
  });
  for (let u = 0; u < n; u++) {
    flows[u].sharedHealth = Math.min(offered[u * 2], Math.max(0, capOf(u, 0)));
    flows[u].sharedUniversity = Math.min(offered[u * 2 + 1], Math.max(0, capOf(u, 1)));
  }

  // ---- Shared air (Spirited only): 5% of the upwind ring neighbour's facing edge; the Clean Air Pact halves it ----
  if (c.settings.rivalry === 'spirited') {
    const share = q.sharedAir * (g.cleanAir ? 0.5 : 1);
    for (let i = 0; i < n; i++) {
      if (!active[i]) continue;
      const site = (c.towns[i].site + 1) % c.sites.length;
      const j = c.towns.findIndex((t) => t.site === site);
      if (j >= 0 && active[j]) flows[j].airIn += share * eastEdge(c.towns[i]);
    }
  }

  // ---- A20: yesterday's adverts, stamps and coach gifts reach their town tomorrow ----
  // Several towns may advertise to one cohort at once: each is a bit in `advertBy`, and each gets its bonus.
  for (const x of g.campaigns) {
    const f = flows[x.to];
    if (!f.advertBy) f.advertBy = new Array<number>(10).fill(0);
    f.advert[x.cohort] = p.migration.advert;
    f.advertBy[x.cohort] |= 1 << x.from;
  }
  const visitors = new Map<number, Set<number>>();
  for (const d of g.outbox) {
    if (d.to >= n || !active[d.to]) continue;
    if (d.kind === 'stamp') {
      const s = visitors.get(d.to) ?? new Set<number>();
      s.add(d.from);
      visitors.set(d.to, s);
    }
    if (d.kind === 'gift' && d.item === 'coach') flows[d.to].dayTripsIn += q.coachTrips / 12;
  }
  for (const [to, s] of visitors) flows[to].buzz = Math.min(q.stampBuzzCap, q.stampBuzz * s.size);

  c.flows = { towns: flows };

  // ---- Goods and food allocations, and the county prices ----
  const world = worldAt(c.seed, r.month, { startMonth: c.season.startMonth, boomBust: c.season.theme === 'boomBust' }, p);
  const f = p.firms;
  const goodsBand = [f.goodsUnit * world.goods * f.exportPrice[0], f.goodsUnit * world.goods * f.goodsImport];
  const foodBand = [f.foodBand[0] * world.goods, f.foodBand[1] * world.goods];
  const allocations: Allocation[] = [];
  const market = [c.market.goods, c.market.food];
  const bands = [goodsBand, foodBand];
  const unit = [f.goodsUnit, f.foodUnit];
  (['goods', 'food'] as const).forEach((good, gi) => {
    const gt: GoodsTown[] = c.towns.map((t, i) => ({ active: active[i], surplus: t.marketMemo?.surplus?.[gi] ?? 0 }));
    let supply = 0;
    let demand = 0;
    for (const x of gt) if (x.active) (x.surplus > 0 ? (supply += x.surplus) : (demand -= x.surplus));
    const m = market[gi];
    m.supply = supply;
    m.demand = demand;
    m.p = nextPrice(m.p, supply, demand, bands[gi][0] / unit[gi], bands[gi][1] / unit[gi], q);
    allocations.push(...allocateGoods(gt, links, unit[gi] * m.p, q.shipping, bands[gi][0], good));
  });
  c.allocations = allocations;
}
