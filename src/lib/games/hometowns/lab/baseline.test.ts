// Baselines and paired A/B (WP5 acceptance: "the baseline regression check
// fails a deliberately broken parameter"; spec §11.3–§11.5). A variant runs
// in its own worker thread, so the check also proves the pool gives the
// same county as this thread does.

import { describe, expect, it } from 'vitest';
import { makeBaseline, regressions } from '../../../../../scripts/hometowns/lab/baseline';
import { abCompare, runLab } from '../../../../../scripts/hometowns/lab/runner';

const SMALL = { profile: 'smoke' as const, seeds: 1, days: 1, seats: 2, timingSeeds: 0 };

describe('baselines', () => {
  it('a run matches its own baseline, and a broken parameter regresses it', { timeout: 120_000 }, async () => {
    const here = await runLab({ ...SMALL, workers: 0, baseline: null });
    const base = makeBaseline(here.scorecard, null);
    expect(base.metrics['balanced.finalPop'].value).toBeGreaterThan(0);
    expect(base.spectralThreshold).toBeGreaterThan(0);

    // The same seeds on the worker pool: the same counties, so no regression.
    const pooled = await runLab({ ...SMALL, workers: 2, baseline: base });
    expect(pooled.data.mixed.map((r) => r.hash)).toEqual(here.data.mixed.map((r) => r.hash));
    expect(pooled.scorecard.regressions).toEqual([]);

    // Growth chances cut to a tenth: towns barely grow, and the check says so.
    const broken = { label: 'broken-growth', overrides: { 'develop.pGrow': { mul: 0.1 }, 'develop.pLevel': { mul: 0.1 } } };
    const bad = await runLab({ ...SMALL, workers: 2, baseline: base, variant: broken });
    expect(bad.scorecard.paramsHash).not.toBe(here.scorecard.paramsHash);
    expect(bad.scorecard.regressions!.length).toBeGreaterThan(0);
    expect(bad.scorecard.regressions!.some((r) => r.startsWith('balanced.finalPop'))).toBe(true);
    expect(regressions(bad.scorecard, base)).toEqual(bad.scorecard.regressions);

    // The paired A/B on the same seeds shows the loss with an interval that excludes zero.
    const ab = abCompare(here.data, bad.data, broken, here.scorecard.gates, bad.scorecard.gates);
    expect(ab.pairs).toBe(2);
    const pop = ab.metrics.find((m) => m.name === 'final population')!;
    expect(pop.diff.est).toBeLessThan(0);
    expect(pop.variant).toBeLessThan(pop.base);
  });
});
