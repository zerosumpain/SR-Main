// M3 Fields (spec §3.6, §5.4, §5.5, §5.7) on the 32×32 grid of 2×2-tile
// cells, in dependency order:
//
//   coverage (services.ts) → travel times and road loads (transport.ts, with
//   last month's congestion) → pollution and noise → Safety (safety.ts) →
//   access → land value (landvalue.ts)
//
// Pollution: emissions (Industry tiles by level, plants, the Airfield, busy
// roads), two spread passes of P' = 0.6·P + 0.1·Σ(4 neighbours) that keep the
// share an edge cell would send off the map (gain exactly 1: the kernel moves
// pollution, never makes it), then absorption by park and tree tiles, then the
// ~2-month lag toward that target (A26: the lagged field is stored in
// lag.poll). Noise: busy roads plus the loudest source in the cell, one
// spread pass. Access uses the district travel times c_ab of the cell's
// district. This step writes the land-value plane, the pollution lag and the
// town pollution stock PS; everything else is derived and dies with the month.

import { BEACH } from './content';
import type { Params } from './params';
import { flowsFor } from './core';
import { smooth } from './fx';
import { homesTaxPercent, landValueTargets, landValueTerms, nextLandValue, premiumOf, scenicOf, type LandValueInputs } from './landvalue';
import { crimeField, expectedLabour, giniOf, safetyTerms, type CrimeInputs } from './safety';
import { COV, servicesOf, type Services } from './services';
import { CELL_OF, cellsOr, decay, hotelBeds, isBeach, modelOf, policyOn, runFor, scratch, scratchU8, type SpaceRun } from './space';
import { travelOf } from './transport';
import { utilitiesOf } from './utilities';
import { CELLS, CELLS_PER_SIDE, DISTRICTS, MARK_CARFREE, TILES, cellOf, districtOf, encodeCells, planesOf } from './tiles';
import {
  FUNDING_KEYS,
  FUND_LOW,
  Z_INDUSTRY,
  Z_LEISURE,
  Z_SHOPS,
  type CoverageSlot,
  type FieldsSlot,
  type MonthContext,
  type TickContext,
  type TownState,
  type TravelSlot,
  type UtilitiesSlot,
} from './types';

/**
 * The spread kernel, conserving: each cell keeps `keep` plus the share it
 * would send to off-map neighbours, and gives `side` to each in-map one. With
 * keep + 4·side = 1 the total is unchanged by any number of passes.
 */
export function spread(a: Float64Array, keep: number, side: number, passes: number): Float64Array {
  let cur = a;
  for (let k = 0; k < passes; k++) {
    const out = new Float64Array(CELLS);
    for (let c = 0; c < CELLS; c++) {
      const v = cur[c];
      if (v === 0) continue;
      const x = c % CELLS_PER_SIDE;
      const y = (c - x) / CELLS_PER_SIDE;
      let kept = keep;
      if (y > 0) out[c - CELLS_PER_SIDE] += v * side;
      else kept += side;
      if (x > 0) out[c - 1] += v * side;
      else kept += side;
      if (x < CELLS_PER_SIDE - 1) out[c + 1] += v * side;
      else kept += side;
      if (y < CELLS_PER_SIDE - 1) out[c + CELLS_PER_SIDE] += v * side;
      else kept += side;
      out[c] += v * kept;
    }
    cur = out;
  }
  return passes > 0 ? cur : Float64Array.from(a);
}

/**
 * One month of the stored pollution lag: P += share·(target − P), kept whole.
 * Plain rounding would stall a cell one point from its target forever, so a
 * cell at least half a point away always moves one step toward it.
 */
export function lagStep(prev: number, target: number, share: number): number {
  const next = prev + share * (target - prev);
  // The stored plane is u8, which would turn a NaN into a silent 0: fail the month instead.
  if (!Number.isFinite(next)) throw new Error(`pollution lag is ${next}`);
  let r = Math.round(next);
  if (r === prev && (target - prev >= 0.5 || prev - target >= 0.5)) r = prev + (target > prev ? 1 : -1);
  return r < 0 ? 0 : r > 100 ? 100 : r;
}

export interface FieldsOut {
  slot: FieldsSlot;
  lv: Uint8Array;
  poll: Uint8Array;
  ps: number;
  /** Safety's Why terms. */
  terms: [string, number][];
  /** The inputs of LV*, kept so the lens can list a cell's terms (landValueTerms). */
  lvInputs: LandValueInputs;
}

