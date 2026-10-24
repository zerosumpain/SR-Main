// Migration between players (WP3, spec §8.4, A31, A34): "drawing their
// people", settled once a day at the Regional Day's step 3.
//
// All day each town's movers who chose another player's town pile up as
// intents (WP2b, doubles, A25), waiting at home. Here they are netted per
// pair and cohort, so two towns swapping families move only the difference,
// and then capped in the spec's fixed order, each cap scaling pro rata:
//   1. freeze: nothing leaves a town on holiday or in its 21-day Fresh Town
//      grace, and nothing enters a town on holiday (A31: both ways, or a town
//      on holiday could poach while protected);
//   2. shield: Community Spirit halves a town's outbound flows;
//   3. pair cap: net i→j at most pairCap·N_i a day;
//   4. weekly cap: net outflow to all players over a rolling 7 days at most
//      weeklyCap·N_i(week start);
//   5. median floor: a town below the county median whose Improvement score
//      is positive loses nobody to players today ("it cannot be drained while
//      it is trying");
//   6. housing: movers need a vacancy of their tier at the destination
//      (Families and Retirees may go one tier down), and a destination takes
//      at most half its vacancies a day;
//   7. the Away cap on top (A34: a town Away and below the median is still
//      covered by the median floor, which already ran).
// Then people move, whole persons, cohort by cohort, with largest-remainder
// rounding; leftover intents vanish (those people decide again tomorrow).
// Each settled pair flow of 20 people or more gets a MoveStory, and a town
// that lost more than 3% to players in 7 days gets Community Spirit.
//
// The settlement is a pure function of every town's numbers at once
// (settleMigration), so it cannot depend on the order towns were stepped in:
// the tests feed it the same county under every relabelling of the towns.

import { population, postPeople } from './core';
import { cohortPersons, allocate } from './housing';
import { largestRemainder } from './num';
import { byRivalry } from './params';
import { supplyOf } from './develop';
import { countyMedian, inGrace, isActive, onHoliday, regionOf, rp, pp, shielded } from './region-state';
import { storyFor } from './stories';
import { COHORT_COUNT, COHORT_S, PERSON_S, STAGE_C, STAGE_P, STAGE_R, STAGE_W, STAR_TOWN, person, type CountyState, type RegionalContext, type TownState } from './types';

const K = COHORT_COUNT;

/** One town's numbers as the settlement sees them. */
export interface MigTown {
  pop: number;
  /** Takes part at all (on the grid, not archived). */
  active: boolean;
  holiday: boolean;
  grace: boolean;
  shield: boolean;
  /** Below the county median with a positive Improvement score (cap 5). */
  floor: boolean;
  /** Population at the start of the rolling week, and the net loss to players over the previous 6 days (cap 4). */
  weekStartPop: number;
  lossPrev: number;
  /** The most it may lose today under the Away cap (Infinity when not Away). */
  awayRoom: number;
  /** Persons by COHORT (what can move). */
  cohorts: number[];
  /** Homes vacancies by tier at this town as a destination. */
  vacant: number[];
}

export interface MigrationRules {
  pairCap: number;
  weeklyCap: number;
  housingShare: number;
}

export interface MigrationResult {
  /** Persons moving, whole, at (i·n + j)·10 + k. */
  moved: number[];
  /** After each cap, the persons still flowing (doubles until rounding): freeze, shield, pair, weekly, floor, rounded, housing, away. */
  stages: number[];
}

function total(f: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i];
  return s;
}

/** Scales f[idx] for the given indices so their sum is at most cap. */
function capGroup(f: Float64Array, idx: readonly number[], cap: number): void {
  let s = 0;
  for (const x of idx) s += f[x];
  if (!(s > cap)) return;
  const k = cap > 0 ? cap / s : 0;
  for (const x of idx) f[x] *= k;
}

