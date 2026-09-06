import { getSetting } from '$lib/server/models/settings';
import {
  attributeSpend,
  budgetStatus,
  readQuotaMark,
  ZERO_SPEND,
} from '$lib/daydream/budget';
import { resolveDaydreamModel } from '$lib/daydream/compose';
import { proposeHypotheses } from '$lib/daydream/hypotheses/propose';
import { saveProposals } from '$lib/daydream/hypotheses/store';
import { markBatchInfluenced } from '$lib/daydream/hypotheses/steer';
import { testDueHypotheses } from '$lib/daydream/hypotheses/test';
import { FAMILY_SUBJECTS, SETTINGS_ENABLED_KEY } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';
import { applyEffort } from '$lib/daydream/effort';
import { loadResolvedEffort } from '$lib/daydream/effort.server';

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
 *
 * ── Per person (owner's call, 2026-08-28) ─────────────────────────────────
 *
 * Every subject in the trail gets its own questions, its own tests and its own
 * false-discovery correction. Until now this ran for John alone, so the other
 * four had a feature store, a year of position history and no questions ever
 * asked about them.
 *
 * The budget is re-read BEFORE EACH SUBJECT, not once at the top. Proposing is
 * the only half that spends, and five proposals is five model calls; checking
 * the caps once would let a whole cycle commit before the first one had been
 * accounted for. Subjects are proposed for in order until the caps bite, and
 * the ones that missed out are NAMED in the pulse — a silent truncation reads
 * as "everyone was considered" when four people were not. Testing is
 * deterministic and free, so it always runs for everybody regardless.
 */
export const daydreamHypothesise: ActivityHandler = {
  name: NAME,
  description:
    'For each person in the trail, asks the model what is worth investigating about their daily feature store — without showing it any correlations — then answers those questions with deterministic statistics and a false-discovery correction within that subject. The Codex caps are re-checked before each person, and anyone the budget stopped is named. Refuted and underpowered are recorded as first-class results. Notifies nobody.',
  defaultCadenceSeconds: 24 * 3600,
  defaultEnabled: true,
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    // The effort dial fills in what the row does not say explicitly.
    const effort = await loadResolvedEffort();
    const cfg = {
      ...DEFAULTS,
      ...(ctx.config as HypothesiseConfig),
      ...applyEffort(ctx.config as Record<string, unknown>, { maxProposals: effort.hypothesise.maxProposals }),
    };

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    const notes: string[] = [];
    const perSubject: Record<string, unknown> = {};
    const errors: string[] = [];
    const budgetSkipped: string[] = [];
    let tokens = 0;
    let proposed = 0;
    let tested = 0;
    let rejected: unknown[] = [];
    // Load-bearing key: budget.ts reads `details.quota` back to enforce the
    // caps, so the deltas across every subject are ACCUMULATED into one figure
    // rather than reported per person and lost.
    let quota = { ...ZERO_SPEND };

    // Proposing calls a model, so it spends against the same Codex caps as the
    // composer — daydream-hypothesise is in SPENDING_ACTIONS. Testing is
    // deterministic and free, so a blocked budget skips the proposal half
    // only: questions already on the board still fall due and get answered.
    const model = await resolveDaydreamModel();
    const isCodexModel = model.provider === 'codex';

    for (const { subject } of FAMILY_SUBJECTS) {
      const line: string[] = [];
      let proposeError: string | null = null;

      // Re-read the caps for EVERY subject. One check at the top would let all
      // five commit before the first was accounted for.
      const budget = await budgetStatus({ now: new Date(ctx.now), isCodexModel });
      if (budget.blocked) {
        budgetSkipped.push(subject);
        line.push(`proposing skipped — ${budget.blockedReason}`);
      } else {
        const before = isCodexModel ? await readQuotaMark() : null;
        const batch = await proposeHypotheses(cfg.maxProposals, subject);
        const after = isCodexModel ? await readQuotaMark() : null;
        if (isCodexModel) {
          const delta = attributeSpend(before, after);
          quota = {
            weeklyPct: quota.weeklyPct + delta.weeklyPct,
            fiveHourPct: quota.fiveHourPct + delta.fiveHourPct,
          };
        }

        tokens += batch.tokens;
        proposed += batch.proposals.length;
        rejected = [...rejected, ...batch.rejected];
        proposeError = batch.error ?? null;
        if (batch.error) {
          line.push(`proposer failed: ${batch.error}`);
          errors.push(`${subject}: ${batch.error}`);
        } else {
          const saved = await saveProposals(batch.proposals, {
            tokens: batch.tokens,
            subject,
          });
          // Count this batch against every steer that shaped it, so a steer
          // that has directed a fortnight of questions and produced nothing is
          // visible.
          await markBatchInfluenced([]);
          line.push(`${saved.saved} new`);
          if (saved.duplicates) line.push(`${saved.duplicates} already asked`);
          if (batch.rejected.length) line.push(`${batch.rejected.length} rejected`);
        }
      }

      // ── Test everything due for this subject, corrected within it ──
      const run = await testDueHypotheses({ windowDays: cfg.windowDays, subject });
      tested += run.tested;
      errors.push(...run.errors.map((e) => `${subject}: ${e}`));
      if (run.tested) {
        line.push(
          `tested ${run.tested} (family ${run.familySize}): ` +
            `${run.supported} held, ${run.inconclusive} inconclusive, ` +
            `${run.wrongDirection} backwards, ${run.underpowered} underpowered`,
        );
      }

      perSubject[subject] = { proposeError, ...run };
      if (line.length) notes.push(`${subject}: ${line.join(', ')}`);
    }

    // Naming who missed out, rather than truncating in silence.
    if (budgetSkipped.length) {
      notes.push(`budget stopped proposing for: ${budgetSkipped.join(', ')}`);
    }

    // Every subject failed to propose AND nothing anywhere was testable: a
    // dead cycle, and worth a red pulse.
    if (errors.length >= FAMILY_SUBJECTS.length && tested === 0 && proposed === 0) {
      return { outcome: 'error', summary: notes.join(' · '), details: { errors, tokens, quota, perSubject } };
    }

    return {
      outcome: 'ok',
      summary: notes.join(' · ') || 'nothing to propose or test',
      details: {
        // Load-bearing: budget.ts reads this key back to enforce the caps.
        quota,
        proposed,
        tested,
        rejected,
        tokens,
        budgetSkipped,
        errors,
        perSubject,
      },
    };
  },
};
