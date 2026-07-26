import type { LayoutServerLoad } from './$types';
import { db } from '$lib/db';
import { agentActions, workflows, workflowRuns, workflowSchedules } from '$lib/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { listRunningJobsByConversation } from '$lib/workflows/chat/job-store';
import { getSetting } from '$lib/server/models/settings';

/** Daily LLM spend ceiling the header strip renders against. Overridable from
 *  app_settings so it can be raised without a deploy. */
// NB: not exported. SvelteKit rejects any non-handler export from a
// +layout.server.ts / +server.ts at runtime with a 500, and svelte-check stays
// green while it does.
const DEFAULT_DAILY_BUDGET_USD = 15;
const DAILY_BUDGET_SETTING_KEY = 'jkai.dailyBudgetUsd';

/** The hub header renders on every /jkai page, so this load runs on every
 *  navigation. It is deliberately three cheap aggregates — no filesystem
 *  reads, no Hermes round-trip. Anything per-thread (context use, thread cost)
 *  is client state and arrives via $lib/jkai/hub-bus. */
export const load: LayoutServerLoad = async () => {
  // Auth is handled centrally by hooks.server.ts
  const dayStart = new Date(Date.now() - 86_400_000);

  // "Live" workflows are the ones with an enabled schedule — `workflows` itself
  // carries no enabled flag, the schedule row is what makes one fire.
  const [[today], [workflowCount], [liveCount], [runningWorkflowRuns], budgetSetting] =
    await Promise.all([
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
    ]);

  const budgetUsd =
    typeof budgetSetting === 'number' && budgetSetting > 0 ? budgetSetting : DEFAULT_DAILY_BUDGET_USD;

  return {
    hub: {
      tokensToday: today?.tokens ?? 0,
      spendTodayUsd: today?.spendUsd ?? 0,
      budgetUsd,
      activeRuns: listRunningJobsByConversation().size + (runningWorkflowRuns?.running ?? 0),
      workflowCount: workflowCount?.count ?? 0,
      workflowLiveCount: liveCount?.count ?? 0,
      workflowFailedToday: runningWorkflowRuns?.failed ?? 0,
    },
  };
};
