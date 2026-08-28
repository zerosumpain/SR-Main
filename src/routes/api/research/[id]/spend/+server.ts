/**
 * What this research run has cost, so far.
 *
 * Polled by the dashboard while a run is live. Two different bills:
 *
 *  - **LLM** — read back out of `agent_actions`, the site's durable cost
 *    ledger. Deep research now stamps its session id onto every call it makes
 *    (see `$lib/context/research-meter`), which is what makes this query possible at
 *    all; before that the spend was in the ledger with a null id and could only
 *    be totalled site-wide.
 *  - **Tavily** — counters on the session row, because Tavily issues no
 *    per-request receipt to reconcile against afterwards.
 *
 * `costUsd` sums only the calls that had a price. Codex-served models price as
 * null rather than zero — real quota, no cash — so they are counted separately
 * instead of being quietly averaged into a dollar figure that would understate
 * what was actually used.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { agentActions, researchSessions } from '$lib/db/schema';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { tavilyAccountUsage } from '$lib/deepdive/tavily-usage';

export const GET: RequestHandler = async ({ params, url }) => {
  const [session] = await db
    .select({
      id: researchSessions.id,
      status: researchSessions.status,
      searches: researchSessions.tavilySearches,
      extracts: researchSessions.tavilyExtracts,
      credits: researchSessions.tavilyCredits,
    })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) return json({ error: 'No such research run.' }, { status: 404 });

  const [llm] = await db
    .select({
      calls: sql<number>`count(*)`,
      tokensInput: sql<number>`coalesce(sum(${agentActions.tokensInput}), 0)`,
      tokensOutput: sql<number>`coalesce(sum(${agentActions.tokensOutput}), 0)`,
      costUsd: sql<number>`coalesce(sum(${agentActions.costUsd}), 0)`,
      pricedCalls: sql<number>`count(*) filter (where ${agentActions.costUsd} is not null)`,
    })
    .from(agentActions)
    .where(and(eq(agentActions.sessionId, params.id), eq(agentActions.actionType, 'llm_call')));

  /** The models that did the work, biggest spender first. */
  const byModel = await db
    .select({
      model: agentActions.model,
      calls: sql<number>`count(*)`,
      tokensInput: sql<number>`coalesce(sum(${agentActions.tokensInput}), 0)`,
      tokensOutput: sql<number>`coalesce(sum(${agentActions.tokensOutput}), 0)`,
      costUsd: sql<number>`coalesce(sum(${agentActions.costUsd}), 0)`,
    })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.sessionId, params.id),
        eq(agentActions.actionType, 'llm_call'),
        isNotNull(agentActions.model),
      ),
    )
    .groupBy(agentActions.model)
    .orderBy(sql`coalesce(sum(${agentActions.costUsd}), 0) desc`)
    .limit(8);

  // The account-wide number is a separate request to Tavily, so it is opt-in:
  // the live poll does not need it every five seconds.
  const account = url.searchParams.get('account') === '1' ? await tavilyAccountUsage() : null;

  return json({
    status: session.status,
    llm: {
      calls: Number(llm?.calls ?? 0),
      pricedCalls: Number(llm?.pricedCalls ?? 0),
      tokensInput: Number(llm?.tokensInput ?? 0),
      tokensOutput: Number(llm?.tokensOutput ?? 0),
      costUsd: Number(llm?.costUsd ?? 0),
      byModel: byModel.map((m) => ({
        model: m.model,
        calls: Number(m.calls),
        tokensInput: Number(m.tokensInput),
        tokensOutput: Number(m.tokensOutput),
        costUsd: Number(m.costUsd),
      })),
    },
    tavily: {
      searches: session.searches ?? 0,
      extracts: session.extracts ?? 0,
      credits: session.credits ?? 0,
    },
    account,
  });
};
