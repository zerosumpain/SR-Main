// Growth stages (spec §7): each tier's checklist, promotion only after the
// population and the whole checklist hold at two consecutive Regional Days,
// the parcel rights a promotion grants, and no demotion ever.

import { describe, expect, it } from 'vitest';
import { civicSteps } from '../../../../../scripts/hometowns/civic-kit';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { runMonths } from '../../../../../scripts/hometowns/people-kit';
import { TIER_DEFS } from './content';
import { population, postPeople } from './core';
import { civicMemo } from './finance';
import { paramsFor } from './params';
import { CHECKLISTS, SERVICE_ITEMS, checklistOf, judgeChecklist, servicesCovered, stepTierCheck, type CheckFacts } from './tiers';
import { COVERAGES, person, type CountyState, type RegionalContext, type TownState } from './types';

const P = paramsFor('v1');

const facts = (over: Partial<CheckFacts> = {}): CheckFacts => ({
  pop: 0, approval: 70, wateredHomes: 1, poweredTiles: 1, shopTiles: 10,
  built: { schoolHouse: 1, healthCentre: 1, library: 1, university: 1 },
  covered: COVERAGES.map(() => 1), primarySeats: 1, secondarySeats: 1, unemployment: 0.05, safety: 70,
  cultureStar: 80, transitShare: 0.3, landmarks: 2, pollution: 20, rating: 1, greatCulture: 75, ...over,
});

const at = (tier: number) => ({ tier } as TownState);
const allMet = (tier: number) => (1 << CHECKLISTS[tier].length) - 1;

describe('the checklists (§7)', () => {
  it('match the table, item by item', () => {
    expect(CHECKLISTS.map((c) => c.map((i) => i.id))).toEqual([
      [],
      ['water90', 'market', 'school', 'green70', 'approval50'],
      ['surgery70', 'police50', 'fire70', 'power95', 'primary80', 'jobs90', 'approval55'],
      ['secondary75', 'healthCentre', 'libraryMuseum', 'bus40', 'safety60', 'jobs90', 'approval55'],
      ['university', 'culture60', 'transit20', 'landmarks2', 'pollution45', 'ratingA', 'approval60'],
      ['culture75'],
    ]);
    for (let tier = 0; tier <= 4; tier++) expect(judgeChecklist(at(tier), facts()).met).toBe(allMet(tier + 1));
  });

  it('fails each item at its threshold', () => {
    const cov = (k: (typeof COVERAGES)[number], v: number) => facts({ covered: COVERAGES.map((c) => (c === k ? v : 1)) });
    const miss = (tier: number, f: CheckFacts) => CHECKLISTS[tier].filter((_, k) => !(judgeChecklist(at(tier - 1), f).met & (1 << k))).map((i) => i.id);
    expect(miss(1, facts({ wateredHomes: 0.89 }))).toEqual(['water90']);
    expect(miss(1, facts({ shopTiles: 5 }))).toEqual(['market']);
    expect(miss(1, facts({ built: {} }))).toEqual(['school']);
    expect(miss(1, facts({ covered: COVERAGES.map(() => 0.69) }))).toEqual(['green70']);
    expect(miss(1, facts({ approval: 49.9 }))).toEqual(['approval50']);
    expect(miss(2, cov('health', 0.69))).toEqual(['surgery70']);
    expect(miss(2, cov('police', 0.49))).toEqual(['police50']);
    expect(miss(2, cov('fire', 0.69))).toEqual(['fire70']);
    expect(miss(2, facts({ poweredTiles: 0.94, primarySeats: 0.79, unemployment: 0.11 }))).toEqual(['power95', 'primary80', 'jobs90']);
    expect(miss(3, facts({ secondarySeats: 0.74, built: { university: 1 }, safety: 59 }))).toEqual(['secondary75', 'healthCentre', 'libraryMuseum', 'safety60']);
    expect(miss(3, cov('transit', 0.39))).toEqual(['bus40']);
    expect(miss(4, facts({ built: {}, cultureStar: 59, transitShare: 0.19, landmarks: 1, pollution: 46, rating: 3, approval: 59 }))).toEqual(['university', 'culture60', 'transit20', 'landmarks2', 'pollution45', 'ratingA', 'approval60']);
  });

  it('never counts approval among the unmet items that Approval itself reads', () => {
    expect(judgeChecklist(at(0), facts({ approval: 0, wateredHomes: 0 })).unmetOthers).toBe(1);
  });
});

// ---- Promotion ---------------------------------------------------------------------------------------------

