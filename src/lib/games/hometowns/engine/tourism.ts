// Tourism (WP2c, spec §5.10): a second economy that competes with factories.
//
// A town's attractions, culture, fun and scenery make up its Attr; safety
// and nature make up its quality Q. The county's tourist pool is shared at
// the Regional Day by each town's pull X = (Attr·Q)^1.1 · (Rep/50) ·
// (0.3 + 0.7·Aw), against "Kingsport and elsewhere". Each month (M6) the
// town hosts its share of the pool, swung by the real UK calendar and the
// World, limited by its hotel beds, and the visitors judge it: crowded
// attractions, crime and slow roads lower satisfaction, and reputation
// follows satisfaction with τ 12 months, about a real day. That lag is the
// resort cycle (Butler): visitors fill the beds, more hotels get built, the
// crowds sour the visit, and reputation falls a day later, when the beds are
// already there. Nothing scripts it; the cure is a new attraction.
//
// Before the Regional Day can share the pool (a solo county's first day, or
// before WP3 lands) the town estimates its own share with the same formula,
// so a solo county has a working tourist trade from the start.

import { BEACH, BUILDINGS } from './content';
import { flowsFor, population } from './core';
import { clamp, lnFx, powFx, smooth } from './fx';
import { neutral } from './derived';
import { T_SAND, TF_COAST, terrainKind, terrainOf } from './terrain';
import { B_DAMAGED, B_KIND, B_X, B_Y, TILES, cellOf, constructionLeft, parcelOpen, tileIndex, tileX, tileY } from './tiles';
import { eventIs, hasBuildingDone, memoOf, policyOn } from './trade';
import { COVERAGES, FUNDING_KEYS, STARS, type MonthContext, type TourismSlot, type TownState } from './types';
import type { Params } from './params';

const COV_FUN = COVERAGES.indexOf('fun');
const STAR_NATURE = STARS.indexOf('nature');
const STAR_AROUND = STARS.indexOf('around');

export interface Attractions {
  /** Attr: appeal and the rest, in attraction points. */
  attr: number;
  /** The part from buildings and the beach (appeal × condition × funding). */
  appeal: number;
  /** Visitors a month the attractions take before they feel crowded (AttrCap). */
  cap: number;
  /** Quality Q (0–1) and the town's beach tiles (clean ones). */
  quality: number;
  beachTiles: number;
  cleanBeach: number;
}

/**
 * Attr_c and Q_c (§5.10) from stored state and this month's fields. A
 * damaged or unfinished attraction draws nobody; funding scales appeal as it
 * scales coverage. "First of its kind in the County" and the festival, Great
 * Work and Tourist Trail terms need county knowledge the snapshot does not
 * carry yet, so they count zero here.
 */
export function attractionsOf(t: TownState, m: MonthContext): Attractions {
  const tp = m.params.tourism;
  const fundEffect = m.params.fields.fundEffect;
  let appeal = 0;
  let cap = 0;
  for (const b of t.buildings) {
    const def = BUILDINGS[b[B_KIND]];
    if (!def || (!def.appeal && !def.visitorCap)) continue;
    if (constructionLeft(t, tileIndex(b[B_X], b[B_Y])) > 0 || b[B_DAMAGED] > 0) continue;
    const fund = t.funding[FUNDING_KEYS.indexOf(def.funding)] ?? 1;
    if (def.appeal) appeal += def.appeal * (fundEffect[fund] ?? 1);
    if (def.visitorCap) cap += def.visitorCap;
  }
  // The beach: appeal 15 plus 2 per clean sand tile on the coast (§6.5).
  let beachTiles = 0;
  let cleanBeach = 0;
  if (t.siteKind === 'coast') {
    const terrain = terrainOf(t);
    const poll = m.derived.fields?.pollution;
    const clean = m.params.fields.cleanBeachPollution;
    for (let i = 0; i < TILES; i++) {
      if (terrainKind(terrain[i]) !== T_SAND || (terrain[i] & TF_COAST) === 0 || !parcelOpen(t, tileX(i), tileY(i))) continue;
      beachTiles += 1;
      if (!poll || poll[cellOf(i)] < clean) cleanBeach += 1;
    }
    if (beachTiles > 0) {
      appeal += BEACH.appeal + BEACH.perCleanTile * cleanBeach;
      cap += BEACH.visitorCap;
    }
  }
  const cultureStar = (100 * t.culture) / (t.culture + m.params.stars.cultureHalf);
  const fun = m.derived.coverage?.town[COV_FUN] ?? 0;
  let scenic = 0;
  const sc = m.derived.fields?.scenic;
  if (sc) for (let c = 0; c < sc.length; c++) if (sc[c] > scenic) scenic = sc[c];
  const attr = appeal + tp.attrWeights[0] * cultureStar + scenic + tp.attrWeights[1] * fun;

  const safety = m.derived.fields?.safety ?? 100;
  const nature = t.perceived[STAR_NATURE] ?? 50;
  const [qa, qb, qc, qd] = tp.quality;
  let quality = (qa + (qb * safety) / 100) * (qc + (qd * nature) / 100);
  if (policyOn(t, 'litterPickers')) quality *= tp.litterQuality;
  return { attr, appeal, cap, quality, beachTiles, cleanBeach };
}

