// WP2b labour market (spec §5.9 with A1–A4): matching by tier with
// underemployment, pro-rata sharing, trainees, commuters, reachability,
// support income, entry-level civic staff and per-building staffing.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { monthContext } from '../../../../../scripts/hometowns/people-kit';
import { buildingIndex } from './content';
import { neutralFlows, population } from './core';
import { neutral } from './derived';
import { T } from './fx';
import { civicStaffNeeds, stepLabour } from './labour';
import { paramsFor } from './params';
import { B_STAFF, newBuilding } from './tiles';
import { SECTORS, STAGE_P, STAGE_R, STAGE_W, person, type LabourSlot, type TownState } from './types';

const P = paramsFor('v1');
const S = (s: (typeof SECTORS)[number]) => SECTORS.indexOf(s);

/** The town fixture with no civic buildings, the given Workers by tier and nobody else. */
function town(workers: number[], extra: Partial<Record<'R0' | 'P0', number>> = {}) {
  const f = fixture('town');
  const t = f.county.towns[f.town];
  t.people.fill(0);
  t.buildings = [];
  for (let h = 0; h < 3; h++) t.people[person(STAGE_W, h)] = workers[h];
  if (extra.R0) t.people[person(STAGE_R, 0)] = extra.R0;
  if (extra.P0) t.people[person(STAGE_P, 0)] = extra.P0;
  t.carry = {};
  t.books.popOpen = population(t);
  return { c: f.county, i: f.town, t };
}

/** A development slot with the given jobs [sector][tier]. */
function supply(jobs: Partial<Record<(typeof SECTORS)[number], number[]>>) {
  const d = neutral.development();
  for (const [s, mix] of Object.entries(jobs)) for (let h = 0; h < 3; h++) d.jobs[S(s as (typeof SECTORS)[number]) * 3 + h] = mix![h];
  return d;
}

function labour(t: TownState, c: ReturnType<typeof town>['c'], i: number, dev = neutral.development(), over = {}): LabourSlot {
  const m = monthContext(c, i, { development: dev, ...over });
  stepLabour(t, m);
  return m.derived.labour!;
}

describe('matching by tier (§5.9)', () => {
  it('fills own tiers first, then lets the leftovers work one tier down as underemployed', () => {
    const { c, i, t } = town([200, 200, 200]); // workforce 170 each (participation 0.85)
    const l = labour(t, c, i, supply({ industry: [250, 100, 60] }));
    expect(l.workforce).toEqual([170, 170, 170]);
    expect(l.underemployed).toEqual([0, 70, 0]); // ££ leftovers into £ slots; no ££ slot left for £££
    expect(l.unemployed).toEqual([0, 0, 110]);
    expect(l.vacancies).toEqual([10, 0, 0]);
    expect(l.employed).toEqual([170, 170, 60]);
  });

  it('shares a tier’s workers over the sectors pro rata to open slots (A3): equal fill rates', () => {
    const { c, i, t } = town([200, 0, 0]);
    const l = labour(t, c, i, supply({ farms: [100, 0, 0], shops: [240, 0, 0] }));
    expect(l.sectorFilled[S('farms')]).toBe(50);
    expect(l.sectorFilled[S('shops')]).toBe(120);
    expect(l.fillRate[S('farms')]).toBe(0.5);
    expect(l.fillRate[S('shops')]).toBe(0.5);
  });

  it('lets unemployed £ workers train in up to 25% of a sector’s ££ slots (A4)', () => {
    const { c, i, t } = town([1000, 0, 0]); // workforce 850
    const l = labour(t, c, i, supply({ industry: [100, 200, 0] }));
    expect(l.trainees).toEqual([50, 0, 0]);
    expect(l.fillRate[S('industry')]).toBe(0.5); // (100 + 50) / 300: trainees count toward fillRate
    expect(l.sectorEffective![S('industry')]).toBe(100 + 0.8 * 50); // but work at ×0.8
    expect(l.unemployed).toEqual([700, 0, 0]);
    // Trainees earn their own tier's wage.
    expect(l.sectorWages![S('industry')]).toBeCloseTo(150 * l.wage[0], 6);
  });

  it('pays support and pensions from outside the town (A1), so a jobless hamlet still has an income', () => {
    const { c, i, t } = town([100, 0, 0], { R0: 50 });
    const l = labour(t, c, i);
    const support = 0.35 * 1600 * 85;
    const pensions = 0.6 * 1600 * 50;
    expect(l.support).toBeCloseTo(support, 6);
    expect(l.pensions).toBeCloseTo(pensions, 6);
    expect(l.income[0]).toBeCloseTo(support + pensions, 6);
    expect(l.incomePerPerson[0]).toBeCloseTo((support + pensions) / 150, 6);
  });

  it('sets wages from productivity and the tightness of the market', () => {
    const { c, i, t } = town([300, 200, 0]); // 255 £ for 100 £ slots and 75 trainee places; 170 ££ for 300
    const l = labour(t, c, i, supply({ industry: [100, 300, 0] }));
    expect(l.unemployed[0]).toBe(80);
    for (let h = 0; h < 2; h++) {
      const vac = l.vacancies[h] / Math.max(1, l.jobSlots[h]);
      const u = l.unemployed[h] / Math.max(1, l.workforce[h]);
      expect(l.wage[h]).toBeCloseTo(P.labour.W0[h] * l.prod * (1 + 0.2 * T(3 * (vac - u))), 9);
    }
    expect(l.wage[1]).toBeGreaterThan(P.labour.W0[1] * l.prod); // ££ vacancies: a tight market pays more
    expect(l.wage[0]).toBeLessThan(P.labour.W0[0] * l.prod); // £ unemployment: a slack one pays less
  });
});

