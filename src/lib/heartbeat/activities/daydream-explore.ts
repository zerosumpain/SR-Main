import { getSetting } from '$lib/server/models/settings';
import { isUserActive } from '$lib/selfimprove/run';
import {
  MAX_LEADS_PER_RUN,
  runExplorationRound,
  settleRounds,
} from '$lib/daydream/leads/run';
import { SETTINGS_ENABLED_KEY } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';
import { applyEffort } from '$lib/daydream/effort';
import { loadResolvedEffort } from '$lib/daydream/effort.server';

const NAME = 'daydream-explore';

interface ExploreConfig {
  /** Idle window before a round is allowed to start. */
  idleWindowMinutes?: number;
  maxLeads?: number;
}

const DEFAULTS: Required<ExploreConfig> = { idleWindowMinutes: 20, maxLeads: MAX_LEADS_PER_RUN };

/**
 * Advance the frontier of open questions during quiet periods.
 *
 * "Constant model-backed decision making during less active periods" is the
 * ask; the danger in it is a loop with no floor. This repository has run away
 * before — four heartbeat watchers, one to 43,115 ticks — so every bound is in
 * code rather than in a prompt: at most three leads a run, a hard lifetime cap
 * per lead, and a written trace of every step with its token cost.
 *
 * Two phases in one activity, in this order. `settleRounds` first, because it
 * scores the PREVIOUS round against verdicts that have since arrived — counting
 * a round barren before its questions were answered would retire every lead in
 * a fortnight. Then a fresh round advances the top of the frontier.
 *
 * Notifies nobody. It fills a board and a trace.
 */
export const daydreamExplore: ActivityHandler = {
  name: NAME,
  description:
    'Advances the frontier of open lines of enquiry while the owner is idle. At most three leads a run, a hard lifetime cap per lead, and every step written to a reviewable trace with its token cost. Pruning is arithmetic over a lead\'s own results — no second model call. Notifies nobody.',
  defaultCadenceSeconds: 3600,
  defaultEnabled: true,
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const effort = await loadResolvedEffort();
    const cfg = { ...DEFAULTS, ...(ctx.config as ExploreConfig), ...applyEffort(ctx.config as Record<string, unknown>, { maxLeads: effort.explore.maxLeads }) };

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    // "Less active periods", using the same idle check the composer already
    // uses, so the two surfaces cannot disagree about what quiet means.
    if (await isUserActive(cfg.idleWindowMinutes * 60_000)) {
      return { outcome: 'skipped', summary: 'owner is active' };
    }

    // Score the previous round against verdicts that have since landed.
    const settled = await settleRounds();

    const round = await runExplorationRound({ maxLeads: cfg.maxLeads });

    const bits: string[] = [];
    if (settled) bits.push(`settled ${settled}`);
    bits.push(`${round.leadsAdvanced}/${round.leadsConsidered} advanced`);
    if (round.leadsAbandoned) bits.push(`${round.leadsAbandoned} abandoned`);
    if (round.leadsRetired) bits.push(`${round.leadsRetired} hit the lifetime cap`);
    if (round.errors.length) bits.push(`${round.errors.length} errors`);

    if (round.leadsConsidered === 0) {
      return { outcome: 'ok', summary: 'no open lines of enquiry' };
    }

    return {
      outcome: round.errors.length && round.leadsAdvanced === 0 ? 'error' : 'ok',
      summary: bits.join('; '),
      details: { settled, ...round },
    };
  },
};
