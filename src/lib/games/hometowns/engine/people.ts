// People (WP2b, spec §4): the shared helpers every people step uses, and the
// M9 demography step (§4.3) with education and the tier of new adults (§4.4).
//
// Every flow is computed as a double from the stocks at the start of the
// step, rounded with its own carry (§4.5: 0.3 births a month still add up),
// and then applied in a fixed order, each bounded by what is left of its
// source stock. Births and deaths change the head-count and post to the
// books; everything else (growing up, settling down, retiring, moving up a
// tier) moves people between stocks and leaves the head-count alone. So the
// town's population is conserved by construction, and the invariant check
// proves it after every month.

import { clamp, M, smooth } from './fx';
import { flow, flowsFor, moveStock, postPeople } from './core';
import { buildingIndex } from './content';
import { neutral } from './derived';
import { B_KIND, B_X, B_Y, constructionLeft, tileIndex } from './tiles';
import {
  PERSON_S,
  STAGE_C,
  STAGE_P,
  STAGE_R,
  STAGE_W,
  cohort,
  person,
  type DerivedCache,
  type HousingSlot,
  type MonthContext,
  type PeopleMemo,
  type TownState,
} from './types';
import { baseStars } from './needs';
import type { TileFacts } from './housing';

// ---- Shared helpers ------------------------------------------------------------------

/** Persons of wealth tier h (Workers, Parents, Children, Retirees); Students count with £ when asked. */
export function tierPersons(t: TownState, h: number, withStudents = false): number {
  const p = t.people;
  let n = p[person(STAGE_W, h)] + p[person(STAGE_P, h)] + p[person(STAGE_C, h)] + p[person(STAGE_R, h)];
  if (withStudents && h === 0) n += p[PERSON_S];
  return n;
}

/** The memo, created on first write. */
export function memoFor(t: TownState): PeopleMemo {
  if (!t.peopleMemo) {
    t.peopleMemo = {
      displaced: [0, 0, 0],
      young: [0, 0, 0],
      vacHigh: 0,
      needs: new Array<number>(10).fill(1),
      vacancies: [0, 0, 0],
      unemployed: [0, 0, 0],
      jobs: [0, 0, 0],
    };
  }
  return t.peopleMemo;
}

/** Is a building of catalogue id `id` finished (not still under construction)? */
export function hasBuilding(t: TownState, id: string): boolean {
  const kind = buildingIndex(id);
  for (const b of t.buildings) if (b[B_KIND] === kind && constructionLeft(t, tileIndex(b[B_X], b[B_Y])) === 0) return true;
  return false;
}

export function hasPolicy(t: TownState, card: string): boolean {
  for (const p of t.policies) if (p.card === card) return true;
  return false;
}

/**
 * Within-month notes between WP2b's own steps (M9 tells M11 who came of age
 * this month; M7a tells M10 who is squeezed). Keyed on the month's
 * blackboard object, so it is never stored, never crosses a month and is
 * dropped with the blackboard (and with a reverted month).
 */
export interface PeopleScratch {
  /** New adults this month by the tier they came of age into. */
  newAdults: number[];
  /** Graduates this month by tier (££, £££ only). */
  graduates: number[];
  /** Squeezed persons by COHORT from M7a's allocation (before migration). */
  squeezed: number[];
  /** This month's tile scan (housing.ts), dropped when re-tiering changes the tiles. */
  facts: TileFacts | null;
}
const SCRATCH = new WeakMap<DerivedCache, PeopleScratch>();

export function scratchOf(m: MonthContext): PeopleScratch {
  let s = SCRATCH.get(m.derived);
  if (!s) SCRATCH.set(m.derived, (s = { newAdults: [0, 0, 0], graduates: [0, 0, 0], squeezed: new Array<number>(10).fill(0), facts: null }));
  return s;
}

/** The housing slot, or its neutral value if M7a has not run (a test that swapped it out). */
export function housingOf(m: MonthContext): HousingSlot {
  return m.derived.housing ?? neutral.housing();
}

// ---- M9 demography ---------------------------------------------------------------------

/**
 * The tier a cohort of new adults from tier h comes of age into (§4.4), as
 * expected counts [down, same, up]. Exposed for the fixture tests.
 */
