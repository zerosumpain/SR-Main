import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import type { WorkflowDefinition } from '$lib/workflows';
import { isDisplayOnlyType } from '$lib/workflows/types';
import { runWorkflowAndPersist } from '$lib/workflows/run-helpers';

/**
 * POST /api/workflows/:id/nodes/:nodeId/run
 *
 * Run a SINGLE node (not the whole canvas). The engine is handed a
 * definition containing just this node and no edges, so no upstream /
 * downstream nodes execute.
 *
 * Input semantics:
 *   - If this node has a completed execution in the most recent run, we
 *     seed initialInput with its previously-recorded inputData so
 *     deterministic nodes (scrape / llm-call / etc.) behave the same as
 *     they did in that pipeline run.
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
    const [latest] = await db
      .select({ inputData: nodeExecutions.inputData })
      .from(nodeExecutions)
      .where(
        and(
          eq(nodeExecutions.nodeId, node.id),
          eq(nodeExecutions.status, 'completed'),
        ),
      )
      .orderBy(desc(nodeExecutions.completedAt))
      .limit(1);
    if (latest?.inputData && typeof latest.inputData === 'object') {
      initialInput = latest.inputData as Record<string, unknown>;
    }
  }

  const [run] = await db
    .insert(workflowRuns)
    .values({
      workflowId: params.id!,
      status: 'running',
      trigger: 'manual',
      startedAt: new Date(),
    })
    .returning();

  await db.insert(nodeExecutions).values({
    runId: run.id,
    nodeId: node.id,
    status: 'pending',
  });

  const definition: WorkflowDefinition = {
    id: workflow.id,
    name: workflow.name,
    nodes: [
      {
        id: node.id,
        type: node.type,
        position: node.position as { x: number; y: number },
        config: (node.config ?? {}) as Record<string, unknown>,
        label: node.label,
      },
    ],
    edges: [],
  };

  // Single-node Re-Run disables self-healing: healing fires another LLM
  // diagnosis loop on node failure, which for LLM-driven nodes (site-mapper,
  // llm-call, etc.) just burns 3×60s retrying the same thing. The user
  // clicked Re-Run because they want to iterate — fast failure is a feature.
  runWorkflowAndPersist(definition, run.id, initialInput, {
    workflowId: params.id!,
    label: 'node-rerun',
    selfHealing: false,
  });

  return json({ runId: run.id, nodeId: node.id, status: 'running' }, { status: 201 });
};
