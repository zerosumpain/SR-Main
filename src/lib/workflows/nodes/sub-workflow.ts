import type {
  NodeExecutor,
  NodeResult,
  ExecutionContext,
  WorkflowDefinition,
  RunStatus,
} from '../types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Structured outcome of running a sub-workflow once. Unlike the executor
 * (which throws on failure), this helper never throws for a run-level failure —
 * it reports the status + a human-readable error summary so callers can decide
 * whether to abort (sub-workflow node) or record-and-continue (loop v2's
 * per-item fan-out).
 */
export interface SubWorkflowRunResult {
  status: RunStatus;
  /** Merged output of the sub-workflow's sink nodes. */
  output: Record<string, unknown>;
  /** Set when status is 'failed' or 'completed_with_errors'. */
  error?: string;
  /** The synthetic run id used for the sub-run. */
  subRunId: string;
}

/**
 * Load a saved workflow from the DB and shape it into a `WorkflowDefinition`
 * the engine can execute. Returns null when the id doesn't resolve to a
 * workflow (caller decides whether that's a hard error).
 *
 * NB: the DB access order (workflow row via `.limit(1)`, then nodes, then
 * edges) is load-bearing for the executor's unit test, which sequences its
 * mocked `where()` responses in exactly this order.
 */
export async function loadSubWorkflowDefinition(
  workflowId: string,
): Promise<WorkflowDefinition | null> {
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1);

  if (!workflow) return null;

  const nodes = await db
    .select()
    .from(workflowNodes)
    .where(eq(workflowNodes.workflowId, workflowId));

  const edges = await db
    .select()
    .from(workflowEdges)
    .where(eq(workflowEdges.workflowId, workflowId));

  return {
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
}

/**
 * Run a loaded sub-workflow definition once and collect the merged sink-node
 * output. Propagates the parent run's dryRun flag so side-effecting nodes
 * inside the sub-workflow simulate too. Never throws on a run-level failure —
 * returns the status + error summary instead (see {@link SubWorkflowRunResult}).
 *
 * This is the single invocation primitive shared by the `sub-workflow` node
 * and `loop` v2's `subworkflow` mode — keep both callers on this path so
 * recursion/dryRun/output-merge semantics stay in one place.
 */
export async function runSubWorkflowDefinition(
  definition: WorkflowDefinition,
  input: Record<string, unknown>,
  context: ExecutionContext,
  subRunId?: string,
): Promise<SubWorkflowRunResult> {
  // Import engine lazily to avoid circular dependency.
  const { engine } = await import('$lib/workflows');
  const runId = subRunId ?? `sub-${context.runId}-${crypto.randomUUID().slice(0, 8)}`;

  const result = await engine.execute(
    definition,
    runId,
    input,
    undefined,
    definition.id,
    { dryRun: context.dryRun },
  );

  // Identify sink nodes (nodes with no outgoing edges) and merge their outputs
  // (common for fan-in-style terminals).
  const sinkIds = new Set(definition.nodes.map((n) => n.id));
  for (const edge of definition.edges) sinkIds.delete(edge.sourceNodeId);

  let output: Record<string, unknown> = {};
  for (const id of sinkIds) {
    const out = result.nodeOutputs.get(id);
    if (out) output = { ...output, ...out };
  }

  let error: string | undefined;
  if (result.status === 'failed') {
    error = result.error || 'Unknown error';
  } else if (result.status === 'completed_with_errors') {
    error = Array.from(result.nodeErrors.entries())
      .map(([nodeId, err]) => `${nodeId}: ${err}`)
      .join('; ');
  }

  return { status: result.status, output, error, subRunId: runId };
}

export const subWorkflowExecutor: NodeExecutor = {
  type: 'sub-workflow',
  async execute(input, config, context): Promise<NodeResult> {
    const workflowId = config.workflowId as string;
    if (!workflowId) return { output: { error: 'No workflowId configured' }, rowCount: 1 };

    const definition = await loadSubWorkflowDefinition(workflowId);
    if (!definition) {
      throw new Error(`Sub-workflow not found: ${workflowId}`);
    }

    const res = await runSubWorkflowDefinition(definition, input, context);

    if (res.status === 'failed') {
      throw new Error(`Sub-workflow failed: ${res.error || 'Unknown error'}`);
    }
    if (res.status === 'completed_with_errors') {
      throw new Error(`Sub-workflow completed with errors — ${res.error}`);
    }

    return {
      output: res.output,
      metadata: { subRunId: res.subRunId, subWorkflowId: workflowId, subStatus: res.status },
      rowCount: 1,
    };
  },
  getInputSchema() { return { type: 'object', description: 'Passed as initial input to the sub-workflow' }; },
  getOutputSchema() { return { type: 'object', description: "Output from the sub-workflow's final node" }; },
};

export { subWorkflowDef } from './sub-workflow.def';
