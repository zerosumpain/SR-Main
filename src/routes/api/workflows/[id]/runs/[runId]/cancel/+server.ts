import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowRuns, nodeExecutions } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { engine } from '$lib/workflows';

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

  // #11 CANCEL: abort the in-flight run in this process AFTER the DB status is
  // already 'failed', so the engine's post-run persister can't resurrect a
  // 'running' status. No-op if the run isn't executing in this process (e.g.
  // it was started on a different node, or already settled).
  const aborted = engine.cancelRun(params.runId);

  return json({ ok: true, aborted });
};
