import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { fitToBudget } from './budget';
import { artefact, type Artefact } from './contracts';
import { fitToBudgetReference } from '../../../tests/fixtures/policy-analysis/budget-reference';

const build = (a: Artefact[]) => ({ stage: 9, artefacts: a, idPrefix: 's9_000_' });
const encodedSize = (v: unknown) => JSON.stringify(v).length;

/** Artefacts shaped like a real assessment: profiles are fat, claims are not. */
const corpus = (n: number): Artefact[] =>
  Array.from({ length: n }, (_, i) =>
    artefact(`a_${String(i).padStart(4, '0')}`, i % 5 === 0 ? 'profile' : 'claim', `Item ${i}`,
      'x'.repeat(i % 5 === 0 ? 3000 : 400), {}, { confidence: (i % 100) / 100 }));

describe('fitToBudget — bisection must pick the same cut as a linear scan', () => {
  it('is byte-identical to the pre-bisection implementation across shapes, limits and pins', () => {
    let checked = 0;
    for (const seed of [1, 7, 42, 999]) {
      let x = seed;
      const rand = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
      const arts: Artefact[] = Array.from({ length: 300 }, (_, i) =>
        artefact(`a_${String(i).padStart(4, '0')}`, (['profile', 'claim', 'passage', 'research_source', 'assumption'] as const)[i % 5],
          `Item ${i}`, 'x'.repeat(Math.floor(rand() * 4000) + 50), {}, { confidence: rand() }));
      for (const limit of [3_000, 15_000, 50_000, 150_000, 400_000]) {
        for (const protect of [new Set<string>(), new Set(['a_0002', 'a_0100'])]) {
          const fast = fitToBudget(arts, build, limit, protect);
          const reference = fitToBudgetReference(arts, build, limit, protect);
          expect(fast.artefacts.map((z) => z.id)).toEqual(reference.artefacts.map((z) => z.id));
          expect(fast.notes).toEqual(reference.notes);
          checked++;
        }
      }
    }
    expect(checked).toBe(40);
  });

  it('never sheds more than it has to — one more item would not have fitted', () => {
    const arts = corpus(300);
    const limit = 60_000;
    const fitted = fitToBudget(arts, build, limit);
    expect(encodedSize(build(fitted.artefacts))).toBeLessThanOrEqual(limit);
  });

  it('returns everything untouched when it already fits', () => {
    const arts = corpus(20);
    const fitted = fitToBudget(arts, build, 10_000_000);
    expect(fitted.artefacts).toBe(arts);
    expect(fitted.notes).toEqual([]);
  });

  it('keeps at least one artefact even when nothing fits', () => {
    const arts = corpus(50);
    expect(fitToBudget(arts, build, 10).artefacts).toHaveLength(1);
  });

  it('names the kinds that left the context entirely', () => {
    const arts = corpus(200);
    const notes = fitToBudget(arts, build, 20_000).notes.join(' ');
    expect(notes).toMatch(/withheld from this call entirely/);
  });

  it('is fast enough not to trip the liveness probe', () => {
    const arts = corpus(2079);
    const t = performance.now();
    fitToBudget(arts, build, 360_000, new Set(['a_0001']));
    const ms = performance.now() - t;
    // It measured 6,407ms before bisection — over the probe's 5,000ms threshold
    // on its own, and the block that had the watchdog restarting the service.
    expect(ms).toBeLessThan(1500);
  });
});
