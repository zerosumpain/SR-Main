import type { LayoutServerLoad } from './$types';
import { db } from '$lib/db';
import { spendToday, DAY_START } from '$lib/costs/ledger.server';
import { activityConnections, agentActions, workflows, workflowRuns, workflowSchedules } from '$lib/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { runningJobsByConversation } from '$lib/workflows/chat/activity';
import { getSetting, resolveDefaultModel } from '$lib/server/models/settings';
import { getOpenRouterCredits } from '$lib/server/models/openrouter-credits';
import { getCodexUsage } from '$lib/server/models/codex-usage';
import { getDeployVersion } from '$lib/server/deploy-version';
import { isMemberRequest } from '$lib/server/viewer';

/** What the header shows a member: nothing. Spend, credit, the Codex quota and
 *  the workflow counts are the owner's operational data, not theirs. */
const MEMBER_HUB = {
  tokensToday: 0,
  spendTodayUsd: 0,
  budgetUsd: 0,
  credit: null,
  codex: null,
  defaultModelId: '',
  activeRuns: 0,
  workflowCount: 0,
  workflowLiveCount: 0,
  workflowFailedToday: 0,
  activitySourceCount: 0,
};

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
export const load: LayoutServerLoad = async (event) => {
  // Auth is handled centrally by hooks.server.ts. A member reaches /jkai only
  // for their intel space (isMemberAllowedRoute), and this load runs under it.
  if (await isMemberRequest(event)) {
    return { deploy: getDeployVersion(), member: true as const, hub: MEMBER_HUB };
  }
  // Midnight in the database's timezone, the same boundary the spend ledger
  // uses — this was a rolling 24 hours while everything beside it in the header
  // said "today", so two figures under one word measured different windows.
  const dayStart = DAY_START;

  // "Live" workflows are the ones with an enabled schedule — `workflows` itself
  // carries no enabled flag, the schedule row is what makes one fire.
  const [
    [today],
    [workflowCount],
    [liveCount],
    [runningWorkflowRuns],
    [failedWorkflowRunsToday],
    [activeSources],
    budgetSetting,
    credits,
    codex,
    defaultModel,
  ] = await Promise.all([
      // One ledger, one midnight. This was a ROLLING 24 HOURS while the two
      // /admin surfaces used a day boundary, so the hub's "today" could differ
      // from the console's by most of a day's spend and neither said why.
      spendToday().then((s) => [{ tokens: s.tokensIn + s.tokensOut, spendUsd: s.costUsd }]),
      db.select({ count: sql<number>`count(*)::int` }).from(workflows),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(workflowSchedules)
        .where(eq(workflowSchedules.enabled, true)),
      // Two WHERE-d counts, not one `count(*) FILTER (...)` over the whole
      // table. The filtered form has no WHERE clause, so no index can help it:
      // it read all 44k runs on EVERY /jkai navigation (20ms, 1,095 buffers) and
      // grew with every run the engine ever made. Split like this both counts
      // are index-only scans against `workflow_runs_status_idx` — 3 buffers and
      // 0.2ms for the pair.
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(workflowRuns)
        .where(eq(workflowRuns.status, 'running')),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(workflowRuns)
        .where(and(eq(workflowRuns.status, 'failed'), gte(workflowRuns.startedAt, dayStart))),
      // Personal activity sources that have connected. The menu row for
      // Sources carries this so the nudge to connect one is a number, not a
      // word; the table is tiny and `activity_connections_next_sync_idx`
      // (status, next_sync_at) serves a status-only count.
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(activityConnections)
        .where(eq(activityConnections.status, 'active')),
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
    deploy: getDeployVersion(),
    member: false as const,
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
      activeRuns: (await runningJobsByConversation()).size + (runningWorkflowRuns?.count ?? 0),
      workflowCount: workflowCount?.count ?? 0,
      workflowLiveCount: liveCount?.count ?? 0,
      workflowFailedToday: failedWorkflowRunsToday?.count ?? 0,
      activitySourceCount: activeSources?.count ?? 0,
    },
  };
};
