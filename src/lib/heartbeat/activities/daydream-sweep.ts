import { getSetting } from '$lib/server/models/settings';
import { describeSweep, runSweep } from '$lib/daydream/stats/sweep';
import { DEFAULT_FDR } from '$lib/daydream/stats/tests';
import { FAMILY_SUBJECTS, SETTINGS_ENABLED_KEY } from '$lib/daydream/types';
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
 *
 * Runs PER SUBJECT (owner's call, 2026-08-28). Four of the five people in the
 * trail have had a feature store since the family backfill and nothing had
 * ever correlated over it, so "Family" was a presence map and never a set of
 * findings. Each subject is swept independently against its own days plus the
 * household signals — the correction is applied WITHIN a subject, never across
 * the pooled set, because a false-discovery rate over five people's tests at
 * once controls a quantity nobody asked about.
 */
export const daydreamSweep: ActivityHandler = {
  name: NAME,
  description:
    'Correlates every eligible pair of daily features for EACH person in the trail, same-day and one-day-lagged, applying a Benjamini-Hochberg false-discovery correction within each subject. Reports the uncorrected count alongside the corrected one. Finding nothing is a normal result. No LLM.',
  defaultCadenceSeconds: 24 * 3600,
  defaultEnabled: true,
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as SweepConfig) };

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    const perSubject: Record<string, unknown> = {};
    const lines: string[] = [];
    let anyTests = 0;
    let anyFindings = 0;

    for (const { subject } of FAMILY_SUBJECTS) {
      // One subject failing must not lose the four that answered — the same
      // rule the calendar reader follows for a multi-calendar read.
      let res;
      try {
        res = await runSweep({ windowDays: cfg.windowDays, fdr: cfg.fdr, subject });
      } catch (err) {
        perSubject[subject] = { error: err instanceof Error ? err.message : String(err) };
        lines.push(`${subject}: failed`);
        continue;
      }

      anyTests += res.testsRun;
      anyFindings += res.findings.length;
      perSubject[subject] = {
        windowDays: res.windowDays,
        from: res.from,
        to: res.to,
        testsRun: res.testsRun,
        fdr: res.fdr,
        naiveHits: res.naiveHits,
        // The findings themselves, each carrying its own q and pair count so
        // nothing downstream can quote a number without its uncertainty.
        findings: res.findings,
        errors: res.errors,
      };

      // Not enough history is not a fault. It is the honest state of a young
      // ledger, and saying so beats an error every night for a fortnight —
      // which matters more now that four of the five subjects are younger than
      // the first.
      lines.push(
        res.errors.length && res.testsRun === 0
          ? `${subject}: ${res.errors[0]}`
          : `${subject}: ${describeSweep(res)}`,
      );
    }

    // Every subject too young to test is a skip, not an error.
    if (anyTests === 0) {
      return {
        outcome: 'skipped',
        summary: lines.join(' · ') || 'no subjects to sweep',
        details: { perSubject },
      };
    }

    return {
      outcome: 'ok',
      summary: `${anyTests} tests over ${FAMILY_SUBJECTS.length} people, ${anyFindings} survived · ${lines.join(' · ')}`,
      details: { perSubject, testsRun: anyTests, findings: anyFindings },
    };
  },
};