/** Integer version: lowers whole counts m[idx] so their sum is at most cap, pro rata, largest remainder. */
function capWhole(m: number[], idx: readonly number[], cap: number): void {
  let s = 0;
  for (const x of idx) s += m[x];
  const c = Math.max(0, Math.floor(cap));
  if (s <= c) return;
  const keep = largestRemainder(c, idx.map((x) => m[x]));
  idx.forEach((x, n) => (m[x] = Math.min(m[x], keep[n])));
}

/** A cohort's own homes tier (Students live in £ homes). */
const tierOf = (k: number): number => (k === COHORT_S ? 0 : Math.floor(k / 3));
/** May a cohort take homes one tier down (Families, Retirees), or one up (Students take ££ after £)? */
const spillTier = (k: number): number => (k === COHORT_S ? 1 : k % 3 === 0 ? -1 : tierOf(k) - 1);

/**
 * Persons of each cohort a destination can house today: own tier first,
 * then the spill tier, each pro rata over the cohorts competing for it, at
 * most `share` of each tier's vacancies.
 */
export function houseMovers(demand: readonly number[], vacant: readonly number[], share: number): number[] {
  const room = vacant.map((v) => Math.max(0, Math.floor(share * Math.max(0, v))));
  const got = new Array<number>(K).fill(0);
  const fill = (wants: (k: number) => number, tier: (k: number) => number) => {
    for (let h = 0; h < 3; h++) {
      const ks: number[] = [];
      for (let k = 0; k < K; k++) if (tier(k) === h && wants(k) > 0) ks.push(k);
      if (!ks.length || room[h] <= 0) continue;
      const w = ks.map(wants);
      const give = largestRemainder(Math.min(room[h], total(w)), w);
      ks.forEach((k, n) => {
        const g = Math.min(give[n], wants(k));
        got[k] += g;
        room[h] -= g;
      });
    }
  };
  fill((k) => demand[k] - got[k], tierOf);
  fill((k) => (spillTier(k) >= 0 ? demand[k] - got[k] : 0), (k) => spillTier(k));
  return got;
}

