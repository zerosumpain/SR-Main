// Migration (WP2b, spec §5.11): Tiebout sorting through a logit choice.
//
// Each month a few residents of every cohort reconsider (more when unhappy,
// fewer when very happy), along with everyone forced to: the squeezed, the
// long-term unemployed and anyone whose home was re-tiered from under them.
// New adults and graduates join them that month, with a bonus for staying in
// the town that raised them. Each mover weighs staying against every linked
// player town (through that town's published, perceived stars) and against
// the Outside World, whose pull rises and falls with the county's economy.
// Movers who choose the Outside World leave now; movers who choose a
// player's town become intents, which wait at home until the Regional Day
// settles them under the fairness caps (§8.4, WP3).
//
// Newcomers come from the Outside World reservoir, shared between the towns
// by a square-root mass times the same logit, so a small attractive town gets
// far more per head than a big one (the invisible catch-up). They are housing
// limited: they fill their tier's vacancies (Families and Retirees may go one
// tier down), and the rest join the waiting list that drives the Homes meter.
//
// Because cohorts weigh the stars differently (the weights table), no town is
// best for everyone. That heterogeneity, not any cap, is what lets a cheap
// factory town and a pricey cultural city both thrive. It also makes brain
// drain emerge on its own: a town that educates its children without the
// jobs, homes and fun its new professionals want watches them leave.

import { flow, population, postPeople } from './core';
import { expFx, lnFx, powFx, T } from './fx';
import { neutral } from './derived';
import { allocate, cohortPersons, houseNewcomers } from './housing';
import { largestRemainder } from './num';
import { byRivalry } from './params';
import { hasBuilding, housingOf, memoFor, scratchOf } from './people';
import { sumTerms, utilityTerms } from './needs';
import {
  COHORTS,
  COHORT_COUNT,
  COHORT_S,
  PERSON_S,
  SECTORS,
  STAGE_C,
  STAGE_P,
  STAGE_R,
  STAGE_W,
  STARS,
  STAR_TOWN,
  person,
  type MigrationSlot,
  type MonthContext,
  type SnapshotTown,
  type TownState,
} from './types';

const BUZZ = STARS.indexOf('buzz');
const W_INERTIA = STAR_TOWN + 1;
const W_MU = STAR_TOWN + 2;
const OFFICES = SECTORS.indexOf('offices');

/** The Why term keys of the 11 star terms and the needs term, in weight order. */
const IN_KEYS = [...STARS.map((s) => `mig.in.${s}`), 'mig.in.needs'];
const OUT_KEYS = [...STARS.map((s) => `mig.out.${s}`), 'mig.out.needs'];

/** Softmax over utilities at temperature T (stable: shifted by the maximum). */
export function logit(v: readonly number[], temp: number): number[] {
  let max = -Infinity;
  for (const x of v) if (x > max) max = x;
  const e = v.map((x) => expFx((x - max) / temp));
  let s = 0;
  for (const x of e) s += x;
  return e.map((x) => x / s);
}

/** Is town row j a hidden gem (§5.11): small against the county median, with a strong Buzz? */
function gem(pop: number, buzz: number, median: number, m: MonthContext): number {
  const g = m.params.migration.gem;
  return median > 0 && pop < g[0] * median && buzz > g[1] ? m.params.migration.hiddenGem : 0;
}

/** May cohort k live in a town (Students only where there are university places)? */
function hosts(k: number, university: boolean): boolean {
  return k !== COHORT_S || university;
}

interface Group {
  movers: number;
  /** Utility bonus for staying (home-grown, graduates). */
  stay: number;
}

