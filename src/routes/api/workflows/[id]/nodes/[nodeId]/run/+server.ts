import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, nodeExecutions } from '$lib/db/schema';
import { and, eq, desc, isNotNull, sql } from 'drizzle-orm';
import { isDisplayOnlyType } from '$lib/workflows/types';
import { startRun } from '$lib/workflows/start-run';

/**
 * POST /api/workflows/:id/nodes/:nodeId/run
 *
 * Run a SINGLE node (not the whole canvas). The engine is handed a
 * definition containing just this node and no edges, so no upstream /
 * downstream nodes execute.
 *
 * Input semantics:
 *   - If this node has a recorded execution (completed OR failed), we seed
 *     initialInput with the latest one's inputData so deterministic nodes
 *     (scrape / llm-call / etc.) behave the same as they did in that run.
 *   - Otherwise empty input — the node's config is the sole source of
 *     truth. Works for node types whose config fully specifies the work
 *     to do (site-mapper, stealth-scrape, etc.).
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, params.id!));
  if (!workflow) throw error(404, 'workflow not found');

  const [node] = await db
    .select()
    .from(workflowNodes)
    .where(
      and(
        eq(workflowNodes.workflowId, params.id!),
        eq(workflowNodes.id, params.nodeId!),
      ),
    );
  if (!node) throw error(404, 'node not found in this workflow');
  if (isDisplayOnlyType(node.type)) {
    throw error(400, `${node.type} is display-only and cannot be run standalone`);
  }

  const body = await request.json().catch(() => ({}));
  let initialInput = (body as { input?: Record<string, unknown> }).input ?? {};

  // If no input supplied, seed from the last run's recorded inputData so
  // Re-Run behaves like "run this step again with the inputs it last
  // received". Useful when Re-Run happens from the inspector after a
  // failed run — the node gets another shot at the same input.
  if (!body || Object.keys(initialInput).length === 0) {
    // Any status: a FAILED execution is the one Re-Run exists for. Filtering
    // on 'completed' re-ran a failed node against an older successful input
    // (or none). Failed executions record their input now (engine + finaliser).
    // NULLS LAST: a Postgres DESC sort puts nulls first, and a row still
    // running has no completedAt.
    const [latest] = await db
      .select({ inputData: nodeExecutions.inputData })
      .from(nodeExecutions)
      .where(
        and(
          eq(nodeExecutions.nodeId, node.id),
          isNotNull(nodeExecutions.inputData),
        ),
      )
      .orderBy(sql`${nodeExecutions.completedAt} desc nulls last`, desc(nodeExecutions.startedAt))
      .limit(1);
    if (latest?.inputData && typeof latest.inputData === 'object') {
      initialInput = latest.inputData as Record<string, unknown>;
    }
  }

  // A definition of just this node and no edges, so nothing up- or downstream
  // runs. Self-healing is off: healing fires another LLM diagnosis loop on
  // failure, and the user clicked Re-Run to iterate — fast failure is a feature.
  const started = await startRun({
    workflowId: params.id!,
    trigger: 'manual',
    input: initialInput,
    definition: {
      id: workflow.id,
      name: workflow.name,
      nodes: [{
        id: node.id,
        type: node.type,
        position: node.position as { x: number; y: number },
        config: (node.config ?? {}) as Record<string, unknown>,
        label: node.label,
      }],
      edges: [],
    },
    selfHealing: false,
    watchdog: true,
    label: 'node-rerun',
  });
  if (!started) throw error(404, 'workflow not found');

  return json({ runId: started.runId, nodeId: node.id, status: 'running' }, { status: 201 });
};
