import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { agentActions } from '$lib/db/schema';
import { validateAgentKey, unauthorized } from '$lib/agent/auth';
import { sql, gte, and, eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url, request }) => {
  if (!validateAgentKey(request)) return unauthorized();

  const period = url.searchParams.get('period') ?? 'day'; // day | week | month

  const now = new Date();
  let since: Date;
  if (period === 'week') {
    since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === 'month') {
    since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    // Today
    since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  // Total cost and tokens
  const [totals] = await db
    .select({
      totalCostUsd: sql<number>`coalesce(sum(${agentActions.costUsd}), 0)`,
      totalTokensInput: sql<number>`coalesce(sum(${agentActions.tokensInput}), 0)`,
      totalTokensOutput: sql<number>`coalesce(sum(${agentActions.tokensOutput}), 0)`,
      actionCount: sql<number>`count(*)`,
    })
    .from(agentActions)
    .where(gte(agentActions.createdAt, since));

  // Breakdown by model
  const byModel = await db
    .select({
      model: agentActions.model,
      provider: agentActions.provider,
      costUsd: sql<number>`coalesce(sum(${agentActions.costUsd}), 0)`,
      tokensInput: sql<number>`coalesce(sum(${agentActions.tokensInput}), 0)`,
      tokensOutput: sql<number>`coalesce(sum(${agentActions.tokensOutput}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(agentActions)
    .where(and(gte(agentActions.createdAt, since), eq(agentActions.actionType, 'llm_call')))
    .groupBy(agentActions.model, agentActions.provider);

  // Breakdown by tool
  const byTool = await db
    .select({
      toolName: agentActions.toolName,
      count: sql<number>`count(*)`,
      avgDurationMs: sql<number>`coalesce(avg(${agentActions.durationMs}), 0)`,
    })
    .from(agentActions)
    .where(and(gte(agentActions.createdAt, since), eq(agentActions.actionType, 'tool_call')))
    .groupBy(agentActions.toolName);

  return Response.json({
    period,
    since: since.toISOString(),
    totals,
    byModel,
    byTool,
  });
};