/** Per district → per cell through the cell's access district (0 where it has none). */
/** The per-district access sums (its own small function, so the engine inlines decay into the loops). */
function accessRows(
  M: Float64Array,
  pd: Int32Array,
  jobsP: Float64Array,
  custP: Float64Array,
  jobsTot: number,
  custTot: number,
  attractions: number[],
  appealD: Float64Array,
  freightPoints: number[],
  toKingsport: Float64Array,
  kingsport: boolean,
  p: Params,
  score: number,
  jobsD: Float64Array,
  custD: Float64Array,
  visitorD: Float64Array,
  freightD: Float64Array,
): void {
  const f = p.fields;
  const fsCap = f.freightScore[5];
  const invJ = 1 / f.jobsDecay;
  const invC = 1 / f.custDecay;
  const invV = 1 / f.visitorDecay;
  const invF = 1 / f.freightDecay;
  const P = pd.length;
  for (let s = 0; s < P; s++) {
    const a = pd[s];
    const row = a * DISTRICTS;
    let js = 0;
    let cs = 0;
    for (let q = 0; q < P; q++) {
      const c = M[row + pd[q]];
      if (c === Infinity) continue;
      js += jobsP[q] * decay(c * invJ);
      cs += custP[q] * decay(c * invC);
    }
    let vs = 0;
    for (let k = 0; k < attractions.length; k++) {
      const q = attractions[k];
      const c = M[row + pd[q]];
      if (c !== Infinity) vs += appealD[pd[q]] * decay(c * invV);
    }
    jobsD[a] = (100 * js) / (jobsTot + 1);
    custD[a] = (100 * cs) / (custTot + 1);
    const x = vs / f.visitorScale;
    visitorD[a] = (100 * x) / (1 + x);
    let cmin = Infinity;
    const toK = toKingsport[a];
    if (kingsport && toK !== Infinity) cmin = toK + p.transport.terminalMinutes;
    for (let k = 0; k < freightPoints.length; k++) {
      const c = M[row + freightPoints[k]];
      if (c < cmin) cmin = c;
    }
    freightD[a] = cmin === Infinity ? 0 : (100 * decay(cmin * invF) * score) / fsCap;
  }
}

function toCells(perDistrict: Float64Array, cellDistrict: Int16Array): Float64Array {
  const out = new Float64Array(CELLS);
  for (let c = 0; c < CELLS; c++) {
    const d = cellDistrict[c];
    if (d >= 0) out[c] = perDistrict[d];
  }
  return out;
}

