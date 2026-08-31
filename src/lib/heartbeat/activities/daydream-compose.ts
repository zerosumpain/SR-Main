import { getSetting } from '$lib/server/models/settings';
import { isUserActive } from '$lib/selfimprove/run';
import { listJobs } from '$lib/workflows/chat/job-store';
import {
  attributeSpend,
  budgetStatus,
  readQuotaMark,
  ZERO_SPEND,
} from '$lib/daydream/budget';
import { composeNarrative, resolveDaydreamModel, saveNarrative } from '$lib/daydream/compose';
import { chooseChannel, deliver, hasPushSubscriber, hasWhatsAppOwner, readRateState } from '$lib/daydream/deliver';
import { listUndelivered } from '$lib/daydream/thought-store';
import { loadThreshold } from '$lib/daydream/ledger';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-compose';

interface ComposeConfig {
  /** Skip a run if the owner messaged inside this window. */
  idleWindowMinutes?: number;
}

const DEFAULTS: Required<ComposeConfig> = { idleWindowMinutes: 20 };

/**
 * The talking half. The only part of daydreaming that spends anything.
 *
 * Gated on four things, and it stands down quietly on any of them:
 *
 *   • the kill switch
 *   • an orchestrator job in flight, or the owner mid-conversation — spare
 *     cycles means spare, and composing while they are typing is neither
 *     spare nor welcome
 *   • the Codex budget: at most 10% of the weekly allowance a day and 50% of
 *     the current 5-hour window
 *   • active hours, and then the delivery limits on top
 *
 * Where there is budget headroom it works HARDER, not louder: more candidates
 * considered, a verification pass that drops phrasing the evidence does not
 * support, and phrasing for thoughts that will only ever appear on the page.
 * The delivery limits in deliver.ts are untouched by any of that.
 */
