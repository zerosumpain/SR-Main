// WP2b migration (spec §5.11): the logit, Outside World arrivals and
// leavers, housing-limited arrivals and the waiting list, the monthly caps,
// families moving together, intents to linked player towns and their freeze,
// the uphill rule, the square-root mass, and conservation.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { monthContext } from '../../../../../scripts/hometowns/people-kit';
import { population } from './core';
import { neutral } from './derived';
import { allocate, cohortPersons } from './housing';
import { logit, stepMigration } from './migration';
import { COHORT_COUNT, STAGE_C, STAGE_P, STAR_COUNT, person, type DerivedCache, type SnapshotTown, type TownState } from './types';

/** The town fixture (11,419 people) with every star at `stars`, needs half met, and homes to spare by `spare` per tier. */
function town(stars = 50, spare = 2000) {
  const f = fixture('town');
  const c = f.county;
  const t = c.towns[f.town];
  t.carry = {};
  t.books.popOpen = population(t);
  const coh = cohortPersons(t.people);
  const cap = [coh[0] + coh[1] + coh[2] + coh[9] + spare, coh[3] + coh[4] + coh[5] + spare, coh[6] + coh[7] + coh[8] + spare];
  const slots = (s = stars): Partial<DerivedCache> => ({
    stars: { actual: new Array<number>(STAR_COUNT).fill(s), uHappy: new Array<number>(COHORT_COUNT).fill(0) },
    needs: { ...neutral.needs(), cohort: new Array<number>(COHORT_COUNT).fill(0.5) },
    labour: neutral.labour(),
    housing: { ...neutral.housing(), cap },
  });
  return { c, i: f.town, t, cap, slots };
}

function rival(c: ReturnType<typeof town>['c'], i: number, over: Partial<SnapshotTown> = {}): void {
  const own = c.snapshot.towns[i];
  const r: SnapshotTown = { ...JSON.parse(JSON.stringify(own)), seat: 'rival', ...over };
  own.linkTimes = [-1, 25];
  r.linkTimes = [25, -1];
  c.snapshot.towns.push(r);
}

