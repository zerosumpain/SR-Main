import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { verifyWorkflow } from '$lib/workflows/orchestrator/verify';
import { registry } from '$lib/workflows';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';

export const GET: RequestHandler = async ({ params }) => {
  const { id } = params;
  if (!id) {
    return json({ valid: false, issues: [{ issue: 'Missing workflow id', severity: 'error' }] }, { status: 400 });
  }

  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, id))
    .limit(1);

  if (!workflow) {
    return json({ valid: false, issues: [{ issue: 'Workflow not found', severity: 'error' }] }, { status: 404 });
  }

  const nodes = await db
    .select()
    .from(workflowNodes)
    .where(eq(workflowNodes.workflowId, id));

  const edges = await db
    .select()
    .from(workflowEdges)
    .where(eq(workflowEdges.workflowId, id));

  const nodeDefs: WorkflowNodeDef[] = nodes.map((n) => ({
    id: n.id,
    type: n.type,
    config: (n.config as Record<string, unknown>) ?? {},
    label: n.label ?? n.type,
    position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
  }));

  const edgeDefs: WorkflowEdgeDef[] = edges.map((e) => ({
    id: e.id,
    sourceNodeId: e.sourceNodeId,
    targetNodeId: e.targetNodeId,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }));

  const issues = verifyWorkflow(
    nodeDefs,
    edgeDefs,
    (type) => registry.getDefinition(type),
    (type, config) => {
      const executor = registry.getExecutor(type);
      return executor ? executor.getOutputSchema(config) : { type: 'object' };
    },
  );

  return json({
    valid: issues.length === 0,
    issues,
  });
};
