import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, nodeExecutions } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

/**
 * Returns the last N node_execution rows for a given node id, scoped
 * to the canvas's workflow so a malformed nodeId can't pull data from an
 * unrelated workflow.
 *
 * Query params:
 * - limit: number of executions to return (1-100, default 20)
 *
 * Used by the Inspector panel to show execution history and replay/debug
 * previous runs on a node.
 *
 * Returns 404 when the canvas doesn't exist or the node id doesn't belong
 * to it. Returns 200 with empty executions array when no run has touched the
 * node yet.
 */

function canvasWorkflowName(slug: string): string {
  return `canvas:${slug}`;
}

export const GET: RequestHandler = async ({ params, url }) => {
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

  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);

  const rows = await db
    .select({
      id: nodeExecutions.id,
      runId: nodeExecutions.runId,
      status: nodeExecutions.status,
      inputData: nodeExecutions.inputData,
      outputData: nodeExecutions.outputData,
      error: nodeExecutions.error,
      startedAt: nodeExecutions.startedAt,
      completedAt: nodeExecutions.completedAt,
      costUsd: nodeExecutions.costUsd,
    })
    .from(nodeExecutions)
    .where(eq(nodeExecutions.nodeId, params.id))
    .orderBy(desc(nodeExecutions.completedAt))
    .limit(limit);

  return json({
    executions: rows.map((r) => ({
      id: r.id,
      runId: r.runId,
      status: r.status,
      inputData: r.inputData,
      outputData: r.outputData,
      error: r.error,
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      costUsd: r.costUsd !== null ? Number(r.costUsd) : null,
    })),
  });
};