describe('civic staff (A2, A26)', () => {
  it('Hamlet-tier buildings hire £ only; later ones hire the 30/50/20 civic mix', () => {
    const { t } = town([0, 0, 0]);
    t.buildings = [newBuilding(buildingIndex('townHall'), 30, 40, 0, 0, 1), newBuilding(buildingIndex('healthCentre'), 10, 10, 0, 0, 1)];
    const needs = civicStaffNeeds(t);
    expect([...needs.slice(0, 3)]).toEqual([4, 0, 0]);
    expect([...needs.slice(3, 6)].map((x) => Math.round(x * 1e9) / 1e9)).toEqual([12, 20, 8]);
  });

  it('writes each building’s staffFill: a health centre in a town with no ££ workers is half-empty', () => {
    const { c, i, t } = town([1000, 0, 0]);
    t.buildings = [newBuilding(buildingIndex('healthCentre'), 10, 10, 0, 0, 1)];
    const l = labour(t, c, i);
    // £ 12 of 12; ££ 5 trainees (25% of 20) at ×0.8 = 4 of 20; £££ 0 of 8: (12 + 4) / 40.
    expect(t.buildings[0][B_STAFF]).toBe(400);
    expect(l.staffFill).toBeCloseTo(0.4, 12);
  });
});

describe('commuters and reach (§5.9 steps 2–4)', () => {
  it('in-commuters fill vacancies up to the day’s allowance and are recorded for the Regional Day', () => {
    const { c, i, t } = town([40, 0, 0]); // workforce 34
    c.snapshot.flows[i] = { ...neutralFlows(), commutersIn: [30, 0, 0] };
    const before = t.realised.commutersIn[0];
    const l = labour(t, c, i, supply({ shops: [100, 0, 0] }));
    expect(l.commutersIn).toEqual([30, 0, 0]);
    expect(l.vacancies).toEqual([36, 0, 0]);
    expect(t.realised.commutersIn[0] - before).toBe(30);
  });

  it('out-commuters leave the local unemployed pool', () => {
    const { c, i, t } = town([200, 0, 0]); // workforce 170
    c.snapshot.flows[i] = { ...neutralFlows(), commutersOut: [50, 0, 0] };
    const l = labour(t, c, i, supply({ shops: [100, 0, 0] }));
    expect(l.commutersOut).toEqual([50, 0, 0]);
    expect(l.unemployed).toEqual([20, 0, 0]);
    expect(l.employed).toEqual([150, 0, 0]);
  });

  it('workers with no job district within an hour are unemployed, whatever the slots say', () => {
    const { c, i, t } = town([200, 0, 0]);
    const travel = neutral.travel();
    travel.minutes.fill(100);
    const l = labour(t, c, i, supply({ shops: [1000, 0, 0] }), { travel });
    expect(l.unemployed).toEqual([170, 0, 0]);
  });

  it('keeps a stock of the long-term unemployed that never exceeds unemployment', () => {
    const { c, i, t } = town([1200, 0, 0]); // workforce 1020, no jobs
    t.longUnemployed = [0, 0, 0];
    for (let k = 0; k < 24; k++) labour(t, c, i);
    expect(t.longUnemployed[0]).toBeGreaterThan(900);
    expect(t.longUnemployed[0]).toBeLessThanOrEqual(1020);
    labour(t, c, i, supply({ shops: [1000, 0, 0] }));
    expect(t.longUnemployed[0]).toBeLessThanOrEqual(20);
  });
});
