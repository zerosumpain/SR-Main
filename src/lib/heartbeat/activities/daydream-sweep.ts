import { getSetting } from '$lib/server/models/settings';
import { describeSweep, runSweep } from '$lib/daydream/stats/sweep';
import { DEFAULT_FDR } from '$lib/daydream/stats/tests';
import { SETTINGS_ENABLED_KEY } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-sweep';

interface SweepConfig {
  windowDays?: number;
  /** Expected proportion of reported findings that are noise. */
  fdr?: number;
}

const DEFAULTS: Required<SweepConfig> = { windowDays: 120, fdr: DEFAULT_FDR };

/**
 * Test every eligible pair in the feature store and record what survived.
 *
 * Deliberately produces no notification and no thought. It writes a pulse: how
 * many tests were run, how many an uncorrected sweep would have called
 * significant, and how many actually cleared the false-discovery correction.
 * Those three numbers together are the honest summary, and reporting the middle
 * one is the point — it makes the correction's effect visible instead of
 * asserted.
 *
 * Zero findings is a normal, correct result and is reported as `ok`. A sweep
 * that always finds something is a sweep that is not controlling anything.
 *
 * No LLM. Nothing here decides what is interesting; it decides what is real.
 */
export const daydreamSweep: ActivityHandler = {
  name: NAME,
  description:
    'Correlates every eligible pair of daily features, same-day and one-day-lagged, and applies a Benjamini-Hochberg false-discovery correction across the whole sweep. Reports the uncorrected count alongside the corrected one. Finding nothing is a normal result. No LLM.',
  defaultCadenceSeconds: 24 * 3600,
  defaultEnabled: true,
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as SweepConfig) };

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    const res = await runSweep({ windowDays: cfg.windowDays, fdr: cfg.fdr });

    // Not enough history is not a fault. It is the honest state of a young
    // ledger, and saying so beats reporting an error every night for a fortnight.
    if (res.errors.length && res.testsRun === 0) {
      return { outcome: 'skipped', summary: res.errors[0], details: { ...res } };
    }

    return {
      outcome: 'ok',
      summary: describeSweep(res),
      details: {
        windowDays: res.windowDays,
        from: res.from,
        to: res.to,
        testsRun: res.testsRun,
        fdr: res.fdr,
        naiveHits: res.naiveHits,
        // The findings themselves, each carrying its own q and pair count so
        // nothing downstream can quote a number without its uncertainty.
        findings: res.findings,
      },
    };
  },
};