/** §8.4 items 1–3 and caps 1–7, pure. `intents` at (i·n + j)·10 + k. */
export function settleMigration(towns: readonly MigTown[], intents: readonly number[], rules: MigrationRules): MigrationResult {
  const n = towns.length;
  const at = (i: number, j: number, k: number) => (i * n + j) * K + k;
  const f = new Float64Array(n * n * K);
  const stages: number[] = [];
  // 1. Net per pair and cohort.
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      for (let k = 0; k < K; k++) {
        const a = intents[at(i, j, k)] ?? 0;
        const b = intents[at(j, i, k)] ?? 0;
        const net = (Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0);
        if (net > 0) f[at(i, j, k)] = net;
      }
    }
  const outOf = (i: number) => {
    const idx: number[] = [];
    for (let j = 0; j < n; j++) if (j !== i) for (let k = 0; k < K; k++) idx.push(at(i, j, k));
    return idx;
  };
  const pairOf = (i: number, j: number) => Array.from({ length: K }, (_, k) => at(i, j, k));

  // Cap 1, freeze (A31), and nobody moves to or from a town not taking part.
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const s = towns[i];
      const d = towns[j];
      if (i === j || (s.active && d.active && !s.holiday && !s.grace && !d.holiday)) continue;
      for (let k = 0; k < K; k++) f[at(i, j, k)] = 0;
    }
  stages.push(total(f));
  // Cap 2, shield.
  for (let i = 0; i < n; i++) if (towns[i].shield) for (const x of outOf(i)) f[x] *= 0.5;
  stages.push(total(f));
  // Cap 3, pair cap.
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) capGroup(f, pairOf(i, j), rules.pairCap * towns[i].pop);
  stages.push(total(f));
  // Cap 4, weekly cap over the rolling 7 days.
  for (let i = 0; i < n; i++) capGroup(f, outOf(i), Math.max(0, rules.weeklyCap * towns[i].weekStartPop - Math.max(0, towns[i].lossPrev)));
  stages.push(total(f));
  // Cap 5, median floor.
  for (let i = 0; i < n; i++) if (towns[i].floor) for (const x of outOf(i)) f[x] = 0;
  stages.push(total(f));
  // Nobody moves who is not there: a cohort's outflow is at most its persons.
  for (let i = 0; i < n; i++)
    for (let k = 0; k < K; k++) {
      const idx: number[] = [];
      for (let j = 0; j < n; j++) if (j !== i) idx.push(at(i, j, k));
      capGroup(f, idx, towns[i].cohorts[k] ?? 0);
    }

  // Whole persons: each pair's total rounds down (so no cap is ever exceeded), then splits over cohorts.
  const m = new Array<number>(n * n * K).fill(0);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const idx = pairOf(i, j);
      const w = idx.map((x) => f[x]);
      const whole = Math.floor(total(w) + 1e-9);
      if (whole <= 0) continue;
      const parts = largestRemainder(whole, w);
      idx.forEach((x, q) => (m[x] = parts[q]));
    }
  // The split can put a person more on a cohort than it has: trim it back (rare, tiny cohorts).
  for (let i = 0; i < n; i++)
    for (let k = 0; k < K; k++) {
      const idx: number[] = [];
      for (let j = 0; j < n; j++) if (j !== i) idx.push(at(i, j, k));
      capWhole(m, idx, towns[i].cohorts[k] ?? 0);
    }
  stages.push(total(m));

  // Cap 6, housing at the destination.
  for (let j = 0; j < n; j++) {
    const demand = new Array<number>(K).fill(0);
    for (let i = 0; i < n; i++) if (i !== j) for (let k = 0; k < K; k++) demand[k] += m[at(i, j, k)];
    if (total(demand) === 0) continue;
    const got = houseMovers(demand, towns[j].vacant, rules.housingShare);
    for (let k = 0; k < K; k++) {
      const idx: number[] = [];
      for (let i = 0; i < n; i++) if (i !== j) idx.push(at(i, j, k));
      capWhole(m, idx, got[k]);
    }
  }
  stages.push(total(m));
  // Cap 7, the Away cap.
  for (let i = 0; i < n; i++) if (Number.isFinite(towns[i].awayRoom)) capWhole(m, outOf(i), Math.max(0, towns[i].awayRoom));
  stages.push(total(m));
  return { moved: m, stages };
}

// ---- The county side ----------------------------------------------------------------------------

/** The Improvement score (§8.4 cap 5): the change in the mean perceived town star over the kept samples. */
export function improvementScore(t: TownState): number {
  const xs = t.improvement;
  if (xs.length < 2) return 0;
  return xs[xs.length - 1] - xs[0];
}

export function meanStar(t: TownState): number {
  let s = 0;
  for (let f = 0; f < STAR_TOWN; f++) s += t.perceived[f] ?? 0;
  return s / STAR_TOWN;
}

/** Homes vacancies by tier, from the stored tiles and people (no month needed). */
export function homesVacant(c: CountyState, t: TownState): number[] {
  const cap = supplyOf(t, pp(c)).cap;
  return allocate(cohortPersons(t.people), cap).vacant;
}

/** The settlement's view of every town now. */
export function migTowns(c: CountyState, r: RegionalContext): MigTown[] {
  const g = regionOf(c);
  const p = pp(c);
  const med = countyMedian(c);
  return c.towns.map((t, i) => {
    const pop = population(t);
    const active = isActive(t);
    const days = g.popDays[i] ?? [];
    let lossPrev = 0;
    const ld = g.lossDays[i] ?? [];
    for (let d = Math.max(0, ld.length - 6); d < ld.length; d++) lossPrev += ld[d];
    const away = r.at - t.away.lastHelloAt >= p.clock.awayAfterMs && t.away.weekStartPop > 0;
    return {
      pop,
      active,
      holiday: onHoliday(t, r.at),
      grace: inGrace(t, r.dayIndex),
      shield: shielded(t, r.dayIndex),
      floor: active && pop < med && improvementScore(t) > 0,
      // The population at the Regional Day that opened the rolling week (the oldest kept sample).
      weekStartPop: days.length ? days[0] : pop,
      lossPrev,
      awayRoom: away ? Math.max(0, pop - Math.ceil(t.away.weekStartPop * (1 - p.migration.awayLossCap))) : Infinity,
      cohorts: cohortPersons(t.people),
      vacant: active ? homesVacant(c, t) : [0, 0, 0],
    };
  });
}

