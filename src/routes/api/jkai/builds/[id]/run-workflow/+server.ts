import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import {
  jkaiBuilds,
  workflows,
  workflowNodes,
  workflowEdges,
  workflowRuns,
  nodeExecutions,
} from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { deliverManualToBuild } from '$lib/jkai/workflow-deliveries';

export const POST: RequestHandler = async ({ params, request }) => {
  const buildId = params.id!;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const workflowId = typeof body.workflowId === 'string' ? body.workflowId : null;
  const input = (body.input as Record<string, unknown> | undefined) ?? {};
  if (!workflowId) throw error(400, 'workflowId is required');

  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId)).limit(1);
  if (!build) throw error(404, 'build not found');
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  if (!wf) throw error(404, 'workflow not found');

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, workflowId));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId));
  const { isDisplayOnlyType } = await import('$lib/workflows/types');
  const runnableNodes = nodes.filter((n) => !isDisplayOnlyType(n.type));
  const runnableEdges = edges.filter((e) => {
    const src = runnableNodes.find((n) => n.id === e.sourceNodeId);
    const tgt = runnableNodes.find((n) => n.id === e.targetNodeId);
    return src && tgt;
  });

  const [run] = await db.insert(workflowRuns).values({
    workflowId,
    status: 'running',
    trigger: 'manual',
    startedAt: new Date(),
  }).returning();

  for (const node of runnableNodes) {
    await db.insert(nodeExecutions).values({ runId: run.id, nodeId: node.id, status: 'pending' });
  }

  const definition = {
    id: wf.id,
    name: wf.name,
    nodes: runnableNodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position as { x: number; y: number },
      config: (n.config || {}) as Record<string, unknown>,
      label: n.label,
    })),
    edges: runnableEdges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };

  const { runWorkflowAndPersist } = await import('$lib/workflows/run-helpers');
  runWorkflowAndPersist(definition, run.id, input, {
    workflowId,
    selfHealing: true,
    label: 'build-manual',
  });

  // Wait for completion in the background, then deliver. Polls the run status
  // since runWorkflowAndPersist returns void; bounded by 15 min hard cap matching
  // the engine's own RUN_HARD_TIMEOUT_MS.
  void waitAndDeliver(buildId, workflowId, run.id);

  return json({ runId: run.id, status: 'running' }, { status: 202 });
};

const POLL_INTERVAL_MS = 2_000;
const POLL_DEADLINE_MS = 16 * 60 * 1000;

async function waitAndDeliver(buildId: string, workflowId: string, runId: string): Promise<void> {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const [latest] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
    if (!latest) return;
    if (latest.status === 'completed' || latest.status === 'completed_with_errors' || latest.status === 'failed' || latest.status === 'cancelled') {
      try {
        await deliverManualToBuild(buildId, workflowId, runId);
      } catch (err) {
        console.error('[builds/run-workflow] manual delivery failed', runId, err);
      }
      return;
    }
  }
}
