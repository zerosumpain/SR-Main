import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext, WorkflowDefinition } from '../types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const subWorkflowExecutor: NodeExecutor = {
  type: 'sub-workflow',
  async execute(input, config, context): Promise<NodeResult> {
    const workflowId = config.workflowId as string;
    if (!workflowId) return { output: { error: 'No workflowId configured' }, rowCount: 1 };

    // Load the sub-workflow definition from DB
    const [workflow] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .limit(1);

    if (!workflow) {
      throw new Error(`Sub-workflow not found: ${workflowId}`);
    }

    const nodes = await db
      .select()
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowId, workflowId));

    const edges = await db
      .select()
      .from(workflowEdges)
      .where(eq(workflowEdges.workflowId, workflowId));

    const definition: WorkflowDefinition = {
      id: workflowId,
      name: workflow.name,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        config: (n.config as Record<string, unknown>) ?? {},
        label: n.label ?? n.type,
        position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
      })),
      edges: edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      })),
    };

    // Import engine lazily to avoid circular dependency
    const { engine } = await import('$lib/workflows');
    const subRunId = `sub-${context.runId}-${crypto.randomUUID().slice(0, 8)}`;

    const result = await engine.execute(
      definition,
      subRunId,
      input,
      undefined,
      workflowId,
      { dryRun: context.dryRun },
    );

    if (result.status === 'failed') {
      throw new Error(`Sub-workflow failed: ${result.error || 'Unknown error'}`);
    }
    if (result.status === 'completed_with_errors') {
      const errorSummary = Array.from(result.nodeErrors.entries())
        .map(([nodeId, err]) => `${nodeId}: ${err}`)
        .join('; ');
      throw new Error(`Sub-workflow completed with errors — ${errorSummary}`);
    }

    // Identify sink nodes (nodes with no outgoing edges)
    const sinkIds = new Set(definition.nodes.map(n => n.id));
    for (const edge of definition.edges) {
      sinkIds.delete(edge.sourceNodeId);
    }

    // Merge outputs from all sink nodes (common for fan-in-style terminal)
    let lastNodeOutput: Record<string, unknown> = {};
    for (const id of sinkIds) {
      const out = result.nodeOutputs.get(id);
      if (out) lastNodeOutput = { ...lastNodeOutput, ...out };
    }

    return {
      output: lastNodeOutput,
      metadata: { subRunId, subWorkflowId: workflowId, subStatus: result.status },
      rowCount: 1,
    };
  },
  getInputSchema() { return { type: 'object', description: 'Passed as initial input to the sub-workflow' }; },
  getOutputSchema() { return { type: 'object', description: "Output from the sub-workflow's final node" }; },
};

export { subWorkflowDef } from './sub-workflow.def';
