import { describe, expect, it } from 'vitest';
import { BUILDINGS, lintCatalogue, POLICIES, ZONE_DEFS } from './content';
import { isLeaf, leafPaths, paramsFile, paramsFor, resolveParams } from './params';
import { COHORT_COUNT, METERS, ZONES } from './types';

describe('params.v1.json', () => {
  const file = paramsFile('v1');
  const paths = leafPaths(file);

  it('documents every leaf with {value, min, max, unit, doc, loop}, value inside [min, max]', () => {
    expect(paths.length).toBeGreaterThan(200);
    const get = (p: string) => p.split('.').reduce((n: unknown, k) => (n as Record<string, unknown>)[k], file as unknown);
    const within = (v: unknown, lo: unknown, hi: unknown): boolean =>
      Array.isArray(v) ? v.every((x, i) => within(x, (lo as unknown[])[i], (hi as unknown[])[i])) : typeof v !== 'number' || ((v as number) >= (lo as number) && (v as number) <= (hi as number));
    for (const p of paths) {
      const leaf = get(p);
      expect(isLeaf(leaf), p).toBe(true);
      const l = leaf as Record<string, unknown>;
      expect(Object.keys(l).sort(), p).toEqual(['doc', 'loop', 'max', 'min', 'unit', 'value']);
      expect(typeof l.doc === 'string' && l.doc.length > 5, p).toBe(true);
      expect(within(l.value, l.min, l.max), p).toBe(true);
    }
  });

  it('resolves to plain values and is frozen', () => {
    const p = paramsFor('v1');
    expect(p.develop.pGrow).toBe(0.3);
    expect(p.migration.T.friendly).toBe(1.4);
    expect(p.start.meters).toHaveLength(METERS.length);
    expect(p.migration.weights).toHaveLength(COHORT_COUNT);
    expect(p.migration.n0).toHaveLength(9);
    expect(p.finance.defaults.homes).toBe(800); // basis points (A25)
    expect(Object.isFrozen(p.develop)).toBe(true);
    expect(paramsFor('v1')).toBe(p);
    expect(resolveParams(file).develop.pGrow).toBe(0.3);
  });

  it('keeps the A11 founding values', () => {
    const s = paramsFor('v1').start;
    expect(s.meters).toEqual([60, 0, 0, 40, 0, 20, 0, 40]);
    expect([s.reserves, s.happy, s.approval, s.rep, s.aw, s.culture, s.edu, s.ps]).toEqual([100000, 60, 60, 50, 0.05, 0, 20, 0]);
  });
});

describe('the catalogue (content.ts)', () => {
  it('passes the A14 catalogue lint', () => {
    const p = paramsFor('v1');
    expect(lintCatalogue(p.utilities.exportPower, p.utilities.exportWater)).toEqual([]);
  });

  it('has unique ids and one zone definition per zone', () => {
    const ids = BUILDINGS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(POLICIES.map((p) => p.id)).size).toBe(POLICIES.length);
    expect(ZONE_DEFS.map((z) => z.id)).toEqual([...ZONES]);
    // Town Hall stays at kind 0: every founded town's first building record points at it.
    expect(BUILDINGS[0].id).toBe('townHall');
  });

  it('catches a later item that serves for more upkeep', () => {
    // A doctored Water Works that costs more per unit than a Well.
    const bad = BUILDINGS.find((b) => b.id === 'waterWorks')!;
    const saved = bad.upkeep;
    (bad as { upkeep: number }).upkeep = 200000;
    try {
      expect(lintCatalogue(1, 0.3).some((s) => s.startsWith('waterWorks'))).toBe(true);
    } finally {
      (bad as { upkeep: number }).upkeep = saved;
    }
  });
});
