// M3 Fields (§5.4): the conserving spread, the stored pollution lag,
// emissions and absorption, noise, the four accesses, and the step's writes.

import { describe, expect, it } from 'vitest';
import { kitTown, monthOf, people, place, road, zone, zoneRect, type Kit } from '../../../../../scripts/hometowns/space-kit';
import { fieldsOf, lagStep, spaceAt, spread, stepFields, type FieldsOut } from './fields';
import { paramsFor } from './params';
import { decay, runFor } from './space';
import { SIGNPOST_KINGSPORT } from './terrain';
import { CELLS, CELLS_PER_SIDE, DISTRICTS, cellOf, decodeCells, districtOf, tileIndex, tileX, tileY } from './tiles';
import { travelOf } from './transport';
import { makeContext } from './tick';

const P = paramsFor('v1');
const cell = (x: number, y: number) => y * CELLS_PER_SIDE + x;

function fields(k: Kit): FieldsOut {
  const m = monthOf(k);
  return fieldsOf(runFor(k.t, m, m.derived));
}

describe('the spread kernel', () => {
  it('has gain exactly 1: it moves pollution and never makes or loses any (before absorption)', () => {
    const a = new Float64Array(CELLS);
    for (let c = 0; c < CELLS; c++) a[c] = ((c * 2654435761) >>> 0) % 97;
    let before = 0;
    for (let c = 0; c < CELLS; c++) before += a[c];
    for (const passes of [1, 2, 3, 4]) {
      const out = spread(a, P.fields.pollKeep, P.fields.pollSpread, passes);
      let after = 0;
      for (let c = 0; c < CELLS; c++) after += out[c];
      expect(Math.abs(after - before)).toBeLessThan(1e-9 * before);
    }
  });

  it('keeps 0.6 and gives 0.1 to each neighbour, and an edge cell keeps what would leave the map', () => {
    const a = new Float64Array(CELLS);
    a[cell(10, 10)] = 100;
    a[cell(0, 0)] = 100;
    const out = spread(a, 0.6, 0.1, 1);
    expect(out[cell(10, 10)]).toBeCloseTo(60, 12);
    expect(out[cell(11, 10)]).toBeCloseTo(10, 12);
    expect(out[cell(10, 9)]).toBeCloseTo(10, 12);
    expect(out[cell(0, 0)]).toBeCloseTo(80, 12);
  });
});

describe('the stored pollution lag', () => {
  it('moves half way a month, whole numbers, never stalling a point short', () => {
    expect(lagStep(0, 10, 0.5)).toBe(5);
    expect(lagStep(1, 0, 0.5)).toBe(0); // plain rounding would keep 1 forever
    expect(lagStep(10, 10.6, 0.5)).toBe(11);
    expect(lagStep(11, 10.6, 0.5)).toBe(11);
    expect(lagStep(0, 0.3, 0.5)).toBe(0);
    expect(lagStep(90, 300, 0.5)).toBe(100);
    let p = 0;
    for (let m = 0; m < 12; m++) p = lagStep(p, 40, 0.5);
    expect(p).toBe(40);
  });
});

/** A street with a Coal Plant at its west end and homes along it. */
function smokyTown(): Kit {
  const k = kitTown();
  road(k.t, 4, 20, 60, 20);
  place(k.t, 'coalPlant', 4, 21);
  zoneRect(k.t, 10, 19, 40, 1, 'homes', 2, 0);
  people(k.t, 0, 600);
  return k;
}

describe('pollution and noise', () => {
  it('is worst by the plant, falls away with distance, and reaches its target over months', () => {
    const k = smokyTown();
    let f = fields(k);
    const near = cellOf(tileIndex(5, 22));
    const far = cellOf(tileIndex(50, 19));
    expect(f.slot.pollution[near]).toBeGreaterThan(f.slot.pollution[far]);
    // The first month moves half way from zero.
    const first = f.slot.pollution[near];
    for (let m = 0; m < 8; m++) {
      const mm = monthOf(k);
      stepFields(k.t, mm);
    }
    f = fields(k);
    expect(f.slot.pollution[near]).toBeGreaterThan(first);
    expect(f.slot.pollution[near]).toBeLessThanOrEqual(100);
    expect(f.poll[near]).toBe(f.slot.pollution[near]);
    expect(f.slot.pollutionPop).toBeGreaterThan(0);
  });

  it('is absorbed by parks and cut by Clean Air Rules', () => {
    const at = cellOf(tileIndex(20, 21));
    const beside = cellOf(tileIndex(22, 21));
    const base = fields(kitTownWithIndustry()).slot.pollution;
    expect(base[at]).toBeGreaterThan(0);
    const clean = kitTownWithIndustry();
    clean.t.policies = [{ card: 'cleanAirRules', sinceTick: 0, area: null }];
    expect(fields(clean).slot.pollution[at]).toBeLessThan(base[at]);
    const green = kitTownWithIndustry();
    place(green.t, 'park', 22, 21); // four park tiles: −15 each in their cell
    expect(fields(green).slot.pollution[beside]).toBeLessThan(base[beside]);
  });

  it('makes noise around a Stadium and along busy roads', () => {
    const k = kitTown();
    road(k.t, 4, 20, 60, 20);
    place(k.t, 'stadium', 30, 21);
    const f = fields(k);
    expect(f.slot.noise[cellOf(tileIndex(31, 22))]).toBeGreaterThan(30);
    expect(f.slot.noise[cellOf(tileIndex(5, 40))]).toBe(0);
  });
});

