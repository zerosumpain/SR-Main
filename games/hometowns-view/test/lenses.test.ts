// The fourteen lenses (spec §9.4): which a town has, that every one reads a
// real field on a big town, and the "why is it 140 here?" readout.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../scripts/hometowns/fixture';
import { MAP, TILES, gridEndAt, paramsFor } from '../src/engine';
import { LENS_DEFS, LENS_IDS, cellWhy, lensData, lensesFor, needsSpace, readSpace, step5 } from '../src/lenses';

describe('the lens list', () => {
  it('has all fourteen, each with a five-step legend for adults and for children', () => {
    expect(LENS_IDS).toHaveLength(14);
    for (const id of LENS_IDS) {
      expect(LENS_DEFS[id].legend).toHaveLength(5);
      expect(LENS_DEFS[id].kid).toHaveLength(5);
      expect(LENS_DEFS[id].steps).toHaveLength(4);
    }
  });

  it('gives a Hamlet two lenses and a Village all fourteen', () => {
    expect(lensesFor(0)).toEqual(['happy', 'landValue']);
    expect(lensesFor(1)).toHaveLength(14);
    expect(needsSpace('happy') || needsSpace('landValue') || needsSpace('none')).toBe(false);
  });

  it('steps values by thresholds', () => {
    expect([0, 39, 40, 69, 70, 100, 139, 140, 250].map((v) => step5(v, [40, 70, 100, 140]))).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 4]);
  });
});

describe('every lens on the metropolis fixture', () => {
  const f = fixture('metropolis');
  const c = f.county;
  const t = c.towns[f.town];
  const params = paramsFor(c.paramsVersion);
  const env = { params, snapshot: c.snapshot, rivalry: c.settings.rivalry, mishaps: c.settings.mishaps, dayIndex: c.dayIndex };
  const space = readSpace(t, { env, townIndex: f.town, at: gridEndAt(c, c.gridTick - 1) });

  for (const id of LENS_IDS)
    it(`${id}: steps 0–4 where it speaks, a finite value under every step`, () => {
      const d = lensData(id, t, needsSpace(id) ? space : null, params);
      let shown = 0;
      for (let i = 0; i < TILES; i++) {
        if (d.steps[i] === 255) continue;
        shown++;
        expect(d.steps[i]).toBeLessThanOrEqual(4);
        expect(Number.isFinite(d.values[i])).toBe(true);
      }
      expect(shown).toBeGreaterThan(0);
    });

  it('needs the space read for field lenses', () => {
    expect(() => lensData('pollution', t, null, params)).toThrow();
  });

  it('explains a land value cell with its top three terms', () => {
    const d = lensData('landValue', t, null, params);
    const w = cellWhy('landValue', d, space, MAP / 2, MAP / 2 + 8);
    expect(w.value).not.toBeNull();
    expect(w.terms.length).toBeGreaterThan(0);
    expect(w.terms.length).toBeLessThanOrEqual(3);
    expect(w.line).toMatch(/^Land value \d+: [+−]\d+ /);
    for (let k = 1; k < w.terms.length; k++) expect(Math.abs(w.terms[k][1])).toBeLessThanOrEqual(Math.abs(w.terms[k - 1][1]));
  });

  it('says so where a lens has nothing to say', () => {
    const d = lensData('traffic', t, space, params);
    const off = [...d.steps].findIndex((s) => s === 255);
    const w = cellWhy('traffic', d, space, off % MAP, Math.floor(off / MAP));
    expect(w.value).toBeNull();
    expect(w.line).toBe('Traffic nothing here');
  });
});