/** M3 for one run (memoised); pure: it computes the stored planes' next values but writes nothing. */
export function fieldsOf(run: SpaceRun): FieldsOut {
  if (run.fields) return run.fields as FieldsOut;
  const { t, p, ctx } = run;
  const f = p.fields;
  const m = modelOf(run);
  const net = m.net;
  const svc: Services = servicesOf(run);
  const cov = svc.slot.cov;
  const tr = travelOf(run).slot;
  const flows = flowsFor(ctx);

  // ---- Pollution --------------------------------------------------------------------
  const cleanAir = policyOn(t, 'cleanAirRules') ? f.cleanAir : 1;
  const emit = scratch('fd.emit', CELLS);
  const maxLoad = scratch('fd.maxLoad', CELLS);
  const noiseSrc = scratch('fd.noiseSrc', CELLS);
  const nightMarket = policyOn(t, 'nightMarket');
  const carFreeOn = policyOn(t, 'carFreeCentre');
  const carFree = scratchU8('fd.carFree', CELLS);
  const roadCell = scratchU8('fd.roadCell', CELLS);
  {
    // Locals for the 4,096-tile pass (the same reads, hoisted out of the loop).
    const kind = net.kind;
    const rail = net.rail;
    const load = tr.load;
    const marks = m.marks;
    const level = m.level;
    const zone = m.zone;
    const noiseRail = f.noiseRail;
    const noiseIndustry = f.noiseIndustry;
    const noiseLeisure = f.noiseLeisure;
    const noiseNightMarket = f.noiseNightMarket;
    const industryEmissions = f.industryEmissions;
    for (let i = 0; i < TILES; i++) {
      const c = CELL_OF[i];
      if (kind[i] >= 0) {
        roadCell[c] = 1;
        if (load[i] > maxLoad[c]) maxLoad[c] = load[i];
      }
      if (rail[i] && noiseRail > noiseSrc[c]) noiseSrc[c] = noiseRail;
      if (carFreeOn && marks[i] & MARK_CARFREE) carFree[c] = 1;
      const lv = level[i];
      if (lv === 0) continue;
      const z = zone[i];
      if (z === Z_INDUSTRY) {
        emit[c] += industryEmissions[lv - 1] * cleanAir;
        if (lv >= 3 && noiseIndustry > noiseSrc[c]) noiseSrc[c] = noiseIndustry;
      } else if (z === Z_LEISURE && lv >= 3) {
        if (noiseLeisure > noiseSrc[c]) noiseSrc[c] = noiseLeisure;
      } else if (z === Z_SHOPS && nightMarket && noiseNightMarket > noiseSrc[c]) noiseSrc[c] = noiseNightMarket;
    }
  }
  for (const b of m.buildings) {
    if (!b.active) continue;
    const area = b.tiles.length || 1;
    if (b.def.pollution) for (const ti of b.tiles) emit[cellOf(ti)] += b.def.pollution / area;
    const nz = b.def.noise ?? 0;
    if (nz > 0)
      for (const ti of b.tiles) {
        const c = CELL_OF[ti];
        if (nz > noiseSrc[c]) noiseSrc[c] = nz;
      }
  }
  {
    const roadPollution = f.roadPollution;
    const roadPollutionCap = f.roadPollutionCap;
    for (let c = 0; c < CELLS; c++) {
      const r = roadPollution * maxLoad[c];
      emit[c] += r > roadPollutionCap ? roadPollutionCap : r;
    }
  }
  if (ctx.rivalry === 'spirited' && flows.airIn > 0) for (let cy = 0; cy < CELLS_PER_SIDE; cy++) emit[cy * CELLS_PER_SIDE] += flows.airIn;
  const spreadP = spread(emit, f.pollKeep, f.pollSpread, f.pollPasses);
  const trees = svc.trees;
  const treeF = policyOn(t, 'treePlanting') ? f.treePlanting : 1;
  const prevPoll = cellsOr(t.lag.poll, 0, true);
  const poll = new Uint8Array(CELLS);
  const pollution = new Float64Array(CELLS);
  {
    const parkAbsorb = f.parkAbsorb;
    const treeAbsorb = f.treeAbsorb;
    const parkTiles = svc.parkTiles;
    const pollLag = f.pollLag;
    for (let c = 0; c < CELLS; c++) {
      let v = spreadP[c] - parkAbsorb * parkTiles[c] - treeAbsorb * trees[c];
      v = (v < 0 ? 0 : v > 100 ? 100 : v) * treeF;
      poll[c] = lagStep(prevPoll[c], v, pollLag);
      pollution[c] = poll[c];
    }
  }

  // ---- Noise ------------------------------------------------------------------------
  const noise0 = scratch('fd.noise0', CELLS);
  const noiseRoad = f.noiseRoad;
  for (let c = 0; c < CELLS; c++) {
    const v = noiseSrc[c] + noiseRoad * maxLoad[c];
    noise0[c] = v > 100 ? 100 : v;
  }
  const noise = spread(noise0, f.pollKeep, f.pollSpread, f.noisePasses);
  const carFreeNoise = f.carFreeNoise;
  for (let c = 0; c < CELLS; c++) {
    let v = noise[c] * (carFree[c] ? carFreeNoise : 1);
    v = v < 0 ? 0 : v > 100 ? 100 : v;
    noise[c] = v;
  }

  // ---- Population weights, density, the town pollution stock ---------------------------
  const w = m.cellRes;
  let wsum = 0;
  let psum = 0;
  let dsum = 0;
  const dens = scratch('fd.dens', CELLS);
  const cellRes = m.cellRes;
  const cellJobs = m.cellJobs;
  const densityRef = f.densityRef;
  for (let c = 0; c < CELLS; c++) {
    const d = (cellRes[c] + cellJobs[c]) / densityRef;
    dens[c] = d > 1 ? 1 : d;
    if (w[c] > 0) {
      wsum += w[c];
      psum += w[c] * pollution[c];
      dsum += w[c] * dens[c];
    }
  }
  const pollutionPop = wsum > 0 ? psum / wsum : 0;
  const ps = smooth(t.ps, pollutionPop, f.psTau);

  // ---- Safety -----------------------------------------------------------------------
  const lab = expectedLabour(m, flows.commutersOut, p);
  const gini = giniOf([...m.tierPop, m.students], [...lab.incomePerPerson, lab.studentIncome]);
  let policy = 1;
  if (policyOn(t, 'neighbourhoodWatch')) policy *= p.safety.neighbourhoodWatch;
  if (nightMarket) policy *= p.safety.nightMarket;
  const lvNow = cellsOr(t.lv, 1, true);
  const ci: CrimeInputs = {
    uL: lab.u[0],
    gini,
    densityNorm: wsum > 0 ? dsum / wsum : 0,
    fun: svc.slot.town[COV.fun],
    edu: t.edu,
    policy,
    youth: svc.youth,
    dens,
    lv: lvNow,
    police: cov[COV.police],
    weights: w,
  };
  const cr = crimeField(ci, p);
  const terms = safetyTerms(ci, p, cr.safety);

  // ---- Access -------------------------------------------------------------------------
  const access = accessFields(run, tr, pollution);

  // ---- Land value ---------------------------------------------------------------------
  const roadsLow = t.funding[FUNDING_KEYS.indexOf('roads')] === FUND_LOW;
  const potholes = new Uint8Array(CELLS);
  if (roadsLow) for (let c = 0; c < CELLS; c++) potholes[c] = roadCell[c];
  const scenic = scenicOf(m.terrain, p.landValue.scenic);
  const premium = premiumOf(t, cr.safety, homesTaxPercent(t, m.tierPop), p);
  const lvInputs: LandValueInputs = {
    jobsAccess: access.jobs,
    nature: cov[COV.nature],
    school: cov[COV.school],
    health: cov[COV.health],
    culture: cov[COV.culture],
    transit: cov[COV.transit],
    pollution,
    noise,
    crime: cr.crime,
    scenic,
    bonus: svc.lvBonus,
    potholes,
    premium,
  };
  const lvTarget = landValueTargets(lvInputs, p);
  const lv = nextLandValue(lvNow, lvTarget, f.lvRateCap);

  const slot: FieldsSlot = {
    pollution,
    noise,
    crime: cr.crime,
    lvTarget,
    jobsAccess: access.jobs,
    custAccess: access.cust,
    freight: access.freight,
    visitorAccess: access.visitor,
    pollutionPop,
    safety: cr.safety,
    gini,
    crimePressure: cr.cp,
    scenic,
  };
  const out: FieldsOut = { slot, lv, poll, ps, terms, lvInputs };
  run.fields = out;
  return out;
}

