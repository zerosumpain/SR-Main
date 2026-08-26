import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamRules } from '$lib/db/schema';
import { getSetting } from '$lib/server/models/settings';
import { attributeSpend, budgetStatus, readQuotaMark, ZERO_SPEND } from '$lib/daydream/budget';
import { resolveDaydreamModel } from '$lib/daydream/compose';
import { proposeRules } from '$lib/daydream/rules/propose';
import { admitProposal, refreshRuleOutcomes, retirementCandidates } from '$lib/daydream/rules/store';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-rulesmith';

interface RulesmithConfig {
  /** Proposals per run. Small: each one costs the owner's attention. */
  maxProposals?: number;
  /** Stop proposing once this many are already waiting to be decided. */
  maxPending?: number;
}

const DEFAULTS: Required<RulesmithConfig> = { maxProposals: 2, maxPending: 6 };

/**
 * The model half of the mesh.
 *
 * Daily, it reads what daydreaming has actually done — which kinds fire, which
 * get kept, which get rejected, which never fire at all — and proposes changes
 * to the rule set: a new rule, a tweak to a threshold, or the retirement of one
 * its own record condemns.
 *
 * **Nothing it proposes fires.** A proposal goes through validation (free),
 * then a backtest that refuses anything which would have gone off more than
 * ~14 times a week, and then waits for the owner. The self-improvement engine
 * auto-enables the tools it builds, which is defensible for a tool nobody is
 * interrupted by; a rule that buzzes a phone has to be asked about.
 *
 * It also stops proposing while a queue is already waiting. An assistant that
 * generates suggestions faster than anyone can read them is not being helpful,
 * it is producing a backlog and calling it initiative.
 */
export const daydreamRulesmith: ActivityHandler = {
  name: NAME,
  description:
    'Reviews what daydreaming has noticed and proposes new rules, threshold tweaks, and retirements. Proposals are validated and backtested, then wait for your approval — nothing it writes fires on its own.',
  defaultCadenceSeconds: 86_400,
  defaultEnabled: true,
  defaultActiveHours: { start: '04:00', end: '06:00', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as RulesmithConfig) };
    const now = new Date(ctx.now);

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) return { outcome: 'skipped', summary: 'daydreaming disabled' };

    // Cheap and unconditional: outcomes are DERIVED from the ledger rather than
    // incremented at fire time, so they cannot drift when a run half-fails.
    const refreshed = await refreshRuleOutcomes();
    const condemned = await retirementCandidates();

    const pending = await db
      .select({ id: daydreamRules.id })
      .from(daydreamRules)
      .where(eq(daydreamRules.status, 'proposed'));

    if (pending.length >= cfg.maxPending) {
      return {
        outcome: 'ok',
        summary: `${pending.length} proposals already waiting — not adding more`,
        details: { refreshed, pending: pending.length, condemned: condemned.map((c) => c.kind) },
      };
    }

    const model = await resolveDaydreamModel();
    const isCodexModel = model.provider === 'codex';
    const budget = await budgetStatus({ now, isCodexModel });
    if (budget.blocked) {
      return {
        outcome: 'ok',
        summary: `refreshed ${refreshed} rule outcomes; proposing skipped — ${budget.blockedReason}`,
        details: { refreshed, budget },
      };
    }

    const before = isCodexModel ? await readQuotaMark() : null;
    const batch = await proposeRules(cfg.maxProposals);
    const after = isCodexModel ? await readQuotaMark() : null;
    const quota = isCodexModel ? attributeSpend(before, after) : { ...ZERO_SPEND };

    const outcomes: Array<Record<string, unknown>> = [];
    let admitted = 0;
    let refused = 0;

    for (const proposal of batch.proposals) {
      try {
        let supersedesId: string | null = null;
        if (proposal.supersedesKind) {
          const [existing] = await db
            .select({ id: daydreamRules.id })
            .from(daydreamRules)
            .where(eq(daydreamRules.kind, proposal.supersedesKind))
            .limit(1);
          supersedesId = existing?.id ?? null;
        }
        const result = await admitProposal(proposal.spec, {
          proposalKind: proposal.proposalKind,
          supersedesId,
        });
        if (result.admitted) admitted++;
        else refused++;
        outcomes.push({
          proposalKind: proposal.proposalKind,
          admitted: result.admitted,
          reason: result.reason,
          firesPerWeek: result.backtest?.firesPerWeek ?? null,
          lowerBound: result.backtest?.lowerBound ?? null,
        });
      } catch (err) {
        refused++;
        outcomes.push({ proposalKind: proposal.proposalKind, error: errMsg(err) });
      }
    }

    return {
      outcome: batch.error && admitted === 0 ? 'error' : 'ok',
      summary:
        batch.proposals.length === 0
          ? `nothing worth proposing; refreshed ${refreshed} rule outcomes`
          : `${batch.proposals.length} proposed → ${admitted} awaiting you, ${refused} refused at the gates`,
      details: {
        // Load-bearing: budget.ts reads this back to enforce the caps.
        quota,
        refreshed,
        pending: pending.length,
        condemned: condemned.map((c) => c.kind),
        tokens: batch.tokens,
        proposerError: batch.error,
        outcomes,
      },
    };
  },
};