/** STEP M11 (WP2b): movers and their choices, Outside World leavers and arrivals, intents to players → derived.migration. */
export function stepMigration(t: TownState, m: MonthContext): void {
  const mp = m.params.migration;
  const pp = m.params.people;
  const temp = byRivalry(mp.T, m.rivalry);
  const phi = byRivalry(mp.uphill, m.rivalry);
  const actual = m.derived.stars ? m.derived.stars.actual : neutral.stars(t).actual;
  const needs = m.derived.needs ?? neutral.needs();
  const lab = m.derived.labour ?? neutral.labour();
  const hs = housingOf(m);
  const scratch = scratchOf(m);
  const memo = memoFor(t);
  const snap = m.snapshot;
  const own = m.townIndex;
  const N = population(t);
  const people = t.people;
  const cohorts = cohortPersons(people);
  const homesTaxL = t.taxes.homes[0] ?? 0;
  const vOut = mp.outsideGain * (m.world.G - 1);

  // The town's own bonuses as a place to live.
  const ownFlows = snap.flows[own];
  const freshOwn = t.grace !== null && m.dayIndex < t.grace ? mp.freshTown : 0;
  const gemOwn = gem(N, actual[BUZZ], snap.medianPop, m);
  const uniOwn = hasBuilding(t, 'university') || (ownFlows?.sharedUniversity ?? 0) > 0;

  // Linked player towns a mover may choose. Nothing leaves for players during
  // a holiday, the Fresh Town grace or the fortnight (§8.4 freeze, A23), and
  // nobody moves to a town on holiday (A31).
  const ownRow = snap.towns[own];
  const holiday = t.holiday.until !== null && m.at < t.holiday.until;
  const frozen = holiday || freshOwn > 0 || t.gridBase === null;
  const dests: { j: number; row: SnapshotTown; bonus: number }[] = [];
  if (ownRow && !frozen)
    for (let j = 0; j < snap.towns.length; j++) {
      const row = snap.towns[j];
      const mins = ownRow.linkTimes[j] ?? -1;
      if (j === own || mins < 0 || !row.active || row.holiday) continue;
      const uphill = phi * Math.max(0, lnFx(Math.max(1, row.pop) / Math.max(1, N)));
      const bonus = gem(row.pop, row.perceived[BUZZ], snap.medianPop, m) + (row.grace ? mp.freshTown : 0) - uphill - mp.distance * mins;
      dests.push({ j, row, bonus });
    }

  // ---- Movers ----
  const squeezed = allocate(cohorts, hs.cap).squeezed;
  const officeVacancies = (lab.sectorJobs[OFFICES] ?? 0) > (lab.sectorFilled[OFFICES] ?? 0);
  const forced = new Array<number>(COHORT_COUNT).fill(0);
  const forcedParts = { squeezed: new Array<number>(COHORT_COUNT).fill(0), unemployed: new Array<number>(COHORT_COUNT).fill(0), retier: new Array<number>(COHORT_COUNT).fill(0) };
  /** Long-term unemployed movers in workers (not family persons), by tier and [Workers, Parents]. */
  const luMovers = [0, 0, 0].map(() => [0, 0]);
  for (let h = 0; h < 3; h++) {
    const W = people[person(STAGE_W, h)];
    const P = people[person(STAGE_P, h)];
    const C = people[person(STAGE_C, h)];
    const ww = m.params.people.participation.W * W;
    const wp = m.params.people.participation.P * P;
    const lu = mp.forcedUnemployed * t.longUnemployed[h];
    if (ww + wp > 0) {
      luMovers[h] = [(lu * ww) / (ww + wp), (lu * wp) / (ww + wp)];
      forcedParts.unemployed[h * 3] = luMovers[h][0];
      forcedParts.unemployed[h * 3 + 1] = luMovers[h][1] * ((P + C) / Math.max(1, P));
    }
    // The displaced are shared over the tier's cohorts as its squeezed are.
    let sq = 0;
    for (let kind = 0; kind < 3; kind++) sq += squeezed[h * 3 + kind];
    for (let kind = 0; kind < 3; kind++) {
      const k = h * 3 + kind;
      forcedParts.squeezed[k] = m.params.housing.squeezedMovers * squeezed[k];
      forcedParts.retier[k] = sq > 0 ? (memo.displaced[h] * squeezed[k]) / sq : 0;
    }
  }
  forcedParts.squeezed[COHORT_S] = m.params.housing.squeezedMovers * squeezed[COHORT_S];
  for (let k = 0; k < COHORT_COUNT; k++) forced[k] = forcedParts.squeezed[k] + forcedParts.unemployed[k] + forcedParts.retier[k];

  const groups: Group[][] = [];
  const unhappyPart = new Array<number>(COHORT_COUNT).fill(0);
  const youngShare = [0, 0, 0];
  for (let k = 0; k < COHORT_COUNT; k++) {
    const w = mp.weights[k];
    const happy = t.happy[k];
    let mult = 1 + mp.unhappyMove * T(3 * (0.5 - happy / 100));
    if (happy > mp.veryHappy[0]) mult *= mp.veryHappy[1];
    const n = cohorts[k];
    const g: Group[] = [];
    if (k !== COHORT_S && k % 3 === 0) {
      // Workers: the young move more, and this month's new adults and graduates all reconsider.
      const h = k / 3;
      const fresh = Math.min(n, scratch.newAdults[h] + scratch.graduates[h]);
      const young = Math.max(fresh, Math.min(n, memo.young[h]));
      const settled = n - young;
      g.push({ movers: w[W_MU] * settled * mult + forced[k], stay: 0 });
      g.push({ movers: pp.youngMu * (young - fresh) * mult + scratch.newAdults[h], stay: mp.homeGrown });
      g.push({ movers: scratch.graduates[h], stay: officeVacancies ? mp.graduateStay : 0 });
      unhappyPart[k] = (w[W_MU] * settled + pp.youngMu * (young - fresh)) * (mult - 1);
    } else {
      g.push({ movers: w[W_MU] * n * mult + forced[k], stay: 0 });
      unhappyPart[k] = w[W_MU] * n * (mult - 1);
    }
    let total = 0;
    for (const x of g) total += x.movers;
    if (total > n) for (const x of g) x.movers *= n / total;
    groups.push(g);
  }

  // ---- Choices ----
  const ownTerms: number[][] = [];
  const leaveRaw = new Array<number>(COHORT_COUNT).fill(0);
  const leaveRef = new Array<number>(COHORT_COUNT).fill(0);
  const leaveYoung = [0, 0, 0];
  const homeGrownOut: [number[], number[]] = [new Array<number>(COHORT_COUNT).fill(0), new Array<number>(COHORT_COUNT).fill(0)];
  const moversTotal = new Array<number>(COHORT_COUNT).fill(0);
  const pOutMean = new Array<number>(COHORT_COUNT).fill(0);
  const intents = new Array<number>(Math.max(1, snap.towns.length) * COHORT_COUNT).fill(0);
  const utility = new Array<number>(COHORT_COUNT).fill(0);
  for (let k = 0; k < COHORT_COUNT; k++) {
    const w = mp.weights[k];
    const terms = utilityTerms(k, actual, needs.cohort[k], homesTaxL, m);
    ownTerms.push(terms);
    const uOwn = sumTerms(terms);
    utility[k] = uOwn;
    const very = t.happy[k] > mp.veryHappy[0] ? mp.veryHappy[2] : 0;
    const base = w[W_INERTIA] + gemOwn + freshOwn + very;
    const options = dests.filter((d) => hosts(k, d.row.tier >= 3));
    // A20/§8.6: yesterday's adverts aimed at this cohort here add their bonus to each advertiser.
    const adBonus = ownFlows?.advert?.[k] ?? 0;
    const adBy = ownFlows?.advertBy?.[k] ?? 0;
    const vDest = options.map((d) => sumTerms(utilityTerms(k, d.row.perceived, d.row.needs[k] ?? 1, d.row.homesTax[0] ?? 0, m)) + d.bonus + ((adBy >> d.j) & 1 ? adBonus : 0));
    for (const g of groups[k]) {
      if (g.movers <= 0) continue;
      const stay = hosts(k, uniOwn) ? uOwn + base + g.stay : -Infinity;
      const pr = logit([stay, vOut, ...vDest], temp);
      const ref = logit([hosts(k, uniOwn) ? base + g.stay : -Infinity, vOut, ...vDest], temp);
      leaveRaw[k] += g.movers * pr[1];
      leaveRef[k] += g.movers * ref[1];
      moversTotal[k] += g.movers;
      const homeGrown = g !== groups[k][0];
      if (homeGrown) {
        leaveYoung[k / 3] += g.movers * pr[1];
        homeGrownOut[0][k] += g.movers * pr[1];
      }
      options.forEach((d, i) => {
        intents[d.j * COHORT_COUNT + k] += g.movers * pr[2 + i];
        if (homeGrown) homeGrownOut[1][k] += g.movers * pr[2 + i];
      });
    }
    pOutMean[k] = moversTotal[k] > 0 ? leaveRaw[k] / moversTotal[k] : 0;
  }
  for (let h = 0; h < 3; h++) youngShare[h] = leaveRaw[h * 3] > 0 ? leaveYoung[h] / leaveRaw[h * 3] : 0;

  // ---- Outside World arrivals (§5.11) ----
  const poolScale = powFx(1 + snap.sumN / mp.poolScale, mp.poolExp) * (1 + 0.5 * (m.world.G - 1));
  const gateOwn = mp.gate[0] + (hasBuilding(t, 'railStation') ? mp.gate[1] : 0) + (hasBuilding(t, 'airfield') ? mp.gate[2] : 0);
  const massOwn = Math.sqrt(N + mp.massOffset);
  const others = snap.towns.filter((r, j) => j !== own && r.active);
  let meanMass = massOwn;
  for (const r of others) meanMass += Math.sqrt(r.pop + mp.massOffset);
  meanMass /= others.length + 1;
  const arriveRaw = new Array<number>(COHORT_COUNT).fill(0);
  const arriveRef = new Array<number>(COHORT_COUNT).fill(0);
  const arriveTerms: number[][] = [];
  for (let k = 0; k < COHORT_COUNT; k++) {
    const pool = k < COHORT_S ? mp.n0[k] * poolScale : mp.studentPool * snap.universitySeats;
    const terms = [...utilityTerms(k, t.perceived, needs.cohort[k], homesTaxL, m), gemOwn, freshOwn];
    arriveTerms.push(terms);
    if (!hosts(k, uniOwn) || pool <= 0) continue;
    const uArr = sumTerms(terms);
    let rivals = 0;
    for (const r of others) {
      if (!hosts(k, r.tier >= 3)) continue;
      const u = sumTerms(utilityTerms(k, r.perceived, r.needs[k] ?? 1, r.homesTax[0] ?? 0, m)) + gem(r.pop, r.perceived[BUZZ], snap.medianPop, m) + (r.grace ? mp.freshTown : 0);
      rivals += Math.sqrt(r.pop + mp.massOffset) * mp.gate[0] * expFx(u / temp);
    }
    const mine = massOwn * gateOwn * expFx(uArr / temp);
    const outside = mp.Kout * meanMass * expFx(vOut / temp);
    const denom = rivals + mine + outside;
    arriveRaw[k] = (pool * mine) / denom;
    arriveRef[k] = (pool * massOwn * gateOwn) / denom;
  }

  // ---- Whole people, housing limits and caps ----
  const leave = cohorts.map((n, k) => Math.min(n, flow(t, `mig.out.${k}`, leaveRaw[k])));
  const arrive = arriveRaw.map((x, k) => flow(t, `mig.in.${k}`, x));
  const stayers = cohorts.map((n, k) => n - leave[k]);
  const waiting = t.applicants.map((a, k) => a + arrive[k]);
  const housed = houseNewcomers(stayers, hs.cap, waiting);
  const housedBeforeCap = [...housed];

  let netIn = 0;
  for (let k = 0; k < COHORT_COUNT; k++) netIn += housed[k] - leave[k];
  const upCap = Math.floor(mp.arrivalsCap * N);
  if (netIn > upCap) {
    const cut = largestRemainder(netIn - upCap, housed);
    for (let k = 0; k < COHORT_COUNT; k++) housed[k] -= Math.min(housed[k], cut[k]);
    netIn = upCap;
  }
  const capped = housedBeforeCap.map((x, k) => x - housed[k]);
  const leaveBeforeCap = [...leave];
  let downCap = Math.floor(mp.departuresCap * N);
  // The Away cap (§2.4, A34): an Away town never falls below 95% of its week-start population through leavers.
  const away = m.at - t.away.lastHelloAt >= m.params.clock.awayAfterMs && t.away.weekStartPop > 0;
  if (away) downCap = Math.min(downCap, Math.max(0, N - Math.ceil(t.away.weekStartPop * (1 - mp.awayLossCap))));
  if (-netIn > downCap) {
    const cut = largestRemainder(-netIn - downCap, leave);
    for (let k = 0; k < COHORT_COUNT; k++) leave[k] -= Math.min(leave[k], cut[k]);
  }

  // ---- Apply ----
  let left = 0;
  let came = 0;
  const leftK = new Array<number>(COHORT_COUNT).fill(0);
  const cameK = new Array<number>(COHORT_COUNT).fill(0);
  for (let k = 0; k < COHORT_COUNT; k++) {
    leftK[k] = moveCohort(t, k, -leave[k], 'leavers', mp.familyChildren);
    cameK[k] = moveCohort(t, k, housed[k], 'arrivals', mp.familyChildren);
    left += leftK[k];
    came += cameK[k];
    // Whoever is still waiting stays on the list; a quarter give up each month.
    const still = waiting[k] - cameK[k];
    t.applicants[k] = Math.max(0, still - flow(t, `mig.wait.${k}`, still * pp.applicantDecay));
  }

  // Young adults, the long-term unemployed and the displaced who left are no longer counted.
  for (let h = 0; h < 3; h++) {
    const W = people[person(STAGE_W, h)];
    memo.young[h] = Math.max(0, Math.min(W, memo.young[h] - Math.round(-leftK[h * 3] * youngShare[h])));
    const luOut = Math.round(luMovers[h][0] * pOutMean[h * 3] + luMovers[h][1] * pOutMean[h * 3 + 1]);
    t.longUnemployed[h] = Math.max(0, Math.min(W + people[person(STAGE_P, h)], t.longUnemployed[h] - luOut));
    memo.displaced[h] = 0;
  }

  // Intents accrue all day for the Regional Day (WP3 settles them, A25: doubles until then).
  if (dests.length > 0) {
    const n = snap.towns.length * COHORT_COUNT;
    const acc = t.realised.intents ?? [];
    while (acc.length < n) acc.push(0);
    for (let i = 0; i < n; i++) acc[i] += intents[i];
    t.realised.intents = acc;
  }

  // ---- Why (§5.19): log-share splits of arrivals and departures ----
  for (let k = 0; k < COHORT_COUNT; k++) {
    const qIn = `arrive.${COHORTS[k]}`;
    const qOut = `depart.${COHORTS[k]}`;
    if (cameK[k] !== 0 || arriveRaw[k] > 0) {
      m.why.add('mig.in.base', arriveRef[k], qIn);
      share(m, qIn, arriveRaw[k] - arriveRef[k], arriveTerms[k], [...IN_KEYS, 'mig.in.gem', 'mig.in.fresh']);
      m.why.add('mig.in.housing', housedBeforeCap[k] - arrive[k], qIn);
      m.why.add('mig.in.cap', -capped[k], qIn);
      m.why.set(qIn, cameK[k]);
    }
    if (leftK[k] !== 0 || leaveRaw[k] > 0) {
      const ref = leaveRef[k];
      const p0 = moversTotal[k] > 0 ? ref / moversTotal[k] : 0;
      const parts: [string, number][] = [
        ['mig.out.squeezed', forcedParts.squeezed[k] * p0],
        ['mig.out.unemployed', forcedParts.unemployed[k] * p0],
        ['mig.out.retier', forcedParts.retier[k] * p0],
        ['mig.out.unhappy', unhappyPart[k] * p0],
      ];
      let named = 0;
      for (const [key, x] of parts) {
        m.why.add(key, x, qOut);
        named += x;
      }
      m.why.add('mig.out.base', ref - named, qOut);
      share(m, qOut, leaveRaw[k] - ref, ownTerms[k].map((x) => -x), OUT_KEYS);
      m.why.add('mig.out.cap', -(leaveBeforeCap[k] - leave[k]), qOut);
      m.why.set(qOut, -leftK[k]);
    }
  }
  m.why.add('pop.arrivals', came, 'pop');
  m.why.add('pop.leavers', left, 'pop');

  const slot: MigrationSlot = {
    movers: moversTotal,
    leavers: leftK.map((x) => -x),
    arrivals: cameK,
    intents,
    utility,
    homeGrownOut,
  };
  m.derived.migration = slot;
}