/** The four accesses of §5.4, per cell through each cell's district. */
export function accessFields(run: SpaceRun, tr: TravelSlot, pollution: Float64Array): { jobs: Float64Array; cust: Float64Array; freight: Float64Array; visitor: Float64Array } {
  const { t, p, ctx } = run;
  const f = p.fields;
  const m = modelOf(run);
  const net = m.net;
  const M = tr.minutes;
  const ports: number[] = [];
  for (let d = 0; d < DISTRICTS; d++) if (net.port[d] >= 0) ports.push(d);
  const flows = flowsFor(ctx);

  // Visitors located this month: overnight stays at hotels (else attractions), day trips at attractions.
  // M3 runs before M6, so the stays are last month's as WP2c's tourism step left them (after the
  // satisfaction and bed caps); before the town's first tourism month, the day's fixed share of the pool.
  const trips = flows.dayTripsIn;
  const memo = t.marketMemo;
  const stays = memo ? Math.max(0, memo.visitors - trips) : flows.touristShare * flows.touristPool;
  const bedsD = scratch('ac.beds', DISTRICTS);
  const appealD = scratch('ac.appeal', DISTRICTS);
  const pl = planesOf(t);
  for (let i = 0; i < TILES; i++) {
    if (m.zone[i] !== Z_LEISURE || m.level[i] === 0) continue;
    const a = net.attach[i];
    if (a < 0) continue;
    const beds = hotelBeds(pl.lvl[i], m.level[i]);
    if (beds > 0) bedsD[districtOf(a)] += beds;
  }
  for (const b of m.buildings) {
    if (!b.active || !b.def.appeal || b.district < 0) continue;
    appealD[b.district] += b.def.appeal * b.fundEffect;
  }
  // The beach: 15 appeal shared over its districts, plus 2 per clean beach tile.
  if (t.siteKind === 'coast') {
    let beachTiles = 0;
    const perD = new Float64Array(DISTRICTS);
    const clean = new Float64Array(DISTRICTS);
    for (let i = 0; i < TILES; i++) {
      if (!isBeach(t, m.terrain, i)) continue;
      const d = net.cellDistrict[cellOf(i)];
      if (d < 0) continue;
      beachTiles++;
      perD[d]++;
      if (pollution[cellOf(i)] < f.cleanBeachPollution) clean[d]++;
    }
    if (beachTiles > 0) for (let d = 0; d < DISTRICTS; d++) appealD[d] += (BEACH.appeal * perD[d]) / beachTiles + BEACH.perCleanTile * clean[d];
  }
  let bedsT = 0;
  let appealT = 0;
  for (let d = 0; d < DISTRICTS; d++) {
    bedsT += bedsD[d];
    appealT += appealD[d];
  }
  const visitorsD = scratch('ac.visitors', DISTRICTS);
  for (let d = 0; d < DISTRICTS; d++) {
    if (bedsT > 0) visitorsD[d] += (stays * bedsD[d]) / bedsT;
    else if (appealT > 0) visitorsD[d] += (stays * appealD[d]) / appealT;
    if (appealT > 0) visitorsD[d] += (trips * appealD[d]) / appealT;
  }

  // Freight points: the Kingsport signpost, a working rail freight yard, a harbour.
  const yards = m.buildings.filter((b) => b.active && b.def.id === 'freightYard' && b.district >= 0);
  const harbours = m.buildings.filter((b) => b.active && b.def.id === 'harbour' && b.district >= 0);
  const hasRail = net.hasRail && m.buildings.some((b) => b.active && b.def.id === 'railStation');
  const [fsRoad, fsRail, fsHarbour, fsRiver, fsFlat, fsCap] = f.freightScore;
  let score = net.kingsportComp >= 0 ? fsRoad : 0;
  if (yards.length && hasRail) score += fsRail;
  if (harbours.length) score += fsHarbour;
  if (t.siteKind === 'river') score += fsRiver;
  if (t.siteKind === 'flatland') score += fsFlat;
  if (score > fsCap) score = fsCap;
  const freightPoints = [...yards, ...harbours].map((b) => b.district);

  const jobsD = scratch('ac.jobs', DISTRICTS);
  const custD = scratch('ac.cust', DISTRICTS);
  const freightD = scratch('ac.freight', DISTRICTS);
  const visitorD = scratch('ac.visitor', DISTRICTS);
  const P = ports.length;
  const pd = Int32Array.from(ports);
  const jobsP = scratch('ac.jobsP', P);
  const custP = scratch('ac.custP', P);
  const attractions: number[] = [];
  let jobsTot = 0;
  let custTot = 0;
  for (let q = 0; q < P; q++) {
    const b = pd[q];
    jobsP[q] = m.distJobs[b];
    custP[q] = m.distRes[b] + f.visitorWeight * visitorsD[b];
    jobsTot += jobsP[q];
    custTot += custP[q];
    if (appealD[b] > 0) attractions.push(q);
  }
  accessRows(M, pd, jobsP, custP, jobsTot, custTot, attractions, appealD, freightPoints, tr.toSignpost[0], net.kingsportComp >= 0, p, score, jobsD, custD, visitorD, freightD);
  return {
    jobs: toCells(jobsD, net.cellDistrict),
    cust: toCells(custD, net.cellDistrict),
    freight: toCells(freightD, net.cellDistrict),
    visitor: toCells(visitorD, net.cellDistrict),
  };
}

