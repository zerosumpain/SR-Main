import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { agentTasks, agentActions, agentActivity } from '$lib/db/schema';
import { desc, gte, eq, sql } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [tasks, recentActivity, todayCosts] = await Promise.all([
    // Active tasks
    db
      .select()
      .from(agentTasks)
      .orderBy(desc(agentTasks.createdAt))
      .limit(20),

    // Recent activity (last 50)
    db
      .select()
      .from(agentActivity)
      .orderBy(desc(agentActivity.createdAt))
      .limit(50),

    // Today's cost aggregate
    db
      .select({
        totalCost: sql<number>`coalesce(sum(${agentActions.costUsd}), 0)`,
        totalTokensIn: sql<number>`coalesce(sum(${agentActions.tokensInput}), 0)`,
        totalTokensOut: sql<number>`coalesce(sum(${agentActions.tokensOutput}), 0)`,
        actionCount: sql<number>`count(*)`,
      })
      .from(agentActions)
      .where(gte(agentActions.createdAt, todayStart)),
  ]);

  return {
    tasks,
    recentActivity,
    todayCosts: todayCosts[0],
  };
};