/** Shares `delta` over terms in proportion to their signed contributions (the log-share split of §5.19). */
function share(m: MonthContext, quantity: string, delta: number, contributions: readonly number[], keys: readonly string[]): void {
  let s = 0;
  let a = 0;
  for (const c of contributions) {
    s += c;
    a += Math.abs(c);
  }
  // A near-cancelling sum would blow small terms up into huge opposite ones; leave that to the residual.
  if (a === 0 || Math.abs(s) < 0.05 * a || delta === 0) return;
  for (let i = 0; i < contributions.length; i++) if (contributions[i] !== 0) m.why.add(keys[i], (delta * contributions[i]) / s, quantity);
}

/**
 * Adds (n > 0) or removes (n < 0) persons of cohort k through a population
 * flow. Families move together: arriving Families bring children at the
 * Outside World's family mix; leaving ones take theirs at the town's own
 * C/P ratio, so families never separate (§4.5). Returns the persons moved
 * (signed).
 */
function moveCohort(t: TownState, k: number, n: number, kind: 'leavers' | 'arrivals', childShare: number): number {
  if (n === 0) return 0;
  if (k === COHORT_S) return postPeople(t, kind, PERSON_S, n);
  const h = Math.floor(k / 3);
  const stage = k % 3;
  if (stage === 0) return postPeople(t, kind, person(STAGE_W, h), n);
  if (stage === 2) return postPeople(t, kind, person(STAGE_R, h), n);
  const P = t.people[person(STAGE_P, h)];
  const C = t.people[person(STAGE_C, h)];
  if (n > 0) {
    const kids = Math.min(n, flow(t, `mig.kidsIn.${h}`, n * childShare));
    return postPeople(t, kind, person(STAGE_P, h), n - kids) + postPeople(t, kind, person(STAGE_C, h), kids);
  }
  const out = Math.min(-n, P + C);
  let kids = Math.min(C, flow(t, `mig.kidsOut.${h}`, (out * C) / Math.max(1, P + C)));
  const parents = Math.min(P, out - kids);
  kids = Math.min(C, out - parents);
  return postPeople(t, kind, person(STAGE_P, h), -parents) + postPeople(t, kind, person(STAGE_C, h), -kids);
}
