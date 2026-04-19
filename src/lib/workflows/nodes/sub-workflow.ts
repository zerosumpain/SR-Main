import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext, WorkflowDefinition } from '../types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const subWorkflowExecutor: NodeExecutor = {
  type: 'sub-workflow',
  async execute(input, config, context): Promise<NodeResult> {
    const workflowId = config.workflowId as string;
    if (!workflowId) return { output: { error: 'No workflowId configured' } };

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
    );

    if (result.status === 'failed') {
      throw new Error(`Sub-workflow failed: ${result.error || 'Unknown error'}`);
    }

    // Get the output from the last node in topological order
    const lastNodeOutput = Array.from(result.nodeOutputs.values()).pop() ?? {};

    return {
      output: lastNodeOutput,
      metadata: { subRunId, subWorkflowId: workflowId, subStatus: result.status },
    };
  },
  getInputSchema() { return { type: 'object', description: 'Passed as initial input to the sub-workflow' }; },
  getOutputSchema() { return { type: 'object', description: "Output from the sub-workflow's final node" }; },
};

export const subWorkflowDef: NodeDefinition = {
  type: 'sub-workflow', label: 'Sub-Workflow', category: 'control',
  description: 'Execute another saved workflow as a step. Passes input to the sub-workflow and returns its output.',
  configSchema: { type: 'object', properties: {
    workflowId: { type: 'string', description: 'ID of the workflow to execute' },
  }, required: ['workflowId'] },
  defaultConfig: { workflowId: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  basicConfig: [
    {
      key: 'workflowId',
      label: 'Workflow ID',
      type: 'text',
      placeholder: 'Paste workflow ID here',
      description:
        'The ID of the workflow to run. Find it in the URL of the workflow edit page.',
    },
  ],
  llmDescription: 'Use to compose workflows — call a pre-built workflow as a reusable step. Essential for building complex agentic systems from smaller building blocks.',
};