/** The Outside World gate for visitors: the County Road, plus an Airfield (§5.11's gate terms). */
export function touristGate(t: TownState, p: Params): number {
  const [road, , air] = p.migration.gate;
  return road + (hasBuildingDone(t, 'airfield') ? air : 0);
}

/** A town's tourist pull X = (Attr·Q)^1.1 · (Rep/50) · (0.3 + 0.7·Aw) · Gate · Gem (§5.10). */
export function touristPull(attrQ: number, rep: number, aw: number, gate: number, gem: number, p: Params): number {
  if (!(attrQ > 0)) return 0;
  const [a0, a1] = p.tourism.awareness;
  return powFx(attrQ, p.tourism.shareExp) * (rep / 50) * (a0 + a1 * aw) * gate * gem;
}

/**
 * For WP3's Regional Day (§8.3 step 4): each active town's share of the
 * county's tourist pool, X_c / (Σ_c′ X_c′ + 2·mean_{c′≠c} X_c′ + X_elsewhere).
 * The 2·mean term is the pull of Kingsport and elsewhere; WP2c reads its
 * mean over the OTHER towns and adds a fixed X_elsewhere for resorts outside
 * the county. With the mean over all towns, a solo county's share is always
 * exactly 1/3 whatever its reputation, so word of mouth (R4) and the resort
 * cycle (B3) could never act; in a county of equal towns the two readings
 * differ only by the town's own term.
 */
export function touristShares(pulls: readonly number[], active: readonly boolean[], p: Params): number[] {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < pulls.length; i++)
    if (active[i] && pulls[i] > 0) {
      sum += pulls[i];
      n += 1;
    }
  return pulls.map((x, i) => {
    if (!active[i] || !(x > 0)) return 0;
    const others = n > 1 ? (sum - x) / (n - 1) : 0;
    return x / (sum + 2 * others + p.tourism.elsewhere);
  });
}

/**
 * For WP3: the county pool's base, (300 + 0.03·ΣN + 4·Σ Attr) visitors a
 * month, before the real season and the World, which each town applies
 * month by month (its calendar month and coast swing are its own).
 */
export function touristPoolBase(sumN: number, attrs: readonly number[], p: Params): number {
  const tp = p.tourism;
  let a = 0;
  for (const x of attrs) a += x > 0 ? x : 0;
  return tp.poolBase + tp.poolPerPop * (sumN > 0 ? sumN : 0) + tp.poolPerAttr * a;
}

/** The real UK calendar (§5.10), with coast sites swinging 1.5× as far from 1.0. */
export function realSeason(calendarMonth: number, coast: boolean, p: Params): number {
  const s = p.tourism.season[((calendarMonth % 12) + 12) % 12];
  return coast ? 1 + p.tourism.coastSwing * (s - 1) : s;
}

