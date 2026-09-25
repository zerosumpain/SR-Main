import type {
  NodeExecutor,
  NodeResult,
  ExecutionContext,
  WorkflowDefinition,
  RunStatus,
  JsonSchema,
} from '../types';
import type { EngineResult } from '../engine';
import { db } from '$lib/db';
import { workflowRuns, workflowInteractions } from '$lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { FatalError } from '../errors';
import { validateAgainstSchema } from '$lib/datastore/validate';

/** How deep sub-workflows may nest (parent → child → …) before a run is refused. */
export const MAX_SUBWORKFLOW_DEPTH = 5;

/**
 * Structured outcome of running a sub-workflow once. Never throws for a
 * run-level failure — the sub-workflow node throws, loop's per-item fan-out
 * records and continues.
 */
export interface SubWorkflowRunResult {
  status: RunStatus;
  /** Merged output of the sub-workflow's sink nodes. */
  output: Record<string, unknown>;
  /** Set when status is 'failed' or 'completed_with_errors'. */
  error?: string;
  /** The child's workflow_runs id. */
  subRunId: string;
}

/** A saved workflow's runnable definition (display-only nodes dropped); null when gone. */
export async function loadSubWorkflowDefinition(workflowId: string): Promise<WorkflowDefinition | null> {
  const { loadDefinition } = await import('../start-run');
  return loadDefinition(workflowId);
}

/** Merge the sink nodes' outputs (nodes with no outgoing edge) and summarise the status. */
export function childOutcome(definition: WorkflowDefinition, result: EngineResult): Omit<SubWorkflowRunResult, 'subRunId'> {
  const sinkIds = new Set(definition.nodes.map((n) => n.id));
  for (const edge of definition.edges) sinkIds.delete(edge.sourceNodeId);
  let output: Record<string, unknown> = {};
  for (const id of sinkIds) {
    const out = result.nodeOutputs.get(id);
    if (out) output = { ...output, ...out };
  }
  let error: string | undefined;
  if (result.status === 'failed') error = result.error || 'Unknown error';
  else if (result.status === 'completed_with_errors') {
    error = Array.from(result.nodeErrors.entries()).map(([nodeId, err]) => `${nodeId}: ${err}`).join('; ');
  }
  return { status: result.status, output, error };
}

/** How many parents sit above `runId` (0 for a top-level run). */
async function runDepth(runId: string): Promise<number> {
  let depth = 0;
  let current: string | null = runId;
  while (current && depth <= MAX_SUBWORKFLOW_DEPTH) {
    const [row]: Array<{ parentRunId: string | null }> = await db
      .select({ parentRunId: workflowRuns.parentRunId }).from(workflowRuns).where(eq(workflowRuns.id, current)).limit(1);
    current = row?.parentRunId ?? null;
    if (current) depth++;
  }
  return depth;
}

/**
 * Run `definition` as a CHILD run of the current one: a real workflow_runs row
 * (parent_run_id, its own pinned version, its own node rows and history),
 * executed in this process without taking a top-level concurrency slot, and
 * cancelled when the parent is. The single invocation primitive shared by the
 * sub-workflow node and loop's `subworkflow` mode.
 */
export async function runSubWorkflowDefinition(
  definition: WorkflowDefinition,
  input: Record<string, unknown>,
  context: ExecutionContext,
): Promise<SubWorkflowRunResult> {
  if ((await runDepth(context.runId)) + 1 > MAX_SUBWORKFLOW_DEPTH) {
    throw new FatalError(`Sub-workflows nest deeper than ${MAX_SUBWORKFLOW_DEPTH} levels — is a workflow calling itself?`);
  }
  const { startRun } = await import('../start-run');
  const started = await startRun({
    workflowId: definition.id,
    definition,
    trigger: 'sub-workflow',
    input,
    parentRunId: context.runId,
    dryRun: context.dryRun,
    label: 'sub-workflow',
  });
  if (!started) throw new FatalError(`Sub-workflow not found: ${definition.id}`);
  const cancel = () => void import('$lib/workflows').then(({ engine }) => engine.cancelRun(started.runId));
  context.abortSignal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await started.done;
    if (!result) return { status: 'failed', output: {}, error: 'Sub-workflow execution threw', subRunId: started.runId };
    return { ...childOutcome(definition, result), subRunId: started.runId };
  } finally {
    context.abortSignal.removeEventListener('abort', cancel);
  }
}

function checkSchema(value: unknown, schema: unknown, where: string): void {
  if (!schema || typeof schema !== 'object') return;
  const res = validateAgainstSchema(value, schema as JsonSchema);
  if (!res.ok) throw new FatalError(`Sub-workflow ${where} does not match its schema: ${res.errors.join('; ')}`);
}

export const subWorkflowExecutor: NodeExecutor = {
  type: 'sub-workflow',
  async execute(input, config, context): Promise<NodeResult> {
    const workflowId = config.workflowId as string;
    if (!workflowId) throw new FatalError('No workflowId configured');
    checkSchema(input, config.inputSchema, 'input');

    const definition = await loadSubWorkflowDefinition(workflowId);
    if (!definition) throw new FatalError(`Sub-workflow not found: ${workflowId}`);

    const res = await runSubWorkflowDefinition(definition, input, context);
    const metadata = { subRunId: res.subRunId, subWorkflowId: workflowId, subStatus: res.status };

    // The child is waiting on a person: so does the parent. When the child
    // settles, engine-resume.continueParent resumes (or fails) this step.
    if (res.status === 'awaiting_human') {
      const [pending] = await db.select({ id: workflowInteractions.id }).from(workflowInteractions)
        .where(and(eq(workflowInteractions.runId, res.subRunId), isNull(workflowInteractions.resolvedAt))).limit(1);
      return { output: {}, metadata, pause: { reason: 'awaiting_human', interactionId: pending?.id ?? 0 } };
    }
    if (res.status === 'failed') throw new Error(`Sub-workflow failed: ${res.error || 'Unknown error'}`);
    if (res.status === 'completed_with_errors') throw new Error(`Sub-workflow completed with errors — ${res.error}`);

    checkSchema(res.output, config.outputSchema, 'output');
    return { output: res.output, metadata, rowCount: 1 };
  },
  getInputSchema(config) {
    return (config.inputSchema as JsonSchema) ?? { type: 'object', description: 'Passed as initial input to the sub-workflow' };
  },
  getOutputSchema(config) {
    return (config.outputSchema as JsonSchema) ?? { type: 'object', description: "Output from the sub-workflow's final node" };
  },
};

export { subWorkflowDef } from './sub-workflow.def';
