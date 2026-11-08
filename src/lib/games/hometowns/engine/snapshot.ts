// What other towns may see of a town: its public card (wire) and its row in
// the Regional Day snapshot (§8.3 step 9). Built from stored state only, so
// the server and a phone build identical snapshots. WP3 owns the snapshot's
// county-level content (flows, prices, links); this is the baseline builder.

import { population } from './core';
import { skylineOf } from './tiles';
import { buildingIndex } from './content';
import {
  COHORT_COUNT,
  H_H,
  H_L,
  H_M,
  PERSON_S,
  STAGE_C,
  STAGE_P,
  STAGE_R,
  STAGE_W,
  STAR_TOWN,
  person,
  type CountyState,
  type PublicCard,
  type Snapshot,
  type SnapshotTown,
  type TownState,
} from './types';

/** Persons by COHORT: Workers, Families (Parents + Children), Retirees per tier, then Students. */
export function cohortsOf(t: TownState): number[] {
  const out = new Array<number>(COHORT_COUNT).fill(0);
  for (let h = 0; h < 3; h++) {
    out[h * 3] = t.people[person(STAGE_W, h)];
    out[h * 3 + 1] = t.people[person(STAGE_P, h)] + t.people[person(STAGE_C, h)];
    out[h * 3 + 2] = t.people[person(STAGE_R, h)];
  }
  out[9] = t.people[PERSON_S];
  return out;
}

/** Persons by FACES (§4.2): Workers (£, ££), Professionals (£££ Workers), Families, Retirees, Students. */
export function facesOf(t: TownState): number[] {
  const p = t.people;
  const w = (h: number) => p[person(STAGE_W, h)];
  let fam = 0;
  let ret = 0;
  for (let h = 0; h < 3; h++) {
    fam += p[person(STAGE_P, h)] + p[person(STAGE_C, h)];
    ret += p[person(STAGE_R, h)];
  }
  return [w(H_L) + w(H_M), w(H_H), fam, ret, p[PERSON_S]];
}

export function inFortnight(t: TownState): boolean {
  return t.gridBase === null;
}

export function publicCard(t: TownState): PublicCard {
  return {
    seat: t.seat,
    name: t.name,
    avatar: t.avatar,
    flag: t.flag,
    tier: t.tier,
    pop: population(t),
    faces: facesOf(t),
    stars: t.perceived.slice(0, STAR_TOWN),
    taxes: { homes: [...t.taxes.homes], business: t.taxes.business, sales: t.taxes.sales, hotel: t.taxes.hotel },
    holiday: t.holiday.until !== null,
    archived: t.archived,
    inFortnight: inFortnight(t),
    skyline: skylineOf(t),
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Minutes from town i to every town by open link (−1: none). */
function linkTimes(c: CountyState, i: number): number[] {
  const out = new Array<number>(c.towns.length).fill(-1);
  for (const l of c.links) {
    if (l.state !== 'open' && l.state !== 'closing') continue;
    const other = l.a === i ? l.b : l.b === i ? l.a : -1;
    if (other < 0) continue;
    if (out[other] < 0 || l.minutes < out[other]) out[other] = l.minutes;
  }
  return out;
}

const UNIVERSITY = buildingIndex('university');

export function snapshotRow(c: CountyState, i: number): SnapshotTown {
  const t = c.towns[i];
  // The economic columns come from the memos the month steps keep (WP2b's
  // peopleMemo, WP2c's marketMemo); a town that has not run a month yet
  // publishes the neutral values.
  const pm = t.peopleMemo;
  const mm = t.marketMemo;
  const tier3 = (xs: readonly number[] | undefined) => (xs && xs.length === 3 ? [...xs] : [0, 0, 0]);
  return {
    seat: t.seat,
    active: !t.archived && !inFortnight(t),
    tier: t.tier,
    pop: population(t),
    cohorts: cohortsOf(t),
    perceived: [...t.perceived],
    needs: pm && pm.needs.length === COHORT_COUNT ? [...pm.needs] : new Array<number>(COHORT_COUNT).fill(1),
    vacancies: tier3(pm?.vacancies),
    unemployed: tier3(pm?.unemployed),
    jobs: tier3(pm?.jobs),
    attrQ: mm?.attrQ ?? 0,
    rep: t.rep,
    aw: t.aw,
    shopAppeal: mm?.shopAppeal ?? 0,
    goodsSurplus: mm?.surplus[0] ?? 0,
    foodSurplus: mm?.surplus[1] ?? 0,
    linkTimes: linkTimes(c, i),
    homesTax: [...t.taxes.homes],
    salesTax: t.taxes.sales,
    hotelTax: t.taxes.hotel,
    holiday: t.holiday.until !== null,
    grace: t.grace !== null && t.grace > c.dayIndex,
    skyline: skylineOf(t),
  };
}

/**
 * The snapshot as of now: each town's public row, county aggregates and a
 * copy of tomorrow's fixed flows. Called at the Regional Day's step 9.
 * The economic columns (vacancies, attrQ, surpluses …) are copied from the
 * month steps' memos; WP3 adds the county-level content at settlement.
 */
export function snapshotOf(c: CountyState, at = c.lastRegionalDayAt, month = Math.floor(c.gridTick / 4)): Snapshot {
  const towns = c.towns.map((_, i) => snapshotRow(c, i));
  const active = towns.filter((r) => r.active);
  let sumN = 0;
  for (const r of active) sumN += r.pop;
  let seats = 0;
  for (const t of c.towns) if (!t.archived) for (const b of t.buildings) if (b[0] === UNIVERSITY) seats += 6000;
  return {
    worldSeed: c.seed,
    dayIndex: c.dayIndex,
    at,
    month,
    towns,
    kingsport: { pop: c.kingsport.pop, stars: [...c.kingsport.stars] },
    sumN,
    medianPop: median(active.map((r) => r.pop)),
    prices: { goods: c.market.goods.p, food: c.market.food.p },
    universitySeats: seats,
    season: { n: c.season.n, theme: c.season.theme, startMonth: c.season.startMonth, boomBust: c.season.theme === 'boomBust' },
    event: null,
    flows: c.flows.towns.map((f) => JSON.parse(JSON.stringify(f))),
    allocations: c.allocations.map((a) => ({ ...a })),
  };
}