/** Visitor satisfaction (§5.10), 0–100. */
export function satisfaction(visitors: number, attrCap: number, quality: number, crime: number, around: number, p: Params): number {
  const [base, qw, crowd, cw, c0, aw] = p.tourism.sat;
  const over = visitors / (attrCap + p.tourism.baseCap) - 1;
  return clamp(base + qw * (100 * quality - 50) - crowd * (over > 0 ? over : 0) - cw * (crime - c0 > 0 ? crime - c0 : 0) + aw * (around - 50), 0, 100);
}

/** STEP M6 (WP2c): visitors, beds, satisfaction, reputation and awareness → derived.tourism (+ t.rep, t.aw, t.realised). */
export function stepTourism(t: TownState, m: MonthContext): void {
  const p = m.params;
  const tp = p.tourism;
  const memo = memoOf(t);
  const fl = flowsFor(m);
  const dev = m.derived.development ?? neutral.development();
  const pop = population(t);
  const a = attractionsOf(t, m);
  const attrQ = a.attr * a.quality;
  const gate = touristGate(t, p);
  const median = m.snapshot.medianPop;
  const gem = median > 0 && pop < median && t.rep >= tp.gem[1] ? tp.gem[0] : 1;
  const pull = touristPull(attrQ, t.rep, t.aw, gate, gem, p);

  // The pool and this town's share: fixed at the Regional Day, or, before one has shared it, the
  // town's own estimate from the same formulas (a solo county's first day; or until WP3 lands).
  const fixed = fl.touristPool > 0;
  const sumN = m.snapshot.sumN > 0 ? m.snapshot.sumN : pop;
  const poolBase = fixed ? fl.touristPool : touristPoolBase(sumN, [a.attr], p);
  const share = fixed ? fl.touristShare : touristShares([pull], [true], p)[0];
  const coast = t.siteKind === 'coast';
  const season = realSeason(m.calendarMonth, coast, p);
  let world = m.world.tourism;
  if (coast && eventIs(m, 'ferryFun')) world *= tp.ferryFun;
  const pool = poolBase * season * world;

  // Beds: finished hotel-variant Leisure tiles (WP2e's supply count); Short-let Limits trims them.
  let beds = dev.beds > 0 ? dev.beds : 0;
  if (policyOn(t, 'shortLetLimits')) beds *= tp.shortLetBeds;
  const bedCap = beds * tp.staysPerBed * tp.maxOccupancy;

  let dayTrips = fl.dayTripsIn > 0 ? fl.dayTripsIn : 0;
  if (eventIs(m, 'sunnyWeekend')) dayTrips *= tp.eventDayTrips[0];
  if (eventIs(m, 'bigConcert')) dayTrips *= tp.eventDayTrips[1];

  // Satisfaction depends on this month's crowds, and the stays on satisfaction: two fixed passes
  // from last month's satisfaction settle it (deterministic, no iteration to convergence).
  const crime = 100 - (m.derived.fields?.safety ?? 100);
  const around = t.perceived[STAR_AROUND] ?? 50;
  const wanted = pool * share;
  const [s0, s1] = tp.staySat;
  const staysAt = (sat: number) => Math.min(wanted * (s0 + (s1 * sat) / 100), bedCap);
  let sat = memo.sat;
  for (let k = 0; k < 2; k++) sat = satisfaction(staysAt(sat) + dayTrips, a.cap, a.quality, crime, around, p);
  const demand = wanted * (s0 + (s1 * sat) / 100);
  const stays = Math.min(demand, bedCap);
  const visitors = stays + dayTrips;

  // Reputation follows satisfaction (τ 12 months); awareness spreads by word of mouth (Bass) and fades.
  const repBefore = t.rep;
  const awBefore = t.aw;
  t.rep = clamp(smooth(t.rep, sat, tp.repTau), 0, 100);
  const pAd = tp.bassP * (policyOn(t, 'tourismPromotion') ? tp.promotion : 1);
  t.aw = clamp(t.aw + ((pAd + tp.bassQ * t.aw) * (1 - t.aw)) / 12 - (tp.bassForget * t.aw) / 12, 0, 1);

  const hotelNights = stays * tp.stayNights;
  const spend = stays * tp.stayNights * (tp.hotelNight + tp.stayShopSpend) + dayTrips * tp.dayTripSpend;
  const slot: TourismSlot = {
    stays,
    dayTrips,
    beds,
    attr: a.attr,
    quality: a.quality,
    satisfaction: sat,
    hotelNights,
    spend,
    visitorRatio: visitors / (pop > 1 ? pop : 1),
  };
  m.derived.tourism = slot;

  const r = t.realised;
  r.visitorsHosted += stays;
  r.dayTripsHosted += dayTrips;
  r.touristSpend += stays * tp.stayNights * (tp.hotelNight + tp.stayShopSpend);
  r.dayTripSpend += dayTrips * tp.dayTripSpend;

  memo.sat = sat;
  memo.visitors = visitors;
  memo.bedDemand = demand / (tp.staysPerBed * tp.maxOccupancy);
  memo.attrQ = attrQ;
  memo.pull = pull;

  whyVisitors(m, { pool: poolBase, share, season, world, sat, stays, demand, dayTrips, repBefore, aw: awBefore, attrQ, gate, gem, fixed });
}