export function newAdultOdds(h: number, eduQ: readonly number[], m: Pick<MonthContext, 'params'>): [down: number, up: number] {
  const p = m.params.people;
  const [pri, sec, uni] = [eduQ[0] ?? 0, eduQ[1] ?? 0, eduQ[2] ?? 0];
  const down = h === 0 ? 0 : p.newAdultDown * (1 - clamp(pri, 0, 1));
  const up = h === 0 ? p.newAdultUp[0] + p.newAdultUp[1] * clamp(sec, 0, 1) : h === 1 ? p.newAdultUp[2] + p.newAdultUp[3] * clamp(uni, 0, 1) : 0;
  return [down, up];
}

/** STEP M9 (WP2b): births, growing up, settling down, retiring, deaths, career mobility, graduation, education (§4.3, §4.4). */
export function stepDemography(t: TownState, m: MonthContext): void {
  const pp = m.params.people;
  const hs = housingOf(m);
  const cov = m.derived.coverage;
  const lab = m.derived.labour;
  const eduQ = cov ? cov.eduQ : [0, 0, 0];
  const s = baseStars(t, m);
  const appeal = (s.schools + s.safety + s.fun) / 3;
  const boom = m.world.event?.id === 'babyBoom' ? pp.babyBoom : 1;
  const scratch = scratchOf(m);
  const memo = memoFor(t);
  const p = t.people;

  // Every rate from the stocks as they stand now, so the order we apply them
  // in below cannot change how big each one is.
  let births = 0;
  let deaths = 0;
  const plan: { births: number[]; settle: number[]; grow: number[]; nest: number[]; retW: number[]; retP: number[]; dieR: number[]; dieW: number[]; dieP: number[]; asp: number[] } = {
    births: [], settle: [], grow: [], nest: [], retW: [], retP: [], dieR: [], dieW: [], dieP: [], asp: [],
  };
  for (let h = 0; h < 3; h++) {
    const W = p[person(STAGE_W, h)];
    const P = p[person(STAGE_P, h)];
    const C = p[person(STAGE_C, h)];
    const R = p[person(STAGE_R, h)];
    const happyF = t.happy[cohort(h, 1)];
    const unhappy = happyF < pp.unhappyBirths[0] ? pp.unhappyBirths[1] : 1;
    const b = P * pp.births * M(hs.afford[h] / 60, pp.birthAfford[0], pp.birthAfford[1]) * M(happyF / 60, pp.birthHappy[0], pp.birthHappy[1]) * unhappy * boom;
    plan.births.push(flow(t, `ppl.births.${h}`, b));
    plan.settle.push(flow(t, `ppl.settle.${h}`, W * pp.settle * M(appeal / 60, pp.settleAppeal[0], pp.settleAppeal[1])));
    const grow = C / pp.comeOfAgeMonths;
    plan.grow.push(flow(t, `ppl.grow.${h}`, grow));
    plan.nest.push(flow(t, `ppl.nest.${h}`, grow * Math.min(pp.emptyNestMax, P / Math.max(1, C))));
    plan.retW.push(flow(t, `ppl.retW.${h}`, W / pp.retireMonths));
    plan.retP.push(flow(t, `ppl.retP.${h}`, P / pp.retireMonths));
    plan.dieR.push(flow(t, `ppl.dieR.${h}`, (R / pp.deathMonths) * Math.max(0, pp.deathHealth[0] - (pp.deathHealth[1] * s.health) / 100)));
    plan.dieW.push(flow(t, `ppl.dieW.${h}`, W * pp.deathWorking));
    plan.dieP.push(flow(t, `ppl.dieP.${h}`, P * pp.deathWorking));
    if (h < 2) {
      // Career mobility into the next tier's vacancies (§4.3); the vacancy is homes, as Aspirants move up only into one.
      const vac = hs.vacant[h + 1] / Math.max(1, hs.cap[h + 1]);
      const mv = pp.mobilityVac;
      plan.asp.push(flow(t, `ppl.asp.${h}`, W * pp.aspirantRate * (0.5 + t.edu / 100) * M(vac / mv[0], mv[1], mv[2])));
    }
  }

  const uH = lab && lab.workforce[2] > 0 ? lab.unemployed[2] / lab.workforce[2] : 0;
  const slide = flow(t, 'ppl.slide', p[person(STAGE_W, 2)] * pp.slideDown * (uH / pp.slideAtU));

  for (let h = 0; h < 3; h++) {
    // Deaths first: nobody who dies this month also retires or settles down.
    deaths += postPeople(t, 'deaths', person(STAGE_R, h), -plan.dieR[h]);
    deaths += postPeople(t, 'deaths', person(STAGE_W, h), -plan.dieW[h]);
    deaths += postPeople(t, 'deaths', person(STAGE_P, h), -plan.dieP[h]);

    // Coming of age: the new adult's tier comes from their schooling (§4.4).
    const grown = Math.min(plan.grow[h], p[person(STAGE_C, h)]);
    const [down, up] = newAdultOdds(h, eduQ, m);
    const nUp = Math.min(grown, flow(t, `ppl.up.${h}`, grown * up));
    const nDown = Math.min(grown - nUp, flow(t, `ppl.down.${h}`, grown * down));
    const same = grown - nUp - nDown;
    if (nUp > 0) scratch.newAdults[h + 1] += moveStock(t, person(STAGE_C, h), person(STAGE_W, h + 1), nUp);
    if (nDown > 0) scratch.newAdults[h - 1] += moveStock(t, person(STAGE_C, h), person(STAGE_W, h - 1), nDown);
    scratch.newAdults[h] += moveStock(t, person(STAGE_C, h), person(STAGE_W, h), same);

    // Empty nest, settling down and retirement keep the stage mix consistent.
    moveStock(t, person(STAGE_P, h), person(STAGE_W, h), plan.nest[h]);
    moveStock(t, person(STAGE_W, h), person(STAGE_P, h), plan.settle[h]);
    moveStock(t, person(STAGE_W, h), person(STAGE_R, h), plan.retW[h]);
    moveStock(t, person(STAGE_P, h), person(STAGE_R, h), plan.retP[h]);

    births += postPeople(t, 'births', person(STAGE_C, h), plan.births[h]);
  }

  // A gentle slide down for Well-off workers who cannot find Well-off work (§4.3).
  moveStock(t, person(STAGE_W, 2), person(STAGE_W, 1), slide);

  // Students graduate into the local movers pool as £££ or ££ Workers.
  const grads = Math.min(p[PERSON_S], flow(t, 'ppl.grad', p[PERSON_S] / pp.studentMonths));
  const gradsH = Math.min(grads, flow(t, 'ppl.gradH', grads * pp.graduateWellOff));
  scratch.graduates[2] += moveStock(t, PERSON_S, person(STAGE_W, 2), gradsH);
  scratch.graduates[1] += moveStock(t, PERSON_S, person(STAGE_W, 1), grads - gradsH);

  // Aspirants are residents who qualify for the next tier; they are a count
  // within the Workers, never more than there are.
  for (let h = 0; h < 2; h++) t.aspirants[h] = Math.min(p[person(STAGE_W, h)], t.aspirants[h] + plan.asp[h]);

  // Young adults: this month's new adults and graduates join; the rest age out over youngMonths.
  for (let h = 0; h < 3; h++) {
    const aged = flow(t, `ppl.young.${h}`, memo.young[h] / pp.youngMonths);
    memo.young[h] = Math.max(0, Math.min(p[person(STAGE_W, h)], memo.young[h] - aged + scratch.newAdults[h] + scratch.graduates[h]));
  }

  // Education stock (§4.4): schools, libraries and a university raise it slowly (τ 36).
  if (cov) {
    const uni = hasBuilding(t, 'university') || flowsFor(m).sharedUniversity > 0 ? 1 : 0;
    const target = clamp(100 * (0.5 * cov.eduQ[0] + 0.5 * cov.eduQ[1]) + pp.eduBonus[0] * cov.libraryShare + pp.eduBonus[1] * uni, 0, 100);
    let next = smooth(t.edu, target, pp.eduTau);
    if (next > t.edu && hasPolicy(t, 'readingChallenge')) next = t.edu + (next - t.edu) * pp.readingChallenge;
    t.edu = clamp(next, 0, 100);
  }

  m.why.add('pop.births', births, 'pop');
  m.why.add('pop.deaths', deaths, 'pop');
}
