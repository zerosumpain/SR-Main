import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, nodeExecutions } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

/**
 * Returns the most-recent node_execution row for a given node id, scoped
 * to the canvas's workflow so a malformed nodeId can't pull data from an
 * unrelated workflow.
 *
 * Used by the canvas page when a `node.completed` / `node.failed` event
 * arrives via SSE and the tab needs to refresh that node's
 * inputData / outputData (powers live Inspector updates across tabs).
 *
 * Returns 404 when the canvas doesn't exist or the node id doesn't belong
 * to it. Returns 200 with `null` execution when no run has touched the
 * node yet — the caller treats that as "leave existing data alone".
 */

function canvasWorkflowName(slug: string): string {
  return `canvas:${slug}`;
}

export const GET: RequestHandler = async ({ params }) => {
  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.name, canvasWorkflowName(params.slug)));
  if (!wf) return json({ error: 'Canvas not found' }, { status: 404 });

  const [node] = await db
    .select({ id: workflowNodes.id })
    .from(workflowNodes)
    .where(and(eq(workflowNodes.id, params.id), eq(workflowNodes.workflowId, wf.id)));
  if (!node) return json({ error: 'Node not found in this canvas' }, { status: 404 });

  const [exec] = await db
    .select({
      status: nodeExecutions.status,
      inputData: nodeExecutions.inputData,
      outputData: nodeExecutions.outputData,
      error: nodeExecutions.error,
      startedAt: nodeExecutions.startedAt,
      completedAt: nodeExecutions.completedAt,
    })
    .from(nodeExecutions)
    .where(eq(nodeExecutions.nodeId, params.id))
    .orderBy(desc(nodeExecutions.completedAt))
    .limit(1);

  if (!exec) return json({ execution: null });

  return json({
    execution: {
      status: exec.status,
      inputData: exec.inputData,
      outputData: exec.outputData,
      error: exec.error,
      startedAt: exec.startedAt?.toISOString() ?? null,
      completedAt: exec.completedAt?.toISOString() ?? null,
    },
  });
};
