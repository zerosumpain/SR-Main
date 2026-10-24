// WP2b housing (spec §5.8 with A9, A10): the allocation, newcomers never
// displacing residents, rent and affordability, the supply-line Homes meter,
// gentrification with Keep Homes Affordable, and filtering.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { monthContext, supplyFromPlanes } from '../../../../../scripts/hometowns/people-kit';
import { population } from './core';
import { neutral } from './derived';
import { M, T } from './fx';
import { allocate, cohortPersons, homeTiles, homesTarget, houseNewcomers, stepHouseholds, stepHousing } from './housing';
import { paramsFor } from './params';
import { memoFor } from './people';
import { readTileLog } from './records';
import { CELLS, MARK_AFFORDABLE, encodeCells, lvlTier, pairSet, planesOf } from './tiles';
import { STAGE_W, person, type TownState } from './types';

const P = paramsFor('v1');
// Cohort order: wL fL rL wM fM rM wH fH rH s
const coh = (x: Partial<Record<'wL' | 'fL' | 'rL' | 'wM' | 'fM' | 'rM' | 'wH' | 'fH' | 'rH' | 's', number>>) =>
  ['wL', 'fL', 'rL', 'wM', 'fM', 'rM', 'wH', 'fH', 'rH', 's'].map((k) => x[k as keyof typeof x] ?? 0);

