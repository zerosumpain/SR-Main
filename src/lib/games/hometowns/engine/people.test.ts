// WP2b demography (spec §4.3) and education (§4.4): hand-calculated
// fixtures for the flows, the tier of new adults, carries, and conservation.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { monthContext } from '../../../../../scripts/hometowns/people-kit';
import { population } from './core';
import { neutral } from './derived';
import { M } from './fx';
import { newAdultOdds, scratchOf, stepDemography } from './people';
import { paramsFor } from './params';
import { PERSON_S, STAGE_C, STAGE_P, STAGE_R, STAGE_W, person, type TownState } from './types';

const P = paramsFor('v1');

/** The town fixture with every person stock set from `stocks` (others zero) and a clean carry. */
function town(stocks: Partial<Record<string, number>>): { c: ReturnType<typeof fixture>['county']; i: number; t: TownState } {
  const f = fixture('town');
  const t = f.county.towns[f.town];
  t.people.fill(0);
  for (const [k, v] of Object.entries(stocks)) {
    const [stage, h] = k === 'S' ? [-1, 0] : [['W', 'P', 'C', 'R'].indexOf(k[0]), Number(k[1])];
    t.people[stage < 0 ? PERSON_S : person(stage, h)] = v!;
  }
  t.carry = {};
  t.aspirants = [0, 0];
  t.books.popOpen = population(t);
  return { c: f.county, i: f.town, t };
}

/** Coverage with given school quality (the rest neutral). */
function withSchools(t: TownState, eduQ: number[], extra: Partial<ReturnType<typeof neutral.coverage>> = {}) {
  return { ...neutral.coverage(t), eduQ, ...extra };
}

describe('the tier of a new adult (§4.4)', () => {
  it('matches the hand-calculated probabilities', () => {
    const m = { params: P };
    expect(newAdultOdds(0, [0.5, 0.5, 0], m)).toEqual([0, 0.08 + 0.35 * 0.5]);
    const [down1, up1] = newAdultOdds(1, [0.5, 0.5, 0.6], m);
    expect(down1).toBeCloseTo(0.12 * 0.5, 12);
    expect(up1).toBeCloseTo(0.04 + 0.3 * 0.6, 12);
    expect(newAdultOdds(2, [0.25, 1, 1], m)).toEqual([0.12 * 0.75, 0]);
  });

  it('splits each month’s new adults by those odds, with carries', () => {
    // 192 months to grow up: C = 19,200 makes exactly 100 new adults a month.
    const { c, i, t } = town({ C0: 19200, C1: 19200 });
    const m = monthContext(c, i, { coverage: withSchools(t, [1, 1, 0.5]), housing: neutral.housing(), labour: neutral.labour() });
    stepDemography(t, m);
    const s = scratchOf(m);
    // £: 43% up to ££. ££: 19% up to £££ (0.04 + 0.3·0.5), 0% down (primary quality 1).
    expect(s.newAdults).toEqual([57, 43 + 81, 19]);
    expect(t.people[person(STAGE_W, 2)]).toBe(19);
    expect(t.people[person(STAGE_C, 0)] + t.people[person(STAGE_C, 1)]).toBe(2 * 19200 - 200);
  });
});