/**
 * The space fields at any moment, from stored state alone and without writing
 * anything: what a tick step (WP2e's desirability L_k(x)), the page's lenses
 * and the inspector read between month steps, since blackboard slots die with
 * the month. It costs about one M2–M4 (a few milliseconds on a metropolis).
 * `lvTerms(cell)` lists a cell's LV* terms for the Land Value lens (§5.7).
 */
export function spaceAt(
  t: TownState,
  ctx: TickContext,
): {
  utilities: UtilitiesSlot;
  coverage: CoverageSlot;
  fields: FieldsSlot;
  travel: TravelSlot;
  lvTerms: (cell: number) => [key: string, amount: number][];
} {
  const run = runFor(t, ctx, null);
  const utilities = utilitiesOf(run);
  const coverage = servicesOf(run).slot;
  const out = fieldsOf(run);
  return { utilities, coverage, fields: out.slot, travel: travelOf(run).slot, lvTerms: (cell) => landValueTerms(out.lvInputs, ctx.params, cell) };
}

/** M3 Fields → derived.fields and derived.coverage (+ t.lv, t.lag.poll, t.ps; Safety's Why). */
export function stepFields(t: TownState, m: MonthContext): void {
  const run = runFor(t, m, m.derived);
  const svc = servicesOf(run);
  const out = fieldsOf(run);
  m.derived.coverage = svc.slot;
  m.derived.fields = out.slot;
  t.lv = encodeCells(out.lv);
  t.lag.poll = encodeCells(out.poll);
  t.ps = out.ps;
  m.why.set('safety', out.slot.safety);
  for (const [k, v] of out.terms) m.why.add(k, v, 'safety');
}
