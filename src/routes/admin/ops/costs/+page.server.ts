import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { agentActions } from '$lib/db/schema';
import { sql, gte, eq, and } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [todayTotals, weekTotals, monthTotals, byModel, byTool] = await Promise.all([
    db.select({
      cost: sql<number>`coalesce(sum(${agentActions.costUsd}), 0)`,
      tokensIn: sql<number>`coalesce(sum(${agentActions.tokensInput}), 0)`,
      tokensOut: sql<number>`coalesce(sum(${agentActions.tokensOutput}), 0)`,
      count: sql<number>`count(*)`,
    }).from(agentActions).where(gte(agentActions.createdAt, todayStart)),

    db.select({
      cost: sql<number>`coalesce(sum(${agentActions.costUsd}), 0)`,
      count: sql<number>`count(*)`,
    }).from(agentActions).where(gte(agentActions.createdAt, weekStart)),

    db.select({
      cost: sql<number>`coalesce(sum(${agentActions.costUsd}), 0)`,
      count: sql<number>`count(*)`,
    }).from(agentActions).where(gte(agentActions.createdAt, monthStart)),

    db.select({
      model: agentActions.model,
      provider: agentActions.provider,
      cost: sql<number>`coalesce(sum(${agentActions.costUsd}), 0)`,
      tokensIn: sql<number>`coalesce(sum(${agentActions.tokensInput}), 0)`,
      tokensOut: sql<number>`coalesce(sum(${agentActions.tokensOutput}), 0)`,
      count: sql<number>`count(*)`,
    })
      .from(agentActions)
      .where(and(gte(agentActions.createdAt, monthStart), eq(agentActions.actionType, 'llm_call')))
      .groupBy(agentActions.model, agentActions.provider),

    db.select({
      toolName: agentActions.toolName,
      count: sql<number>`count(*)`,
      avgMs: sql<number>`coalesce(avg(${agentActions.durationMs}), 0)`,
    })
      .from(agentActions)
      .where(and(gte(agentActions.createdAt, monthStart), eq(agentActions.actionType, 'tool_call')))
      .groupBy(agentActions.toolName),
  ]);

  return {
    today: todayTotals[0],
    week: weekTotals[0],
    month: monthTotals[0],
    byModel,
    byTool,
  };
};
