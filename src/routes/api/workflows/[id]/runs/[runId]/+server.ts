import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, params.runId));
  if (!run) {
    return json({ error: 'Run not found' }, { status: 404 });
  }

  const executions = await db
    .select()
    .from(nodeExecutions)
    .where(eq(nodeExecutions.runId, params.runId));

  return json({ ...run, nodeExecutions: executions });
};