/**
 * Moves `n` persons of cohort k from town a to town b: Families take their
 * children in the source's own ratio (§4.5: families never separate), and
 * exactly the persons who left arrive. Returns the persons moved.
 */
export function movePeople(a: TownState, b: TownState, k: number, n: number): number {
  if (n <= 0) return 0;
  const go = (stock: number, x: number) => {
    const out = -postPeople(a, 'playersOut', stock, -x);
    if (out > 0) postPeople(b, 'playersIn', stock, out);
    return out;
  };
  if (k === COHORT_S) return go(PERSON_S, n);
  const h = Math.floor(k / 3);
  const kind = k % 3;
  if (kind === 0) return go(person(STAGE_W, h), n);
  if (kind === 2) return go(person(STAGE_R, h), n);
  const P = a.people[person(STAGE_P, h)];
  const C = a.people[person(STAGE_C, h)];
  const want = Math.min(n, P + C);
  let kids = P + C > 0 ? Math.round((want * C) / (P + C)) : 0;
  kids = Math.min(kids, C);
  const parents = Math.min(P, want - kids);
  kids = Math.min(C, want - parents);
  return go(person(STAGE_P, h), parents) + go(person(STAGE_C, h), kids);
}

/** STEP §8.3 3 (WP3): migration between players from the day's intents. */
export function stepPlayerMigration(c: CountyState, r: RegionalContext): void {
  const g = regionOf(c);
  const p = pp(c);
  const n = c.towns.length;
  const towns = migTowns(c, r);
  const rules: MigrationRules = {
    pairCap: byRivalry(p.migration.pairCap, c.settings.rivalry),
    weeklyCap: byRivalry(p.migration.weeklyCap, c.settings.rivalry),
    housingShare: rp(c).housingShare,
  };
  const res = settleMigration(towns, c.ledger, rules);
  const out = new Array<number>(n).fill(0);
  const inn = new Array<number>(n).fill(0);
  g.stories = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      for (let k = 0; k < K; k++) {
        const want = res.moved[(i * n + j) * K + k];
        if (want <= 0) continue;
        const got = movePeople(c.towns[i], c.towns[j], k, want);
        out[i] += got;
        inn[j] += got;
        if (got >= rp(c).storyMin) g.stories.push(storyFor(c, r.dayIndex, i, j, k, got));
      }
    }
  // Leftover intents vanish: those people decide again tomorrow.
  c.ledger = new Array<number>(n * n * K).fill(0);

  // The rolling week, and the shield trigger (§8.4 item 5).
  for (let i = 0; i < n; i++) {
    const t = c.towns[i];
    const ld = g.lossDays[i];
    ld.push(out[i] - inn[i]);
    while (ld.length > 7) ld.shift();
    if (!isActive(t) || shielded(t, r.dayIndex)) continue;
    let week = 0;
    for (const x of ld) week += x;
    const base = towns[i].weekStartPop;
    if (base > 0 && week > p.migration.shieldAt * base) {
      t.shield = r.dayIndex + 1 + rp(c).shieldDays;
      t.inbox.push({ id: `spirit.${r.dayIndex}`, kind: 'communitySpirit', day: r.dayIndex, from: null, data: { days: rp(c).shieldDays } });
      while (t.inbox.length > 40) t.inbox.shift();
    }
  }
  for (const s of g.stories) g.weekStories.push(s);
  while (g.weekStories.length > 24) g.weekStories.shift();
}
