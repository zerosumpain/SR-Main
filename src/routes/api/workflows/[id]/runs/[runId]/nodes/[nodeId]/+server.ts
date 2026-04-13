import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { nodeExecutions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const [execution] = await db
    .select()
    .from(nodeExecutions)
    .where(
      and(
        eq(nodeExecutions.runId, params.runId),
        eq(nodeExecutions.nodeId, params.nodeId),
      ),
    );

  if (!execution) {
    return json({ error: 'Node execution not found' }, { status: 404 });
  }

  return json({
    nodeId: params.nodeId,
    status: execution.status,
    inputData: execution.inputData,
    outputData: execution.outputData,
    logs: execution.logs,
    error: execution.error,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
  });
};
