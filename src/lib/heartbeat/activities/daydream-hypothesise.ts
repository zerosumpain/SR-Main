import { getSetting } from '$lib/server/models/settings';
import { proposeHypotheses } from '$lib/daydream/hypotheses/propose';
import { saveProposals } from '$lib/daydream/hypotheses/store';
import { markBatchInfluenced } from '$lib/daydream/hypotheses/steer';
import { testDueHypotheses } from '$lib/daydream/hypotheses/test';
import { SETTINGS_ENABLED_KEY } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-hypothesise';

interface HypothesiseConfig {
  maxProposals?: number;
  windowDays?: number;
}

const DEFAULTS: Required<HypothesiseConfig> = { maxProposals: 4, windowDays: 120 };

/**
 * Ask what is worth investigating, then investigate it.
 *
 * Two halves, in this order and never the other way round. The model proposes
 * questions WITHOUT seeing any results; deterministic code then answers them.
 * Proposing after testing would make the whole thing a sweep laundered through
 * a language model, and would void the false-discovery correction — the
 * q-values would be computed over the handful proposed when the real family was
 * every pair the model implicitly considered.
 *
 * Testing runs whether or not proposing succeeded, because questions already on
 * the board fall due for retesting as the window fills: an underpowered
 * question becomes answerable, and a supported one can stop holding.
 *
 * Nothing here notifies anybody. It fills a board the owner chooses to look at.
 */
export const daydreamHypothesise: ActivityHandler = {
  name: NAME,
  description:
    'Asks the model what is worth investigating about the daily feature store — without showing it any correlations — then answers those questions with deterministic statistics and a false-discovery correction across the batch. Refuted and underpowered are recorded as first-class results. Notifies nobody.',
  defaultCadenceSeconds: 24 * 3600,
  defaultEnabled: true,
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as HypothesiseConfig) };

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    const notes: string[] = [];
    let tokens = 0;

    // ── Propose, blind ──
    const batch = await proposeHypotheses(cfg.maxProposals);
    tokens = batch.tokens;
    if (batch.error) {
      notes.push(`proposer failed: ${batch.error}`);
    } else {
      const saved = await saveProposals(batch.proposals, { tokens: batch.tokens });
      // Count this batch against every steer that shaped it, so a steer that has
      // directed a fortnight of questions and produced nothing is visible.
      await markBatchInfluenced(batch.steerIds);
      notes.push(`${saved.saved} new question${saved.saved === 1 ? '' : 's'}`);
      if (saved.duplicates) notes.push(`${saved.duplicates} already asked`);
      if (batch.rejected.length) notes.push(`${batch.rejected.length} rejected`);
    }

    // ── Test everything due, correcting across the batch ──
    const run = await testDueHypotheses({ windowDays: cfg.windowDays });
    if (run.tested) {
      notes.push(
        `tested ${run.tested} (family ${run.familySize}): ` +
          `${run.supported} held, ${run.refuted} refuted, ` +
          `${run.wrongDirection} backwards, ${run.underpowered} underpowered`,
      );
    }

    const errors = [...(batch.error ? [batch.error] : []), ...run.errors];

    // A proposer that failed AND nothing to test is a dead cycle worth seeing.
    if (batch.error && run.tested === 0) {
      return { outcome: 'error', summary: notes.join('; '), details: { errors, tokens } };
    }

    return {
      outcome: 'ok',
      summary: notes.join('; ') || 'nothing to propose or test',
      details: {
        proposed: batch.proposals.length,
        rejected: batch.rejected,
        tokens,
        ...run,
      },
    };
  },
};
