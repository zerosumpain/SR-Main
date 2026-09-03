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
import { recordRulingMemory, unrememberedRulings } from '$lib/daydream/rulings';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';
import { applyEffort } from '$lib/daydream/effort';
import { loadResolvedEffort } from '$lib/daydream/effort.server';

const NAME = 'daydream-review';

interface ReviewConfig {
  /** Thoughts reviewed per tick. Each is an xhigh reasoning pass with a tool
   *  loop, so this is a real cost ceiling, not a tidiness one. */
  maxPerRun?: number;
  /** Skip if the owner has been busy — the same spare-cycles contract the
   *  composer and the ponderer keep. */
  idleWindowMinutes?: number;
  /** Verdicts already on the ledger with no memory behind them, caught up per
   *  tick. Pure database work — no model, no quota — so this is a politeness
   *  bound rather than a cost one. */
  backfillPerRun?: number;
}

const DEFAULTS: Required<ReviewConfig> = { maxPerRun: 4, idleWindowMinutes: 10, backfillPerRun: 10 };

/**
 * Write the memory for verdicts that were reached before there was a writer.
 *
 * Bounded, silent about the rows it succeeds on, and loud about the ones it
 * cannot: a backfill that swallows its own failures is a backfill that reports
 * a drained backlog it never drained.
 */
async function catchUpMemory(limit: number): Promise<number> {
  if (limit <= 0) return 0;
  let done = 0;
  try {
    const pending = await unrememberedRulings(limit);
    for (const r of pending) {
      try {
        await recordRulingMemory(r.id, r);
        done++;
      } catch (err) {
        console.warn(`[daydream] backfill: could not remember ${r.id}: ${errMsg(err)}`);
      }
    }
  } catch (err) {
    console.warn(`[daydream] backfill: could not read the unremembered rulings: ${errMsg(err)}`);
  }
  return done;
}

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
    const effort = await loadResolvedEffort();
    const cfg = {
      ...DEFAULTS,
      ...(ctx.config as ReviewConfig),
      ...applyEffort(ctx.config as Record<string, unknown>, { maxPerRun: effort.review.maxPerRun, backfillPerRun: effort.review.backfillPerRun }),
    };
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

    // ── Catching up the memory ────────────────────────────────────────────
    //
    // Before the budget gate on purpose. This is a database write over fields
    // a reviewer already returned — no model, no quota — and it is the half of
    // the loop that was missing: production reached 66 verdicts with exactly
    // one memory behind them, so `rulingCards` read nothing and the same Canva
    // misreading was proposed eight times under eight names. A backfill parked
    // behind a quota block would leave that broken for as long as the quota is.
    const backfilled = await catchUpMemory(cfg.backfillPerRun);

    // The reviewer is pinned to Codex, so it spends the same weekly quota as
    // every other daydream model call and answers to the same caps. "Spare
    // budget buys THINKING, never talking" was written for exactly this — the
    // reviewer only ever decides whether to say less.
    const budget = await budgetStatus({ now, isCodexModel: true });
    if (budget.blocked) {
      return {
        outcome: 'skipped',
        summary: `budget: ${budget.blockedReason}${backfilled ? ` · ${backfilled} ruling(s) remembered` : ''}`,
        details: { budget, backfilled },
      };
    }

    let queue;
    try {
      queue = await pendingReview(cfg.maxPerRun);
    } catch (err) {
      return { outcome: 'error', summary: `could not read the queue: ${errMsg(err)}` };
    }
    if (queue.length === 0) {
      return {
        outcome: 'ok',
        summary: `nothing waiting on a verdict${backfilled ? ` · ${backfilled} ruling(s) remembered` : ''}`,
        details: { backfilled },
      };
    }

    const before = await readQuotaMark();
    const counts = { verified: 0, refuted: 0, uncertain: 0, failed: 0 };
    let remembered = 0;
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

      // The verdict stops this message going out. The MEMORY stops the claim
      // being made again — it is a `jkai_memories` row, the ponder pack cards
      // it refutations-first, and `persistCandidates` refuses a candidate built
      // on rows already ruled against. Composed here from fields the reviewer
      // returned rather than by the reviewer itself, which is what keeps
      // `adjudicate.ts` rule 2 true: it decides, and never acts.
      //
      // Soft: a memory that cannot be written must not cost a verdict that was
      // correctly reached. The row is left with `review_memory_id` null, the
      // page marks it "not remembered", and the backfill above retries it.
      try {
        await recordRulingMemory(thought.id, {
          kind: thought.kind,
          title: thought.title,
          verdict: r.verdict,
          likelihood: r.likelihood,
          reasoning: r.reasoning,
          sources: r.sources,
        });
        remembered++;
      } catch (err) {
        console.warn(`[daydream] could not remember the ruling for ${thought.id}: ${errMsg(err)}`);
      }
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
      // The number that says whether the loop closes. A verdict nobody
      // remembered is one the engine will pay to reach again.
      `${remembered + backfilled} remembered`,
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
        remembered,
        backfilled,
        toolCalls,
        likelihoodFlipped: flipped,
        caught,
      },
    };
  },
};
