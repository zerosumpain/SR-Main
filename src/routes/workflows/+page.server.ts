import { db } from '$lib/db';
import { workflows, workflowNodes, workflowRuns } from '$lib/db/schema';
import { desc, eq, count } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const rows = await db.select().from(workflows).orderBy(desc(workflows.createdAt));

  // Enrich with node count and last run
  const enriched = await Promise.all(rows.map(async (w) => {
    const [nodeCount] = await db
      .select({ count: count() })
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowId, w.id));

    const [lastRun] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, w.id))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(1);

    return {
      ...w,
      nodeCount: nodeCount?.count ?? 0,
      lastRun: lastRun ? { status: lastRun.status, startedAt: lastRun.startedAt } : null,
      triggerType: (w.trigger as any)?.type || 'manual',
    };
  }));

  return { workflows: enriched };
};