function ready(kind: 'hamlet' | 'town' = 'hamlet') {
  const f = fixture(kind);
  const t = f.county.towns[f.town];
  const next = t.tier + 1;
  if (population(t) < TIER_DEFS[next].population) postPeople(t, 'arrivals', person(0, 0), TIER_DEFS[next].population + 20 - population(t));
  civicMemo(t).check = { tier: next, met: allMet(next), items: CHECKLISTS[next].length };
  return { c: f.county, t };
}
const day = (c: CountyState) => {
  stepTierCheck(c, { params: P, dayIndex: c.dayIndex, at: 0, month: 0, countyWeek: false, report: { dayIndex: c.dayIndex, at: 0, ran: true, sprintsRun: 0, countyWeek: false, steps: [] } } as RegionalContext);
  c.dayIndex += 1;
};

describe('promotion', () => {
  it('needs the population and every item at two consecutive Regional Days', () => {
    const { c, t } = ready();
    expect(population(t)).toBeGreaterThanOrEqual(TIER_DEFS[1].population);
    day(c);
    expect(t.tier).toBe(0);
    expect(t.tierHold).toBe(1);
    day(c);
    expect(t.tier).toBe(1);
    expect(t.tierHold).toBe(0);
    expect(t.parcelRights).toBe(TIER_DEFS[1].parcelRights);
    expect(t.inbox.at(-1)!.kind).toBe('promotion');
    expect(t.inbox.at(-1)!.data.tier).toBe(1);
    // The stale checklist (for Village) cannot promote it again.
    day(c);
    day(c);
    expect(t.tier).toBe(1);
  });

  it('starts the hold again after a day that misses', () => {
    const { c, t } = ready();
    day(c);
    const memo = civicMemo(t);
    memo.check.met &= ~1; // water dips below 90% for a day
    day(c);
    expect(t.tierHold).toBe(0);
    memo.check.met = allMet(1);
    day(c);
    expect(t.tier).toBe(0);
    day(c);
    expect(t.tier).toBe(1);
  });

  it('waits for the population threshold', () => {
    const { c, t } = ready();
    postPeople(t, 'leavers', person(0, 0), -(population(t) - 299));
    expect(population(t)).toBe(299);
    for (let k = 0; k < 4; k++) day(c);
    expect(t.tier).toBe(0);
  });

  it('never demotes: a shrinking town keeps its tier and shows the struggling badge', () => {
    const { c, t } = ready('town');
    civicMemo(t).check.met = 0;
    day(c);
    const peak = population(t);
    postPeople(t, 'leavers', person(0, 1), -Math.floor(t.people[person(0, 1)] * 0.9));
    postPeople(t, 'leavers', person(0, 0), -Math.floor(t.people[person(0, 0)] * 0.9));
    expect(population(t)).toBeLessThan(0.9 * peak);
    day(c);
    expect(t.tier).toBe(2);
    expect(civicMemo(t).struggling).toBe(true);
    expect(civicMemo(t).peak).toBe(peak);
  });

  it('gives a Metropolis of 150,000 with Culture 75 the Great Metropolis title, once', () => {
    const { c, t } = ready('town');
    t.tier = 4;
    civicMemo(t).check = { tier: 5, met: 1, items: 1 };
    postPeople(t, 'arrivals', person(0, 1), 150_000 - population(t));
    for (let k = 0; k < 5; k++) day(c);
    expect(t.trophies).toEqual(['greatMetropolis']);
    expect(t.tier).toBe(4);
  });

  it('is judged at every month end from the month’s own numbers', () => {
    const f = fixture('town');
    const t = f.county.towns[f.town];
    runMonths(f.county, f.town, 1, civicSteps({}));
    const memo = civicMemo(t);
    expect(memo.check.tier).toBe(3);
    expect(memo.check.items).toBe(7);
    expect(checklistOf(t).map((x) => x.id)).toEqual(CHECKLISTS[3].map((i) => i.id));
  });
});

describe('services covered (decision 8b)', () => {
  const P8 = paramsFor('v1');
  const cov = (over: Partial<Record<(typeof COVERAGES)[number], number>>) => COVERAGES.map((k) => over[k] ?? 0);
  it('judges a Hamlet on the green, a Village also on surgery, police and fire, a Town and above also on the buses', () => {
    expect(servicesCovered(at(0), facts({ covered: cov({ nature: 0.7 }) }))).toBe(1);
    expect(servicesCovered(at(0), facts({ covered: cov({ fun: 0.69 }) }))).toBe(0);
    expect(servicesCovered(at(1), facts({ covered: cov({ nature: 1, health: 0.7, police: 0.5 }) }))).toBe(3 / 4);
    expect(servicesCovered(at(2), facts({ covered: cov({ nature: 1, health: 1, police: 1, fire: 1 }) }))).toBe(4 / 5);
    expect(servicesCovered(at(4), facts())).toBe(1);
    expect(SERVICE_ITEMS.every((id) => CHECKLISTS.some((c) => c.some((it) => it.id === id)))).toBe(true);
    expect(P8.civic.approvalServices).toBeGreaterThan(0);
  });
});
