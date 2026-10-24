// Land value (§5.7): the ±8 rate cap, the LV* sum, Premium, Scenic, and the
// cap holding month after month on the Metropolis fixture.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { kitTown, monthOf } from '../../../../../scripts/hometowns/space-kit';
import { stepFields } from './fields';
import { homesTaxPercent, landValueTargets, landValueTerms, nextLandValue, premiumOf, scenicOf, type LandValueInputs } from './landvalue';
import { paramsFor } from './params';
import { generateTerrain, TF_COAST, T_SAND, terrainKind } from './terrain';
import { CELLS, decodeCells } from './tiles';
import { makeContext } from './tick';
import { newDerivedCache } from './derived';
import { MonthWhy } from './why';
import { STARS } from './types';

const P = paramsFor('v1');
const fill = (v: number) => new Float64Array(CELLS).fill(v);

function inputs(o: Partial<Record<keyof LandValueInputs, number>> = {}): LandValueInputs {
  return {
    jobsAccess: fill(o.jobsAccess ?? 0),
    nature: fill(o.nature ?? 0),
    school: fill(o.school ?? 0),
    health: fill(o.health ?? 0),
    culture: fill(o.culture ?? 0),
    transit: fill(o.transit ?? 0),
    pollution: fill(o.pollution ?? 0),
    noise: fill(o.noise ?? 0),
    crime: fill(o.crime ?? 0),
    scenic: fill(o.scenic ?? 0),
    bonus: fill(o.bonus ?? 0),
    potholes: new Uint8Array(CELLS).fill(o.potholes ?? 0),
    premium: o.premium ?? 0,
  };
}

describe('LV* (§5.7)', () => {
  it('is the additive sum of the published terms', () => {
    const i = inputs({ jobsAccess: 60, nature: 40, school: 50, health: 30, culture: 20, transit: 10, scenic: 15, premium: 5, pollution: 20, noise: 10, crime: 30 });
    const want = 28 + 0.35 * 60 + 0.2 * 40 + 0.15 * 50 + 0.1 * 30 + 0.12 * 20 + 0.1 * 10 + 15 + 5 - 0.55 * 20 - 0.25 * 10 - 0.35 * 30;
    expect(landValueTargets(i, P)[7]).toBeCloseTo(want, 12);
    const terms = landValueTerms(i, P, 7);
    expect(terms.reduce((s, [, v]) => s + v, 0)).toBeCloseTo(want, 12);
    expect(terms.map(([k]) => k)).toContain('lv.jobs');
  });

  it('clamps to the plane’s 1–250, and potholes cost 5 on road cells', () => {
    expect(landValueTargets(inputs({ pollution: 100, crime: 100 }), P)[0]).toBe(1);
    expect(landValueTargets(inputs({ jobsAccess: 100, scenic: 200, premium: 25 }), P)[0]).toBe(250);
    expect(landValueTargets(inputs(), P)[0] - landValueTargets(inputs({ potholes: 1 }), P)[0]).toBe(5);
  });

  it('Premium lifts every plot for good services, lowers it for high homes tax, and is capped at ±25', () => {
    const k = kitTown();
    const t = k.t;
    const set = (v: number) => (t.perceived = t.perceived.map(() => v));
    set(50);
    expect(premiumOf(t, 50, 8, P)).toBe(0);
    set(90);
    expect(premiumOf(t, 90, 8, P)).toBeCloseTo(0.25 * 40, 12);
    expect(premiumOf(t, 90, 12, P)).toBeCloseTo(0.25 * 40 - 1.2 * 4, 12);
    expect(premiumOf(t, 90, 0, P)).toBeCloseTo(0.25 * 40 + 1.2 * 8, 12);
    set(0);
    expect(premiumOf(t, 0, 20, P)).toBe(-25);
    // It reads Schools, Health and Fun from the perceived stars.
    t.perceived[STARS.indexOf('schools')] = 70;
    expect(premiumOf(t, 0, 8, P)).toBeCloseTo(0.25 * (70 / 4 - 50), 12);
    expect(homesTaxPercent(t, [0, 0, 0])).toBe(8);
  });

  it('Scenic gives the beach +20 on a coast and nothing in plain fields', () => {
    const coast = generateTerrain(5, 'coast');
    const s = scenicOf(coast, P.landValue.scenic);
    let beachCell = -1;
    for (let i = 0; i < coast.length; i++)
      if (terrainKind(coast[i]) === T_SAND && coast[i] & TF_COAST) {
        beachCell = ((i >> 6) >> 1) * 32 + ((i & 63) >> 1);
        break;
      }
    expect(beachCell).toBeGreaterThanOrEqual(0);
    expect(s[beachCell]).toBe(20);
    const flat = new Uint8Array(4096);
    expect(scenicOf(flat, P.landValue.scenic).every((v) => v === 0)).toBe(true);
  });
});

describe('the rate cap', () => {
  it('moves at most ±8 a month toward LV*, in whole numbers, inside 1–250', () => {
    const lv = new Uint8Array(CELLS).fill(100);
    lv[1] = 1;
    lv[2] = 250;
    const target = fill(100);
    target[0] = 250;
    target[1] = 250;
    target[2] = 1;
    target[3] = 103.4;
    target[4] = 96.6;
    const out = nextLandValue(lv, target, 8);
    expect([out[0], out[1], out[2], out[3], out[4], out[5]]).toEqual([108, 9, 242, 103, 97, 100]);
  });

  it('holds month after month on the Metropolis fixture', () => {
    const f = fixture('metropolis');
    const t = f.county.towns[f.town];
    for (let month = 0; month < 12; month++) {
      const before = decodeCells(t.lv);
      const ctx = makeContext(f.county, f.town, t.tick);
      stepFields(t, { ...ctx, month: ctx.world.month, derived: newDerivedCache(), why: new MonthWhy() });
      const after = decodeCells(t.lv);
      for (let c = 0; c < CELLS; c++) {
        expect(Math.abs(after[c] - before[c])).toBeLessThanOrEqual(8);
        expect(after[c]).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('starts from the A11 founding plane and stays put on bare land with no one there', () => {
    const k = kitTown({ lv: 40 });
    const m = monthOf(k);
    stepFields(k.t, m);
    const after = decodeCells(k.t.lv);
    // Bare grass, no services: LV* = 28 + premium (stars 50, tax 8% → 0) + whatever crime adds.
    expect(Math.abs(after[300] - 40)).toBeLessThanOrEqual(8);
  });
});
