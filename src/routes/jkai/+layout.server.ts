import type { LayoutServerLoad } from './$types';
import { db } from '$lib/db';
import { agentActions, workflows, workflowRuns, workflowSchedules } from '$lib/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { listRunningJobsByConversation } from '$lib/workflows/chat/job-store';
import { getSetting, resolveDefaultModel } from '$lib/server/models/settings';
import { getOpenRouterCredits } from '$lib/server/models/openrouter-credits';
import { getCodexUsage } from '$lib/server/models/codex-usage';

/** Fallback spend ceiling, used ONLY when OpenRouter can't tell us the real
 *  credit balance. Overridable from app_settings so it can be raised without a
 *  deploy. */
// NB: not exported. SvelteKit rejects any non-handler export from a
// +layout.server.ts / +server.ts at runtime with a 500, and svelte-check stays
// green while it does.
const DEFAULT_DAILY_BUDGET_USD = 15;
const DAILY_BUDGET_SETTING_KEY = 'jkai.dailyBudgetUsd';

/** The hub header renders on every /jkai page, so this load runs on every
 *  navigation. It is deliberately three cheap aggregates — no filesystem
 *  reads, no cross-host round-trip. Anything per-thread (context use, thread cost)
 *  is client state and arrives via $lib/jkai/hub-bus. */
export const load: LayoutServerLoad = async () => {
  // Auth is handled centrally by hooks.server.ts
  const dayStart = new Date(Date.now() - 86_400_000);

  // "Live" workflows are the ones with an enabled schedule — `workflows` itself
  // carries no enabled flag, the schedule row is what makes one fire.
  const [
    [today],
    [workflowCount],
    [liveCount],
    [runningWorkflowRuns],
    budgetSetting,
    credits,
    codex,
    defaultModel,
  ] = await Promise.all([
      db
        .select({
          tokens: sql<number>`COALESCE(SUM(COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0)), 0)::int`,
          spendUsd: sql<number>`COALESCE(SUM(cost_usd), 0)::double precision`,
        })
        .from(agentActions)
        .where(and(eq(agentActions.actionType, 'llm_call'), gte(agentActions.createdAt, dayStart))),
      db.select({ count: sql<number>`count(*)::int` }).from(workflows),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(workflowSchedules)
        .where(eq(workflowSchedules.enabled, true)),
      db
        .select({
          running: sql<number>`count(*) FILTER (WHERE ${workflowRuns.status} = 'running')::int`,
          failed: sql<number>`count(*) FILTER (WHERE ${workflowRuns.status} = 'failed' AND ${workflowRuns.startedAt} >= ${dayStart})::int`,
        })
        .from(workflowRuns),
      getSetting<number>(DAILY_BUDGET_SETTING_KEY),
      // Cached in-process for a minute, so this does not become an OpenRouter
      // round-trip on every hub navigation.
      getOpenRouterCredits(),
      // Same caching. Fetched unconditionally rather than behind the Codex
      // enable flag, so the meter is already warm the moment a thread is pinned
      // to a `codex/` model; it resolves to null on a host with no Codex login.
      getCodexUsage(),
      // Which meter to show follows the model that will actually answer. On the
      // chat page that is the thread's own pin, published live to the hub bus;
      // everywhere else in the hub it is the site default — which is allowed to
      // be a Codex model, so the header must be able to say so.
      resolveDefaultModel(),
    ]);

  // The ceiling the strip renders against is the REAL OpenRouter balance when we
  // have it — that is the number "of total credit" was always meant to be. The
  // app_settings figure is only a fallback for when the account can't be read
  // (no key configured, OpenRouter down), so the strip degrades to a static
  // budget rather than to nothing.
  const budgetUsd =
    credits?.remainingUsd ??
    (typeof budgetSetting === 'number' && budgetSetting > 0
      ? budgetSetting
      : DEFAULT_DAILY_BUDGET_USD);

  return {
    hub: {
      tokensToday: today?.tokens ?? 0,
      spendTodayUsd: today?.spendUsd ?? 0,
      budgetUsd,
      /** Live OpenRouter credit position, or null when it couldn't be read.
       *  Non-null is what lets the strip label the figure "credit" and offer the
       *  purchased/used breakdown on hover. */
      credit: credits
        ? {
            remainingUsd: credits.remainingUsd,
            totalUsd: credits.totalUsd,
            usedUsd: credits.usedUsd,
            fetchedAt: credits.fetchedAt,
          }
        : null,
      /** ChatGPT subscription position, or null when this host has no Codex
       *  login. Shown INSTEAD of `credit` while a `codex/` model is answering —
       *  the two are not commensurable and only one of them is being spent. */
      codex,
      /** The model that answers when a thread hasn't pinned one. */
      defaultModelId: defaultModel.modelId,
      activeRuns: listRunningJobsByConversation().size + (runningWorkflowRuns?.running ?? 0),
      workflowCount: workflowCount?.count ?? 0,
      workflowLiveCount: liveCount?.count ?? 0,
      workflowFailedToday: runningWorkflowRuns?.failed ?? 0,
    },
  };
};
