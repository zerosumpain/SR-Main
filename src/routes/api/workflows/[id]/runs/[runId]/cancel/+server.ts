import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowRuns, nodeExecutions } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

export const POST: RequestHandler = async ({ params }) => {
  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, params.runId))
    .limit(1);
  if (!run) return json({ error: 'Run not found' }, { status: 404 });
  if (run.status !== 'running' && run.status !== 'pending') {
    return json({ ok: true, alreadyDone: true });
  }

  await db
    .update(workflowRuns)
    .set({
      status: 'failed',
      error: 'Cancelled by user',
      completedAt: new Date(),
    })
    .where(eq(workflowRuns.id, params.runId));

  await db
    .update(nodeExecutions)
    .set({ status: 'failed', error: 'Cancelled by user', completedAt: new Date() })
    .where(
      and(
        eq(nodeExecutions.runId, params.runId),
        inArray(nodeExecutions.status, ['pending', 'running']),
      ),
    );

  return json({ ok: true });
};