/**
 * The visitors' Why: stays are a product of named factors (the attractions'
 * pool share at a neutral reputation, then the season, the World, reputation,
 * awareness, satisfaction and the beds cap), so each factor's term is its log
 * share of the stays' distance from the neutral figure, and the terms plus
 * the attractions' term and day trips sum to the visitors exactly.
 */
function whyVisitors(
  m: MonthContext,
  v: { pool: number; share: number; season: number; world: number; sat: number; stays: number; demand: number; dayTrips: number; repBefore: number; aw: number; attrQ: number; gate: number; gem: number; fixed: boolean },
): void {
  const p = m.params;
  m.why.set('visitors', v.stays + v.dayTrips);
  if (v.dayTrips > 0) m.why.add('vis.dayTrips', v.dayTrips, 'visitors');
  if (!(v.stays > 0)) return;
  // The neutral figure: this pool and share as if reputation were 50, everyone knew the town and satisfaction were 60.
  let shareNeutral = v.share;
  let repF = 1;
  let awF = 1;
  if (!v.fixed && v.attrQ > 0) {
    const atRep = touristPull(v.attrQ, 50, 1, v.gate, v.gem, p);
    const atAw = touristPull(v.attrQ, v.repBefore, 1, v.gate, v.gem, p);
    const now = touristPull(v.attrQ, v.repBefore, v.aw, v.gate, v.gem, p);
    const sh = (x: number) => touristShares([x], [true], p)[0];
    shareNeutral = sh(atRep);
    repF = sh(atAw) / Math.max(1e-12, shareNeutral);
    awF = sh(now) / Math.max(1e-12, sh(atAw));
  }
  const [s0, s1] = p.tourism.staySat;
  const satNeutral = s0 + (s1 * p.tourism.sat[0]) / 100;
  const neutralStays = v.pool * shareNeutral * satNeutral;
  const factors: [string, number][] = [
    ['vis.season', v.season],
    ['vis.world', v.world],
    ['vis.reputation', repF],
    ['vis.awareness', awF],
    ['vis.satisfaction', (s0 + (s1 * v.sat) / 100) / satNeutral],
    ['vis.beds', v.demand > 0 ? v.stays / v.demand : 1],
  ];
  // stays = neutral × Π factors, so ln(stays/neutral) = Σ ln(factor): each factor takes its log's share of the gap.
  const total = lnFx(v.stays / Math.max(1e-12, neutralStays));
  const gap = v.stays - neutralStays;
  m.why.add('vis.attractions', neutralStays, 'visitors');
  if (Math.abs(total) > 1e-12) for (const [key, f] of factors) if (f > 0) m.why.add(key, (gap * lnFx(f)) / total, 'visitors');
}
