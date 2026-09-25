import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowRuns } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import { setRunChainDepth } from '$lib/events/platform-bus';
import { isDisplayOnlyType, type WorkflowDefinition } from './types';
import { emitObs } from './observability-bus';
import { finaliseRun, failRun } from './run-finalise';

/**
 * The shared start path for a run nobody clicked: an event, a WhatsApp keyword,
 * an email. The platform event bus, the whatsapp dispatcher and the gmail
 * bridge each carried a byte-for-byte copy of this (load nodes → shape a
 * definition → insert the run row → enqueue in worker mode or execute in
 * process → finalise), and the event bus's copy had already lost the worker
 * switch and the display-only filter the other two had. One copy now.
 */

/** A runnable definition from the stored nodes/edges; display-only nodes and their edges dropped. */
export async function loadDefinition(workflowId: string): Promise<WorkflowDefinition | null> {
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  if (!workflow) return null;
  const nodes = (await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, workflowId)))
    .filter((n) => !isDisplayOnlyType(n.type));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)))
    .filter((e) => ids.has(e.sourceNodeId) && ids.has(e.targetNodeId));
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
 * Start `workflowId` with `input` as a trigger='event' run. Returns the run id,
 * or null when the workflow no longer exists. Execution is NOT awaited.
 * `chainDepth` is the depth of the run itself (event depth + 1).
 */
export async function startTriggeredRun(
  workflowId: string,
  input: Record<string, unknown>,
  opts: { label: string; chainDepth?: number },
): Promise<string | null> {
  const definition = await loadDefinition(workflowId);
  if (!definition) return null;
  const runId = crypto.randomUUID();
  // In worker mode the run is created 'pending' with its input persisted, and
  // the out-of-process worker claims it and replays input_data.
  const workerMode = process.env.JKAI_RUN_WORKER === '1';
  await db.insert(workflowRuns).values({
    id: runId,
    workflowId,
    status: workerMode ? 'pending' : 'running',
    trigger: 'event',
    startedAt: new Date(),
    inputData: input,
  });
  if (workerMode) {
    const { enqueue } = await import('./run-queue');
    await enqueue(runId);
    return runId;
  }
  if (opts.chainDepth) setRunChainDepth(runId, opts.chainDepth);
  const runStartedAt = Date.now();
  emitObs('run.started', { workflowId, runId, trigger: 'event', startedAt: new Date(runStartedAt).toISOString() });
  engine
    .execute(definition, runId, input, undefined, workflowId)
    .then((result) => finaliseRun({ workflowId, runId, result, runStartedAt, chainDepth: opts.chainDepth, label: opts.label }))
    .catch((err) => {
      console.error(`[${opts.label}] workflow execution error (runId=${runId}):`, err instanceof Error ? err.message : err);
      return failRun({ workflowId, runId, error: err, label: opts.label });
    });
  return runId;
}