describe('the allocation (§5.8)', () => {
  it('fills own tiers first in the order Families, Retirees, Workers; anyone left is squeezed', () => {
    const a = allocate(coh({ wL: 60, fL: 50, wM: 20, fM: 40, rM: 10, wH: 5, s: 10 }), [100, 50, 0]);
    expect(a.occ).toEqual([100, 50, 0]);
    expect(a.squeezed).toEqual(coh({ wL: 10, wM: 20, wH: 5, s: 10 }));
    expect(a.squeezedTier).toEqual([20, 20, 5]);
  });

  it('lets Families and Retirees go one tier down, and Students take £ then ££ homes', () => {
    const a = allocate(coh({ wL: 30, fL: 50, fM: 40, rH: 6, s: 25 }), [100, 15, 10]);
    // Own tiers: 50 £ Families and 30 £ Workers, 15 ££ Families, 6 £££ Retirees. Then 20 more ££
    // Families take the last £ homes one tier down. Students take only £ and ££ homes, so the
    // spare £££ homes stay empty and the Students are squeezed.
    expect(a.housed).toEqual(coh({ wL: 30, fL: 50, fM: 35, rH: 6, s: 0 }));
    expect(a.squeezed).toEqual(coh({ fM: 5, s: 25 }));
    expect(a.vacant).toEqual([0, 0, 4]);
  });

  it('never lets newcomers squeeze out a resident', () => {
    // ££ Workers fill the ££ homes; a newcomer ££ Family could take a £ home one tier down,
    // but next month it would take a ££ home ahead of a Worker, who cannot go down.
    const residents = coh({ wL: 50, wM: 40 });
    const cap = [100, 40, 0];
    const housed = houseNewcomers(residents, cap, coh({ fM: 30, wL: 70 }));
    expect(housed).toEqual(coh({ fM: 0, wL: 50 }));
    const after = residents.map((n, k) => n + housed[k]);
    expect(allocate(after, cap).squeezed.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('the Homes meter target (§5.8, A9, A10)', () => {
  it('aims at 5% vacancy through tanh of the waiting-list ratio', () => {
    const r = homesTarget(950, 0, 100, 0, 1000, 0, 0, true, { params: P });
    expect(r.ratio).toBeCloseTo(1050 / 955, 12);
    expect(r.value).toBeCloseTo(100 * T(P.meters.homesGain * (1050 / 955 - 1)), 12);
    // The Why terms explain the whole value.
    expect(r.terms.reduce((s, [, a]) => s + a, 0)).toBeCloseTo(r.value, 9);
  });

  it('counts the pipeline (supply-line correction): homes under construction lower the meter', () => {
    const none = homesTarget(950, 0, 100, 0, 1000, 0, 0, true, { params: P });
    const some = homesTarget(950, 0, 100, 0, 1000, 200, 0, true, { params: P });
    expect(none.value).toBeGreaterThan(20);
    expect(some.value).toBeLessThan(0);
    expect(some.terms.find(([k]) => k === 'meter.homes.pipeline')![1]).toBeLessThan(0);
  });

  it('takes 15 a missing need item, floored at −60 (A10), and caps an unreachable meter at +35 (A9)', () => {
    const base = homesTarget(1000, 300, 300, 50, 1000, 0, 0, true, { params: P }).value;
    expect(homesTarget(1000, 300, 300, 50, 1000, 0, 2, true, { params: P }).value).toBeCloseTo(base - 30, 9);
    expect(homesTarget(1000, 300, 300, 50, 1000, 0, 7, true, { params: P }).value).toBeCloseTo(base - 60, 9);
    expect(base).toBeGreaterThan(35);
    const capped = homesTarget(1000, 300, 300, 50, 1000, 0, 0, false, { params: P });
    expect(capped.value).toBe(35);
    expect(capped.terms.some(([k]) => k === 'meter.homes.unreachable')).toBe(true);
  });
});

/** The town fixture, with land value set everywhere and the given Workers by tier. */
function town(lv: number, workers: number[]): { c: ReturnType<typeof fixture>['county']; i: number; t: TownState } {
  const f = fixture('town');
  const t = f.county.towns[f.town];
  t.lv = encodeCells(new Uint8Array(CELLS).fill(lv));
  t.people.fill(0);
  for (let h = 0; h < 3; h++) t.people[person(STAGE_W, h)] = workers[h];
  t.carry = {};
  t.books.popOpen = population(t);
  return { c: f.county, i: f.town, t };
}

describe('rent and affordability (§5.8)', () => {
  it('prices rent from land value and occupancy, and affordability from the rent share', () => {
    const { c, i, t } = town(110, [950, 0, 0]);
    const dev = { ...neutral.development(), cap: [1000, 1000, 1000] };
    const lab = { ...neutral.labour(), incomePerPerson: [1000, 2000, 3000] };
    const m = monthContext(c, i, { development: dev, labour: lab });
    stepHouseholds(t, m);
    const h = m.derived.housing!;
    const rent = 260 * (0.6 + (0.4 * 110) / 50) * M(0.95 / 0.95, 0.35, 4);
    expect(h.rent[0]).toBeCloseTo(rent, 9);
    expect(h.rentShare[0]).toBeCloseTo((rent * 1.08) / 1000, 9);
    expect(h.afford[0]).toBeCloseTo(100 * (1 - ((rent * 1.08) / 1000 - 0.25) / 0.35), 9);
    expect(h.occ).toEqual([950, 0, 0]);
    expect(h.vacant).toEqual([50, 1000, 1000]);
  });

  it('charges ×0.8 rent in Keep Homes Affordable areas', () => {
    const { c, i, t } = town(110, [500, 0, 0]);
    const lab = { ...neutral.labour(), incomePerPerson: [1000, 2000, 3000] };
    const dev = { ...neutral.development(), cap: [1000, 1000, 1000] };
    const plain = monthContext(c, i, { development: dev, labour: lab });
    stepHouseholds(t, plain);
    const homes = homeTiles(t);
    for (let k = 0; k < homes.count; k++) if (homes.tier[k] === 0) pairSet(t.marks, homes.tile[k], MARK_AFFORDABLE);
    const kha = monthContext(c, i, { development: dev, labour: lab });
    stepHouseholds(t, kha);
    expect(kha.derived.housing!.rent[0]).toBeCloseTo(plain.derived.housing!.rent[0] * 0.8, 9);
  });
});

/** Runs M7a then M12 for `months` months on the town's own tiles. */
function housingMonths(c: ReturnType<typeof fixture>['county'], i: number, t: TownState, months: number, before?: () => void) {
  for (let k = 0; k < months; k++) {
    before?.();
    const m = monthContext(c, i, { development: supplyFromPlanes(t), labour: { ...neutral.labour(), incomePerPerson: [1500, 2500, 4000] }, needs: neutral.needs() });
    stepHouseholds(t, m);
    stepHousing(t, m);
    t.tick += 4;
  }
}

function tierCounts(t: TownState): number[] {
  const homes = homeTiles(t);
  const out = [0, 0, 0];
  for (let k = 0; k < homes.count; k++) out[lvlTier(planesOf(t).lvl[homes.tile[k]])]++;
  return out;
}

describe('gentrification and filtering (§5.8)', () => {
  it('re-tiers homes upward where land value has risen past the band and the next tier wants homes', () => {
    const { c, i, t } = town(200, [3000, 3000, 500]);
    const before = tierCounts(t);
    // Hold the next tiers' meters high (in a real town the ££ and £££ waiting lists would).
    housingMonths(c, i, t, 6, () => (t.meters[1] = t.meters[2] = 60));
    const after = tierCounts(t);
    expect(after[0]).toBeLessThan(before[0]);
    expect(after[2]).toBeGreaterThan(before[2]);
    // About 3% a month of the eligible tiles: 6 months of £ tiles re-tier at roughly 1 − 0.97⁶ ≈ 17%.
    const share = (before[0] - after[0]) / before[0];
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.3);
    expect(readTileLog(t).some((e) => e.kind === 'retier')).toBe(true);
  });

  it('does not re-tier where the next tier’s meter is low, nor inside Keep Homes Affordable', () => {
    const quiet = town(200, [3000, 3000, 500]);
    quiet.t.meters[1] = 10;
    quiet.t.meters[2] = 10;
    const before = tierCounts(quiet.t);
    housingMonths(quiet.c, quiet.i, quiet.t, 3);
    expect(tierCounts(quiet.t)).toEqual(before);

    const kha = town(200, [3000, 3000, 500]);
    kha.t.meters[1] = 60;
    kha.t.meters[2] = 60;
    const homes = homeTiles(kha.t);
    for (let k = 0; k < homes.count; k++) if (homes.tier[k] < 2) pairSet(kha.t.marks, homes.tile[k], MARK_AFFORDABLE);
    const b2 = tierCounts(kha.t);
    housingMonths(kha.c, kha.i, kha.t, 3);
    expect(tierCounts(kha.t)).toEqual(b2);
  });

  it('turns residents of re-tiered homes who find no other home into forced movers', () => {
    const { c, i, t } = town(200, [0, 0, 0]);
    // Fill every £ home with £ Workers, so a re-tiered £ home's residents have nowhere else to go.
    const cap = supplyFromPlanes(t).cap;
    t.people[person(STAGE_W, 0)] = cap[0];
    t.meters[1] = 60;
    housingMonths(c, i, t, 2);
    expect(memoFor(t).displaced[0]).toBeGreaterThan(0);
    expect(memoFor(t).displaced[0]).toBeLessThanOrEqual(t.squeezed);
  });

  it('filters ££ homes down to £ after a year of slack ££ demand, lowest land value first', () => {
    const { c, i, t } = town(80, [2000, 100, 0]);
    t.meters[1] = -50;
    t.meters[2] = -50;
    memoFor(t).vacHigh = 12;
    const before = tierCounts(t);
    housingMonths(c, i, t, 1);
    const after = tierCounts(t);
    // 1% of ££ tiles a month (with its carry).
    expect(before[1] - after[1]).toBe(Math.floor(before[1] * 0.01));
    expect(after[0] - before[0]).toBe(before[1] - after[1]);
    expect(memoFor(t).vacHigh).toBe(13); // ££ is still slack
  });

  it('moves Aspirants up into the next tier’s vacancies', () => {
    const { c, i, t } = town(80, [2000, 0, 0]);
    t.aspirants = [120, 0];
    housingMonths(c, i, t, 1);
    expect(t.people[person(STAGE_W, 1)]).toBe(120);
    expect(t.aspirants[0]).toBe(0);
  });
});

describe('cohortPersons', () => {
  it('counts Families as Parents with their Children', () => {
    const p = new Array<number>(13).fill(0);
    p[person(1, 1)] = 7;
    p[person(2, 1)] = 9;
    expect(cohortPersons(p)[4]).toBe(16);
  });
});