function kitTownWithIndustry(): Kit {
  const k = kitTown();
  road(k.t, 4, 20, 60, 20);
  zoneRect(k.t, 20, 21, 2, 2, 'industry', 4);
  return k;
}

describe('access (§5.4)', () => {
  it('JobsAccess is 100·Σ Jobs·e^(−c/12) / (Σ Jobs + 1) over the district times', () => {
    const k = kitTown();
    road(k.t, 0, 4, 63, 4, 'avenue');
    zoneRect(k.t, 26, 5, 2, 1, 'shops', 2); // 16 jobs in district 3
    zoneRect(k.t, 50, 5, 1, 1, 'shops', 3); // 20 jobs in district 6
    const m = monthOf(k);
    const run = runFor(k.t, m, m.derived);
    const f = fieldsOf(run);
    const M = travelOf(run).slot.minutes;
    const a = districtOf(tileIndex(2, 4));
    const d3 = districtOf(tileIndex(26, 4));
    const d6 = districtOf(tileIndex(50, 4));
    const want = (100 * (16 * decay(M[a * DISTRICTS + d3] / 12) + 20 * decay(M[a * DISTRICTS + d6] / 12))) / (36 + 1);
    expect(f.slot.jobsAccess[cellOf(tileIndex(2, 4))]).toBeCloseTo(want, 6);
    // A cell in a district with no road takes the nearest district that has one.
    expect(f.slot.jobsAccess[cellOf(tileIndex(2, 20))]).toBeCloseTo(want, 6);
  });

  it('Freight is best near the Kingsport signpost and scaled by FreightScore', () => {
    const k = kitTown({ site: 'flatland' });
    const sx = tileX(SIGNPOST_KINGSPORT);
    road(k.t, sx, tileY(SIGNPOST_KINGSPORT), sx, 10, 'avenue');
    const f = fields(k).slot.freight;
    const near = f[cellOf(tileIndex(sx, 62))];
    const far = f[cellOf(tileIndex(sx, 12))];
    expect(near).toBeGreaterThan(far);
    // Flatland: (1.0 + 0.2)/1.6 at the signpost district, e^(−c/15) of its time to the signpost.
    expect(near).toBeLessThanOrEqual((100 * 1.2) / 1.6);
    expect(near).toBeGreaterThan((100 * 1.2 * decay(10 / 15)) / 1.6);
  });

  it('VisitorAccess rises near attractions and saturates', () => {
    const k = kitTown();
    road(k.t, 0, 4, 63, 4, 'avenue');
    place(k.t, 'museum', 10, 5);
    const f = fields(k).slot.visitorAccess;
    expect(f[cellOf(tileIndex(10, 4))]).toBeGreaterThan(f[cellOf(tileIndex(60, 4))]);
    expect(f[cellOf(tileIndex(10, 4))]).toBeLessThan(100);
  });
});

describe('the step', () => {
  it('writes land value, the pollution lag, PS and Safety’s Why, and moves land value at most 8 a month', () => {
    const k = smokyTown();
    place(k.t, 'constablePost', 30, 21);
    const before = decodeCells(k.t.lv);
    const m = monthOf(k);
    stepFields(k.t, m);
    expect(m.derived.fields).not.toBeNull();
    expect(m.derived.coverage).not.toBeNull();
    const after = decodeCells(k.t.lv);
    let moved = 0;
    for (let c = 0; c < CELLS; c++) {
      expect(Math.abs(after[c] - before[c])).toBeLessThanOrEqual(P.fields.lvRateCap);
      if (after[c] !== before[c]) moved++;
    }
    expect(moved).toBeGreaterThan(0);
    expect(k.t.ps).toBeGreaterThan(0);
    expect(decodeCells(k.t.lag.poll).some((v) => v > 0)).toBe(true);
    const why = (m.why as unknown as { problems: string[] }).problems;
    expect(why).toEqual([]);
  });

  it('spaceAt is the same computation without writing anything', () => {
    const k = smokyTown();
    const before = JSON.stringify(k.t);
    const s = spaceAt(k.t, makeContext(k.c, k.i, k.t.tick));
    expect(JSON.stringify(k.t)).toBe(before);
    const f = fields(k);
    expect(Array.from(s.fields.lvTarget)).toEqual(Array.from(f.slot.lvTarget));
    const terms = s.lvTerms(cellOf(tileIndex(20, 19)));
    const sum = terms.reduce((a, [, v]) => a + v, 0);
    expect(Math.max(1, Math.min(250, sum))).toBeCloseTo(f.slot.lvTarget[cellOf(tileIndex(20, 19))], 9);
  });

  it('keeps Safety, crime and every access inside 0–100', () => {
    const k = smokyTown();
    zone(k.t, 3, 19, 'shops', 1);
    const f = fields(k).slot;
    expect(f.safety).toBeGreaterThanOrEqual(0);
    expect(f.safety).toBeLessThanOrEqual(100);
    for (const a of [f.crime, f.jobsAccess, f.custAccess, f.freight, f.visitorAccess, f.noise, f.pollution])
      for (let c = 0; c < CELLS; c++) {
        expect(a[c]).toBeGreaterThanOrEqual(0);
        expect(a[c]).toBeLessThanOrEqual(100);
      }
  });
});