export const daydreamCompose: ActivityHandler = {
  name: NAME,
  description:
    'Phrases the best daydream candidates and decides whether any of them is worth interrupting for. Runs only when the owner is idle and the Codex budget allows: max 10% of the weekly allowance per day, 50% of the 5-hour window. Spare budget buys verification, never more notifications.',
  defaultCadenceSeconds: 900,
  defaultEnabled: true,
  defaultActiveHours: { start: '08:00', end: '21:00', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as ComposeConfig) };
    const now = new Date(ctx.now);

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    // ── Spare cycles ────────────────────────────────────────────────────────
    const running = listJobs().filter((j) => j.status === 'running');
    if (running.length > 0) {
      return { outcome: 'skipped', summary: `${running.length} job(s) in flight — not spare` };
    }
    if (await isUserActive(cfg.idleWindowMinutes * 60_000)) {
      return { outcome: 'skipped', summary: 'owner active in the last few minutes' };
    }

    // ── Anything to say? ────────────────────────────────────────────────────
    const pending = await listUndelivered(5);
    if (pending.length === 0) {
      return { outcome: 'ok', summary: 'nothing above the line to phrase' };
    }

    // ── Budget ──────────────────────────────────────────────────────────────
    const model = await resolveDaydreamModel();
    const isCodexModel = model.provider === 'codex';
    const budget = await budgetStatus({ now, isCodexModel });

    if (budget.blocked) {
      return {
        outcome: 'skipped',
        summary: `budget: ${budget.blockedReason}`,
        details: { budget },
      };
    }

    const before = isCodexModel ? await readQuotaMark() : null;
    const plan = budget.plan;

    const { value: threshold } = await loadThreshold();
    const [rateState, pushable, waOwner] = await Promise.all([readRateState(now), hasPushSubscriber(), hasWhatsAppOwner()]);

    const considered = pending.slice(0, plan.maxCandidates);
    const outcomes: Array<Record<string, unknown>> = [];
    let composed = 0;
    let deliveredCount = 0;
    let dropped = 0;
    // Stays zero while the daydream model is pinned to Codex, which bills
    // nothing and reports no price. That is honest; tokens are the number that
    // actually moves, so they are counted separately rather than folded into a
    // currency figure that would be fiction.
    const costUsd = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    for (const thought of considered) {
      const decision = chooseChannel(
        {
          kind: thought.kind,
          score: thought.score,
          // Load-bearing. Omitting this field makes every reviewed thought look
          // unreviewed at the final gate, so nothing can ever interrupt.
          reviewVerdict: thought.reviewVerdict,
        },
        rateState,
        { now, threshold, hasPushSubscriber: pushable, hasWhatsApp: waOwner },
      );

      // Awaiting review is a queue state, not a delivery outcome. Calling
      // `deliver(..., silent)` here used to rewrite `new` to `suppressed` before
      // the reviewer ran, leaving the two heartbeats to race each other. Leave
      // the row live and let the review activity supply the verdict.
      if (decision.suppressedReason === 'awaiting_review') {
        outcomes.push({
          id: thought.id,
          kind: thought.kind,
          channel: 'silent',
          reason: 'awaiting_review',
        });
        continue;
      }

      // Nothing that is going to stay silent gets phrased unless the budget is
      // deep enough to be worth spending on the page's readability.
      if (decision.channel === 'silent' && !plan.composeSilent) {
        await deliver(thought, decision, now);
        outcomes.push({ id: thought.id, kind: thought.kind, channel: 'silent', reason: decision.suppressedReason });
        continue;
      }

      let narrative: string | null = null;
      // A ponder musing arrives with its narrative already written and
      // citation-audited — re-phrasing it would spend tokens to launder an
      // audited sentence through an unaudited pass. It goes straight to
      // delivery.
      if (thought.narrative) {
        narrative = thought.narrative;
        const sendResult = await deliver(thought, decision, now);
        if (sendResult.sent) {
          deliveredCount++;
          rateState.todayCount++;
          rateState.lastDeliveredAt = now;
          rateState.lastByKind.set(thought.kind, now);
        }
        outcomes.push({
          id: thought.id,
          kind: thought.kind,
          channel: decision.channel,
          sent: sendResult.sent,
          preNarrated: true,
          reason: decision.suppressedReason ?? sendResult.error,
        });
        continue;
      }
      try {
        const result = await composeNarrative(thought, { verify: plan.verify });
        composed++;
        narrative = result.narrative;
        if (!narrative) {
          dropped++;
          outcomes.push({ id: thought.id, kind: thought.kind, dropped: result.droppedReason });
        }
        // The counts the call actually returned. Previously `costUsd` — an
        // accumulator declared at zero and never assigned — was passed here and
        // written to every row, so the ledger reported 0.000000 for work that
        // had definitely happened, and the returned token counts were dropped
        // on the floor. A meter that always reads zero is worse than no meter:
        // it looks like evidence.
        promptTokens += result.tokens.prompt;
        completionTokens += result.tokens.completion;
        await saveNarrative(thought.id, result, costUsd);
      } catch (err) {
        outcomes.push({ id: thought.id, kind: thought.kind, error: errMsg(err) });
      }

      const sendResult = await deliver({ ...thought, narrative }, decision, now);
      if (sendResult.sent) {
        deliveredCount++;
        // Keep the local rate state honest within this run — otherwise two
        // candidates in one tick could both pass the min-gap check.
        rateState.todayCount++;
        rateState.lastDeliveredAt = now;
        rateState.lastByKind.set(thought.kind, now);
      }
      outcomes.push({
        id: thought.id,
        kind: thought.kind,
        channel: decision.channel,
        sent: sendResult.sent,
        reason: decision.suppressedReason ?? sendResult.error,
      });
    }

    const after = isCodexModel ? await readQuotaMark() : null;
    const quota = isCodexModel ? attributeSpend(before, after) : { ...ZERO_SPEND };

    return {
      outcome: 'ok',
      summary:
        `${plan.depth}: ${composed} phrased, ${deliveredCount} delivered, ${dropped} dropped` +
        (isCodexModel ? ` · quota +${quota.weeklyPct}% wk` : ''),
      costUsd,
      promptTokens,
      completionTokens,
      details: {
        // `quota` is read back by budget.ts to enforce the caps — the key name
        // and shape are load-bearing, not cosmetic.
        quota,
        depth: plan.depth,
        threshold,
        model: model.modelId,
        budget: {
          spentTodayWeeklyPct: budget.spentTodayWeeklyPct,
          spentThisWindowPct: budget.spentThisWindowPct,
          pacedTargetPct: budget.pacedTargetPct,
          remainingTodayPct: budget.remainingTodayPct,
          reachable: budget.reachable,
          applies: budget.applies,
        },
        considered: considered.length,
        outcomes,
      },
    };
  },
};
