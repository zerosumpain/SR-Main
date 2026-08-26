import { getSetting } from '$lib/server/models/settings';
import {
  attributeSpend,
  budgetStatus,
  readQuotaMark,
  ZERO_SPEND,
} from '$lib/daydream/budget';
import { resolveDaydreamModel } from '$lib/daydream/compose';
import {
  expireOffers,
  extractOffer,
  findOfferCandidates,
  saveOffer,
  MAX_EXTRACT_PER_RUN,
} from '$lib/daydream/offers';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-offers';

interface OffersConfig {
  /** Emails handed to the model per run. */
  maxPerRun?: number;
}

const DEFAULTS: Required<OffersConfig> = { maxPerRun: MAX_EXTRACT_PER_RUN };

/**
 * Keeps the offer index current, so "you have a voucher for this shop" is a
 * fact rather than a guess.
 *
 * Long cadence on purpose: an offer arrives by email and does not change after
 * that, so there is nothing to gain from checking often, and every run costs
 * subscription quota that the composer would rather have. Six hours is enough
 * that a voucher landing in the morning is indexed before the afternoon.
 *
 * Spends against the SAME caps as the composer — `daydream-offers` is in
 * SPENDING_ACTIONS, so its quota deltas count toward the 10%-a-day and
 * 50%-a-window limits. Without that the caps would enforce half the spend while
 * looking like they enforced all of it.
 */
export const daydreamOffersScan: ActivityHandler = {
  name: NAME,
  description:
    'Extracts vouchers and discounts from bulk email into the offer index. A free subject-line filter picks the shortlist; only the shortlist reaches a model. Spends against the same Codex caps as the composer.',
  defaultCadenceSeconds: 21_600, // 6h
  defaultEnabled: true,
  defaultActiveHours: { start: '07:00', end: '23:00', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as OffersConfig) };
    const now = new Date(ctx.now);

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    // Cheap and unconditional: an expired voucher must never be offerable, and
    // this costs one indexed UPDATE whether or not anything else runs.
    const expired = await expireOffers(now);

    const model = await resolveDaydreamModel();
    const isCodexModel = model.provider === 'codex';
    const budget = await budgetStatus({ now, isCodexModel });

    if (budget.blocked) {
      return {
        outcome: 'ok',
        summary: `expired ${expired}; extraction skipped — ${budget.blockedReason}`,
        details: { expired, budget },
      };
    }

    // The offer scan yields to the composer. Extraction can wait six hours; a
    // thought that is worth saying is worth saying now, so when the budget is
    // tight the scan takes the smaller share.
    const cap = budget.plan.depth === 'deep' ? cfg.maxPerRun : Math.min(4, cfg.maxPerRun);

    const candidates = await findOfferCandidates(cap);
    if (candidates.length === 0) {
      return {
        outcome: 'ok',
        summary: `expired ${expired}; no new bulk email looks like an offer`,
        details: { expired, considered: 0 },
      };
    }

    const before = isCodexModel ? await readQuotaMark() : null;

    let created = 0;
    let updated = 0;
    let notOffers = 0;
    let tokens = 0;
    const errors: string[] = [];

    for (const candidate of candidates) {
      try {
        const { offer, tokens: used, error } = await extractOffer(candidate, now);
        tokens += used;
        if (error) {
          errors.push(`${candidate.noteId.slice(0, 8)}: ${error}`);
          continue;
        }
        if (!offer) {
          // The filter thought it looked like an offer and the model disagreed.
          // That is the filter doing its job cheaply, not a failure.
          notOffers++;
          continue;
        }
        const result = await saveOffer(offer, candidate);
        if (result === 'created') created++;
        else updated++;
      } catch (err) {
        errors.push(`${candidate.noteId.slice(0, 8)}: ${errMsg(err)}`);
      }
    }

    const after = isCodexModel ? await readQuotaMark() : null;
    const quota = isCodexModel ? attributeSpend(before, after) : { ...ZERO_SPEND };

    return {
      outcome: errors.length && created + updated === 0 ? 'error' : 'ok',
      summary:
        `${candidates.length} scanned → +${created} offers, ${updated} refreshed, ` +
        `${notOffers} were not offers; ${expired} expired`,
      details: {
        // Load-bearing: budget.ts reads this key back to enforce the caps.
        quota,
        expired,
        considered: candidates.length,
        created,
        updated,
        notOffers,
        tokens,
        errors,
        topSignals: candidates.slice(0, 5).map((c) => ({
          subject: c.title.slice(0, 80),
          score: c.signal.score,
          matched: c.signal.matched,
        })),
      },
    };
  },
};