describe('demography (§4.3)', () => {
  it('conserves people: the head-count changes only by births and deaths, and the books say so', () => {
    const { c, i, t } = town({ W0: 3000, P0: 2000, C0: 2500, R0: 900, W1: 1500, P1: 1200, C1: 1300, R1: 600, W2: 300, P2: 200, C2: 250, R2: 150, S: 400 });
    const before = population(t);
    const m = monthContext(c, i, { coverage: withSchools(t, [0.7, 0.6, 0.3]), housing: neutral.housing(), labour: neutral.labour() });
    stepDemography(t, m);
    const births = t.books.pop[0];
    const deaths = t.books.pop[1];
    expect(births).toBeGreaterThan(0);
    expect(deaths).toBeLessThan(0);
    expect(population(t)).toBe(before + births + deaths);
    expect(t.people.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
  });

  it('births follow P·0.0055·M(Afford/60)·M(Happy/60), carried month to month', () => {
    // 1,000 Parents at Afford 60 and Happy 60 (both multipliers neutral): 5.5 births a month.
    const { c, i, t } = town({ P0: 1000 });
    t.happy.fill(60);
    const housing = { ...neutral.housing(), afford: [60, 60, 60] };
    let born = 0;
    for (let k = 0; k < 10; k++) {
      t.people.fill(0);
      t.people[person(STAGE_P, 0)] = 1000;
      const m = monthContext(c, i, { coverage: withSchools(t, [0, 0, 0]), housing, labour: neutral.labour() });
      const n0 = t.books.pop[0];
      stepDemography(t, m);
      born += t.books.pop[0] - n0;
    }
    expect(born).toBe(55); // ten months of 5.5, no birth lost to rounding
    // Poor affordability lowers births through the bounded multiplier.
    expect(M(0, 0.3, 1.5)).toBeLessThan(1);
  });

  it('a rare flow still happens: 0.3 births a month add up', () => {
    const { c, i, t } = town({ P0: 55 }); // 55 × 0.0055 ≈ 0.30 a month
    t.happy.fill(60);
    const housing = { ...neutral.housing(), afford: [60, 60, 60] };
    let born = 0;
    for (let k = 0; k < 20; k++) {
      t.people.fill(0);
      t.people[person(STAGE_P, 0)] = 55;
      const before = t.books.pop[0];
      stepDemography(t, monthContext(c, i, { coverage: withSchools(t, [0, 0, 0]), housing, labour: neutral.labour() }));
      born += t.books.pop[0] - before;
    }
    expect(born).toBe(6); // 20 × 0.3025 = 6.05
  });

  it('good health means fewer deaths among Retirees', () => {
    const run = (healthy: boolean) => {
      const { c, i, t } = town({ R0: 18000 });
      const cov = withSchools(t, [0, 0, 0], healthy ? { healthCap: 1e6, healthCovered: 1, healthQuality: 1 } : {});
      stepDemography(t, monthContext(c, i, { coverage: cov, housing: neutral.housing(), labour: neutral.labour() }));
      return -t.books.pop[1];
    };
    // R/180·(1.3 − 0.5·Health/100): 130 at Health 0, 80 at Health 100.
    expect(run(false)).toBe(130);
    expect(run(true)).toBe(80);
  });

  it('Aspirants never outnumber the Workers they are counted among, and Well-off workers slide down when out of work', () => {
    const { c, i, t } = town({ W0: 10, W2: 10000 });
    t.aspirants = [50, 0];
    const lab = { ...neutral.labour(), workforce: [8, 0, 8500], unemployed: [0, 0, 850] };
    stepDemography(t, monthContext(c, i, { coverage: withSchools(t, [0, 0, 0]), housing: neutral.housing(), labour: lab }));
    expect(t.aspirants[0]).toBeLessThanOrEqual(t.people[person(STAGE_W, 0)]);
    // 10,000 × 0.002 × (10% / 5%) = 40 slide from £££ to ££ (less the month's retirements and deaths elsewhere).
    expect(t.people[person(STAGE_W, 1)]).toBe(40);
  });

  it('Students graduate into £££ (60%) and ££ Workers', () => {
    const { c, i, t } = town({ S: 3600 });
    const m = monthContext(c, i, { coverage: withSchools(t, [0, 0, 0]), housing: neutral.housing(), labour: neutral.labour() });
    stepDemography(t, m);
    expect(scratchOf(m).graduates).toEqual([0, 40, 60]);
    expect(t.people[PERSON_S]).toBe(3500);
  });
});

describe('the education stock (§4.4)', () => {
  it('moves toward its target with τ 36', () => {
    const { c, i, t } = town({ W0: 100 });
    t.edu = 20;
    const cov = withSchools(t, [0.8, 0.6, 0], { libraryShare: 0.5 });
    stepDemography(t, monthContext(c, i, { coverage: cov, housing: neutral.housing(), labour: neutral.labour() }));
    // target = 100·(0.4 + 0.3) + 15·0.5 = 77.5
    expect(t.edu).toBeCloseTo(20 + (77.5 - 20) / 36, 12);
  });

  it('keeps Retirees and Workers in their stages when nothing flows', () => {
    const { c, i, t } = town({});
    stepDemography(t, monthContext(c, i, { coverage: withSchools(t, [0, 0, 0]), housing: neutral.housing(), labour: neutral.labour() }));
    expect(population(t)).toBe(0);
    expect(t.people[person(STAGE_R, 0)]).toBe(0);
    expect(t.people[person(STAGE_P, 0)]).toBe(0);
  });
});