describe('the logit (§5.11)', () => {
  it('gives shares that sum to 1, stably, even for huge utilities', () => {
    for (const v of [[0, 0, 0], [1.2, -0.4, 0.3, 2], [1000, 999, -1000]]) {
      const p = logit(v, 1.4);
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(p.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
    }
    const p = logit([1, 0], 1);
    expect(p[0] / p[1]).toBeCloseTo(Math.E, 9);
  });
});

describe('Outside World arrivals and leavers', () => {
  it('conserves people: the head-count moves exactly by arrivals and leavers, as the books record', () => {
    const { c, i, t, slots } = town();
    const before = population(t);
    const m = monthContext(c, i, slots());
    stepMigration(t, m);
    const mig = m.derived.migration!;
    const came = mig.arrivals.reduce((a, b) => a + b, 0);
    const left = mig.leavers.reduce((a, b) => a + b, 0);
    expect(came).toBeGreaterThan(0);
    expect(left).toBeGreaterThan(0);
    expect(population(t)).toBe(before + came - left);
    expect(t.books.pop[2]).toBe(came); // 'arrivals'
    expect(t.books.pop[3]).toBe(-left); // 'leavers'
    expect(m.why.problems).toEqual([]);
  });

  it('houses newcomers only in vacancies; the rest wait as applicants, who give up at 25% a month', () => {
    const { c, i, t, slots } = town(80, 0);
    const m = monthContext(c, i, slots());
    stepMigration(t, m);
    const waiting = t.applicants.reduce((a, b) => a + b, 0);
    expect(waiting).toBeGreaterThan(0);
    // Nobody already living here was squeezed out to make room.
    expect(allocate(cohortPersons(t.people), m.derived.housing!.cap).squeezed.reduce((a, b) => a + b, 0)).toBe(0);
    // A month in which nobody new wants to come (every star, as outsiders perceive it, at zero): the list shrinks by a quarter.
    const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const before = total(t.applicants);
    t.perceived.fill(0);
    const m2 = monthContext(c, i, { ...slots(0), needs: { ...neutral.needs(), cohort: new Array<number>(COHORT_COUNT).fill(0) } });
    m2.derived.housing = { ...m2.derived.housing!, cap: [0, 0, 0] };
    stepMigration(t, m2);
    expect(total(t.applicants)).toBeLessThanOrEqual(Math.ceil(0.75 * before) + 1);
    expect(total(t.applicants)).toBeGreaterThanOrEqual(Math.floor(0.75 * before) - COHORT_COUNT);
  });

  it('caps net arrivals at 6% of the population a month', () => {
    const { c, i, t, slots } = town(100, 50000);
    c.snapshot.sumN = 4e6; // an enormous reservoir
    const n = population(t);
    const m = monthContext(c, i, slots(100));
    stepMigration(t, m);
    const mig = m.derived.migration!;
    const net = mig.arrivals.reduce((a, b) => a + b, 0) - mig.leavers.reduce((a, b) => a + b, 0);
    expect(net).toBe(Math.floor(0.06 * n));
  });

  it('caps net departures at 3% of the population a month', () => {
    const { c, i, t, slots } = town(0, 0);
    t.happy.fill(0); // everyone unhappy: movers × 1.6
    const n = population(t);
    const m = monthContext(c, i, { ...slots(0), needs: { ...neutral.needs(), cohort: new Array<number>(COHORT_COUNT).fill(0) } });
    m.derived.housing = { ...m.derived.housing!, cap: [0, 0, 0] }; // and nobody has a home: 10% are forced to move
    m.world = { ...m.world, G: 1.3 }; // while the Outside World is booming
    stepMigration(t, m);
    const mig = m.derived.migration!;
    const net = mig.leavers.reduce((a, b) => a + b, 0) - mig.arrivals.reduce((a, b) => a + b, 0);
    expect(net).toBe(Math.floor(0.03 * n));
    expect(m.why.problems).toEqual([]);
  });

  it('moves Families together: children leave with their parents at the town’s ratio', () => {
    const { c, i, t, slots } = town(0, 0);
    t.happy.fill(0);
    const [P0, C0] = [t.people[person(STAGE_P, 0)], t.people[person(STAGE_C, 0)]];
    const m = monthContext(c, i, slots(0));
    stepMigration(t, m);
    const dp = P0 - t.people[person(STAGE_P, 0)];
    const dc = C0 - t.people[person(STAGE_C, 0)];
    expect(dp + dc).toBe(m.derived.migration!.leavers[1] - m.derived.migration!.arrivals[1]);
    expect(Math.abs(dc / Math.max(1, dp) - C0 / P0)).toBeLessThan(0.15);
  });

  it('gives a small town far more newcomers per head than a big one (square-root mass)', () => {
    const per = (scale: number) => {
      const { c, i, t, slots } = town(60, 0);
      t.people = t.people.map((x) => Math.round(x * scale));
      t.books.popOpen = population(t);
      const coh = cohortPersons(t.people);
      const cap = [coh[0] + coh[1] + coh[2] + 99999, coh[3] + coh[4] + coh[5] + 99999, coh[6] + coh[7] + coh[8] + 99999];
      const m = monthContext(c, i, { ...slots(60), housing: { ...neutral.housing(), cap } });
      stepMigration(t, m);
      return m.derived.migration!.arrivals.reduce((a, b) => a + b, 0) / population(t);
    };
    expect(per(0.2)).toBeGreaterThan(3 * per(2));
  });

  it('brings Students only to a town with university places', () => {
    const { c, i, t, slots } = town(60);
    c.snapshot.universitySeats = 6000;
    const m = monthContext(c, i, slots(60));
    stepMigration(t, m);
    expect(m.derived.migration!.arrivals[9]).toBe(0);
  });
});

describe('intents to player towns (§5.11, §8.4 hook)', () => {
  const intentsTo = (setup: (c: ReturnType<typeof town>['c'], i: number, t: TownState) => void) => {
    const { c, i, t, slots } = town(40);
    setup(c, i, t);
    const m = monthContext(c, i, slots(40));
    stepMigration(t, m);
    const acc = t.realised.intents ?? [];
    let sum = 0;
    for (let k = 0; k < COHORT_COUNT; k++) sum += acc[COHORT_COUNT + k] ?? 0;
    return { sum, slot: m.derived.migration! };
  };

  it('records intents to a linked rival as doubles for the Regional Day, and moves nobody now', () => {
    const { sum, slot } = intentsTo((c, i) => rival(c, i, { perceived: new Array<number>(STAR_COUNT).fill(70) }));
    expect(sum).toBeGreaterThan(1);
    expect(Number.isInteger(sum)).toBe(false);
    expect(slot.intents.slice(COHORT_COUNT).reduce((a, b) => a + b, 0)).toBeCloseTo(sum, 9);
  });

  it('freezes outbound intents on holiday and in the Fresh Town grace, and toward a town on holiday', () => {
    const better = { perceived: new Array<number>(STAR_COUNT).fill(70) };
    expect(intentsTo((c, i, t) => (rival(c, i, better), (t.holiday.until = Number.MAX_SAFE_INTEGER))).sum).toBe(0);
    expect(intentsTo((c, i, t) => (rival(c, i, better), (t.grace = 1e9))).sum).toBe(0);
    expect(intentsTo((c, i) => rival(c, i, { ...better, holiday: true })).sum).toBe(0);
    expect(intentsTo((c, i) => rival(c, i, { ...better, active: false })).sum).toBe(0);
  });

  it('runs uphill only with effort: a much bigger rival draws fewer movers than an equal one', () => {
    const same = intentsTo((c, i) => rival(c, i, { perceived: new Array<number>(STAR_COUNT).fill(70) })).sum;
    const big = intentsTo((c, i) => rival(c, i, { perceived: new Array<number>(STAR_COUNT).fill(70), pop: 1e6 })).sum;
    expect(big).toBeLessThan(same);
  });
});
