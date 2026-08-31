// src/lib/heartbeat/activities/daydream-review.ts
//
// The reviewer, on a short leash.
//
// Every thought on the feed gets checked against the sources before John can be
// interrupted with it — see `$lib/daydream/adjudicate.ts` for what that means
// and why. This file is only the scheduling, the budget and the reporting.
//
// **Cadence is the interesting decision.** Delivery is gated on a verdict, so a
// thought sits silent until this has run: too slow and the engine goes quiet,
// too fast and an xhigh review runs on every scrap the moment it appears. Every
// twenty minutes puts the worst-case wait well inside the 20-hour per-kind
// cooldown and the 4-a-day interruption budget, so the delay is invisible in
// practice and costs nothing.

import { getSetting } from '$lib/server/models/settings';
import { isUserActive } from '$lib/selfimprove/run';
import { listJobs } from '$lib/workflows/chat/job-store';
import { attributeSpend, budgetStatus, readQuotaMark, ZERO_SPEND } from '$lib/daydream/budget';
import {
  pendingReview,
  recordReview,
  reviewThought,
  REVIEW_MODEL_ID,
} from '$lib/daydream/adjudicate';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-review';

interface ReviewConfig {
  /** Thoughts reviewed per tick. Each is an xhigh reasoning pass with a tool
   *  loop, so this is a real cost ceiling, not a tidiness one. */
  maxPerRun?: number;
  /** Skip if the owner has been busy — the same spare-cycles contract the
   *  composer and the ponderer keep. */
  idleWindowMinutes?: number;
}

const DEFAULTS: Required<ReviewConfig> = { maxPerRun: 4, idleWindowMinutes: 10 };

export const daydreamReview: ActivityHandler = {
  name: NAME,
  description:
    'Checks each new thought against the sources before it can interrupt anyone. Reads the mailbox, the spend rows, the diary and the graph, then returns a verdict and a likelihood. Only a verified thought may reach WhatsApp; a refuted one stays on the feed with the reasoning attached and is reported in the Sunday letter.',
  defaultCadenceSeconds: 1_200,
  defaultEnabled: true,
  // Delivery has its own quiet hours; the review itself is silent work and can
  // run through the night, which is when the feed is quietest and the quota
  // cheapest.
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as ReviewConfig) };
    const now = new Date(ctx.now);

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) return { outcome: 'skipped', summary: 'daydreaming disabled' };

    const running = listJobs().filter((j) => j.status === 'running');
    if (running.length > 0) {
      return { outcome: 'skipped', summary: `${running.length} job(s) in flight — not spare` };
    }
    if (await isUserActive(cfg.idleWindowMinutes * 60_000)) {
      return { outcome: 'skipped', summary: 'owner active in the last few minutes' };
    }

    // The reviewer is pinned to Codex, so it spends the same weekly quota as
    // every other daydream model call and answers to the same caps. "Spare
    // budget buys THINKING, never talking" was written for exactly this — the
    // reviewer only ever decides whether to say less.
    const budget = await budgetStatus({ now, isCodexModel: true });
    if (budget.blocked) {
      return { outcome: 'skipped', summary: `budget: ${budget.blockedReason}`, details: { budget } };
    }

    let queue;
    try {
      queue = await pendingReview(cfg.maxPerRun);
    } catch (err) {
      return { outcome: 'error', summary: `could not read the queue: ${errMsg(err)}` };
    }
    if (queue.length === 0) {
      return { outcome: 'ok', summary: 'nothing waiting on a verdict' };
    }

    const before = await readQuotaMark();
    const counts = { verified: 0, refuted: 0, uncertain: 0, failed: 0 };
    let toolCalls = 0;
    let flipped = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    const caught: string[] = [];

    for (const thought of queue) {
      const r = await reviewThought(thought);
      promptTokens += r.tokens.prompt;
      completionTokens += r.tokens.completion;
      toolCalls += r.toolCalls;
      if (r.likelihoodFlipped) flipped++;

      if (r.error) {
        // Deliberately NOT recorded as a verdict. A failed review must leave
        // the thought unreviewed — which keeps it silent, the safe direction —
        // rather than burying a claim nobody actually checked under a
        // `refuted` nothing stands behind.
        counts.failed++;
        console.warn(`[daydream] review failed for ${thought.id}: ${r.error}`);
        continue;
      }

      try {
        await recordReview(thought.id, r);
      } catch (err) {
        counts.failed++;
        console.error(`[daydream] could not record review for ${thought.id}: ${errMsg(err)}`);
        continue;
      }
      counts[r.verdict]++;
      // Name what it caught, not just how many. A refutation is the most
      // interesting thing this activity produces and a bare count buries it.
      if (r.verdict === 'refuted') caught.push(`${thought.title.slice(0, 60)} — ${r.reasoning.slice(0, 90)}`);
    }

    const after = await readQuotaMark();
    const quota = attributeSpend(before, after) ?? { ...ZERO_SPEND };

    const bits = [
      `${queue.length} reviewed`,
      `${counts.verified} verified`,
      `${counts.refuted} refuted`,
      `${counts.uncertain} uncertain`,
      ...(counts.failed ? [`${counts.failed} failed`] : []),
      `${toolCalls} source lookup(s)`,
      // A field quietly coming to mean something other than its name is worth
      // seeing. Every refutation on the first live runs arrived in the nineties.
      ...(flipped ? [`${flipped} likelihood(s) turned round`] : []),
    ];

    return {
      outcome: counts.failed === queue.length ? 'error' : 'ok',
      summary: bits.join(' · ').slice(0, 200),
      promptTokens,
      completionTokens,
      details: {
        // Load-bearing: budget.ts reads this key back to enforce the caps.
        quota,
        model: REVIEW_MODEL_ID,
        ...counts,
        toolCalls,
        likelihoodFlipped: flipped,
        caught,
      },
    };
  },
};
