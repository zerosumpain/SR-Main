import { getSetting } from '$lib/server/models/settings';
import {
  attributeSpend,
  budgetStatus,
  readQuotaMark,
  ZERO_SPEND,
} from '$lib/daydream/budget';
import { resolveDaydreamModel } from '$lib/daydream/compose';
import { runMemoryConsolidation } from '$lib/daydream/memory-consolidation.server';
import { SETTINGS_ENABLED_KEY } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-memory';

/**
 * The end-of-day turn from episodes into principles.
 *
 * The cadence is deliberately shorter than a day but the active window is
 * narrow and the run has a unique local-day key. That gives a blocked or
 * failed 22:30 attempt one retry at 23:00 without allowing two successful
 * consolidations, and avoids the once-a-day scheduler trap where one skip
 * loses the whole night.
 */
export const daydreamMemory: ActivityHandler = {
  name: NAME,
  description:
    'At the end of each day, reviews new raw memories and distils them into sourced lessons and values. Future ponder passes read those themes, and thoughts retain the theme id they cited so the feed can show the influence.',
  defaultCadenceSeconds: 30 * 60,
  defaultEnabled: true,
  defaultActiveHours: { start: '22:30', end: '23:30', tz: 'Europe/London' },

  async run(ctx) {
    const now = new Date(ctx.now);
    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) return { outcome: 'skipped', summary: 'daydreaming disabled' };

    const model = await resolveDaydreamModel();
    const isCodexModel = model.provider === 'codex';
    const budget = await budgetStatus({ now, isCodexModel });
    if (budget.blocked) {
      return { outcome: 'skipped', summary: `budget: ${budget.blockedReason}`, details: { budget } };
    }

    const before = isCodexModel ? await readQuotaMark() : null;
    const result = await runMemoryConsolidation({ now });
    const after = isCodexModel ? await readQuotaMark() : null;
    const quota = isCodexModel ? attributeSpend(before, after) : { ...ZERO_SPEND };

    if (result.status === 'failed') {
      return {
        outcome: 'error',
        summary: `memory consolidation failed: ${result.error}`.slice(0, 200),
        details: { quota, ...result },
      };
    }
    if (result.status === 'already_running') {
      return { outcome: 'skipped', summary: `memory consolidation already running for ${result.localDay}` };
    }
    if (result.status === 'already_complete') {
      return { outcome: 'skipped', summary: `memory already consolidated for ${result.localDay}` };
    }

    return {
      outcome: 'ok',
      summary:
        result.memoriesReviewed === 0
          ? 'no new memories to consolidate'
          : `${result.memoriesReviewed} memories → ${result.themesCreated} new + ${result.themesUpdated} updated themes · ${result.memoriesLinked} source links`,
      details: { quota, ...result },
    };
  },
};
