/**
 * engine-resume.ts
 *
 * Resume a workflow run that was paused at an `interactive-step` node.
 * The caller provides the resolved output for the paused node; the engine
 * re-enters the normal execution loop with all previously-completed node
 * outputs pre-seeded so the topological walker skips finished nodes.
 */

import { db } from '$lib/db';
import { workflowRuns, nodeExecutions, workflowInteractions } from '$lib/db/schema';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { registry } from '$lib/workflows';
import { emitWorkflowEvent } from '$lib/workflows/events';
import type { EngineResult } from './engine';
import { buildResumeSeed, planRecovery } from './resume-seed';
import { failRun, upsertNodeExecution } from './run-finalise';
import { executeRun, loadPinnedDefinition } from './start-run';

export type ResolveInteractionReason =
  | 'not_pending'
  | 'cancelled';

export interface ResolveInteractionResult {
  resolved: boolean;
  reason?: ResolveInteractionReason;
}

/**
 * Resolve a pending workflow interaction and, if the run was paused
 * (`awaiting_human`), resume it. This is the single underlying code path the
 * canvas resolve API route uses — the inbound WhatsApp approval handler calls
 * it directly (no HTTP self-hop) so resume works identically in worker mode.
 *
 * Mirrors the route's semantics: flip resolvedAt/resolvedBy/formValues, emit the
 * `interaction_resolved` SSE event, and only call `resumeRun` when the run is
 * actually awaiting_human (a CAPTCHA-style inline interaction leaves the run in
 * `running` and its executor polls resolvedAt itself).
 */
export async function resolveInteraction(opts: {
  runId: string;
  nodeId: string;
  formValues: Record<string, unknown>;
  resolvedBy?: string | null;
}): Promise<ResolveInteractionResult> {
  const { runId, nodeId, formValues, resolvedBy = null } = opts;

  const [pending] = await db
    .select()
    .from(workflowInteractions)
    .where(
      and(
        eq(workflowInteractions.runId, runId),
        eq(workflowInteractions.nodeId, nodeId),
        isNull(workflowInteractions.resolvedAt),
      ),
    );

  if (!pending) return { resolved: false, reason: 'not_pending' };
  if (pending.cancelled) return { resolved: false, reason: 'cancelled' };

  await db
    .update(workflowInteractions)
    .set({ resolvedAt: new Date(), resolvedBy, formValues })
    .where(eq(workflowInteractions.id, pending.id));

  emitWorkflowEvent({
    type: 'interaction_resolved',
    runId,
    nodeId,
    data: { interactionId: pending.id },
    timestamp: new Date().toISOString(),
  });

  const [run] = await db
    .select({ status: workflowRuns.status })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId));

  if (run?.status === 'awaiting_human') {
    const nodeOutput = {
      completed: true,
      completedAt: new Date().toISOString(),
      formValues,
      durationMs: Date.now() - new Date(pending.openedAt).getTime(),
    };
    await resumeRun(runId, { [nodeId]: nodeOutput });
  }

  return { resolved: true };
}

/**
 * Resume a run that is currently in `awaiting_human` status, against the
 * definition it was PINNED to when it started — an approval resolved a day
 * later runs the graph the owner approved, not whatever the canvas holds now.
 *
 * @param resolvedNodeOutput  Map of nodeId -> output for the paused node only.
 */
export async function resumeRun(
  runId: string,
  resolvedNodeOutput: Record<string, Record<string, unknown>>,
): Promise<void> {
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  if (!run) throw new Error(`resumeRun: run ${runId} not found`);
  if (run.status !== 'awaiting_human') {
    throw new Error(`resumeRun: run ${runId} is not awaiting_human (status=${run.status})`);
  }
  if (!run.pausedAtNodeId) throw new Error(`resumeRun: run ${runId} has no pausedAtNodeId`);
  const pausedNodeId = run.pausedAtNodeId;
  const definition = await loadPinnedDefinition(run);
  if (!definition) throw new Error(`resumeRun: workflow ${run.workflowId} not found`);

  // Previously-completed outputs AND the branch each chose: seeded nodes never
  // execute again, so their routing is replayed from what was recorded —
  // otherwise both branches below a resumed approval run.
  const executions = await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, runId));

  // The paused node's output comes from the human's resolution. A node that
  // knows how (approval) turns it into its real output + selected handle.
  const resolvedOutput = resolvedNodeOutput[pausedNodeId] ?? Object.values(resolvedNodeOutput)[0];
  if (!resolvedOutput) {
    throw new Error(`resumeRun: resolvedNodeOutput does not contain output for node ${pausedNodeId}`);
  }
  const pausedNode = definition.nodes.find((n) => n.id === pausedNodeId);
  const pausedExec = executions.find((e) => e.nodeId === pausedNodeId);
  const seed = buildResumeSeed({
    executions,
    pausedNodeId,
    pausedNodeInput: (pausedExec?.inputData as Record<string, unknown> | null) ?? {},
    resolved: resolvedOutput,
    executor: pausedNode ? registry.getExecutor(pausedNode.type) : null,
  });

  await upsertNodeExecution(runId, pausedNodeId, {
    status: 'completed',
    outputData: seed.outputs[pausedNodeId],
    selectedHandle: seed.handles[pausedNodeId] ?? null,
    completedAt: new Date(),
  });
  await db.update(workflowRuns).set({ status: 'running', pausedAtNodeId: null }).where(eq(workflowRuns.id, runId));

  void executeRun({
    runId,
    workflowId: run.workflowId,
    definition,
    input: (run.inputData as Record<string, unknown> | null) ?? {},
    trigger: run.trigger,
    parentRunId: run.parentRunId,
    seed,
    runStartedAt: run.startedAt?.getTime(),
    label: 'resume',
  });
}

/** How many times recovery may resume one run before it gives up. */
export const MAX_AUTO_RESUMES = 1;
const RECOVERABLE = ['running', 'paused'];

/**
 * Crash / deploy recovery for a run whose process died (stale heartbeat), or
 * that the deploy drain parked as `paused`.
 *
 * The run resumes ONCE from its persisted node outputs, against its pinned
 * version. A node the dead process was in the middle of is re-run only if it
 * declares itself idempotent; a side-effecting one (a send, a write, a build)
 * may or may not have happened, so it is marked failed-unknown and the run
 * fails rather than risk doing it twice. Returns what it did.
 */
export async function recoverRun(runId: string, reason: string): Promise<'resumed' | 'failed' | 'skipped'> {
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  if (!run || !RECOVERABLE.includes(run.status)) return 'skipped';

  const fail = async (why: string) => {
    const updated = await db.update(workflowRuns)
      .set({ status: 'failed', completedAt: new Date(), error: `${reason}; ${why}` })
      .where(and(eq(workflowRuns.id, runId), inArray(workflowRuns.status, RECOVERABLE)))
      .returning({ id: workflowRuns.id });
    return updated.length > 0 ? 'failed' as const : 'skipped' as const;
  };

  if (run.resumeCount >= MAX_AUTO_RESUMES) return fail('already resumed once, not retrying');
  const definition = run.versionId ? await loadPinnedDefinition(run) : null;
  if (!definition) return fail('no pinned version to resume from');

  const executions = await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, runId));
  const typeOf = new Map(definition.nodes.map((n) => [n.id, n.type]));
  const plan = planRecovery(executions, (nodeId) => registry.getDefinition(typeOf.get(nodeId) ?? '')?.idempotent === true);
  if (!plan.ok) {
    for (const nodeId of plan.interrupted) {
      await upsertNodeExecution(runId, nodeId, {
        status: 'failed',
        completedAt: new Date(),
        error: 'interrupted: the process stopped while this step was running. It may or may not have taken effect, so it was not run again.',
      });
    }
    return fail(plan.reason);
  }

  // Claim it: two processes booting against one database must not both resume.
  const claimed = await db.update(workflowRuns)
    .set({ status: 'running', resumeCount: run.resumeCount + 1, heartbeatAt: new Date() })
    .where(and(eq(workflowRuns.id, runId), inArray(workflowRuns.status, RECOVERABLE), eq(workflowRuns.resumeCount, run.resumeCount)))
    .returning({ id: workflowRuns.id });
  if (claimed.length === 0) return 'skipped';
  if (plan.rerun.length > 0) {
    await db.update(nodeExecutions).set({ status: 'pending' })
      .where(and(eq(nodeExecutions.runId, runId), inArray(nodeExecutions.nodeId, plan.rerun)));
  }

  console.warn(`[recover] resuming run ${runId} (${run.status}) with ${Object.keys(plan.seed.outputs).length} step(s) already done`);
  void executeRun({
    runId,
    workflowId: run.workflowId,
    definition,
    input: (run.inputData as Record<string, unknown> | null) ?? {},
    trigger: run.trigger,
    parentRunId: run.parentRunId,
    seed: plan.seed,
    runStartedAt: run.startedAt?.getTime(),
    label: 'recover',
  });
  return 'resumed';
}

/**
 * A sub-workflow child settled. If its parent stopped waiting on it and went to
 * `awaiting_human` (the child paused for a person), hand the outcome back: a
 * completed child resumes the parent with its output, anything else fails the
 * parent's sub-workflow step and the parent with it.
 */
export async function continueParent(parentRunId: string, childRunId: string, result: EngineResult): Promise<void> {
  const [parent] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, parentRunId));
  if (!parent || parent.status !== 'awaiting_human' || !parent.pausedAtNodeId) return;
  const [child] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, childRunId));
  const parentDef = await loadPinnedDefinition(parent);
  const node = parentDef?.nodes.find((n) => n.id === parent.pausedAtNodeId);
  if (!child || node?.type !== 'sub-workflow' || node.config.workflowId !== child.workflowId) return;

  const { childOutcome } = await import('./nodes/sub-workflow');
  const childDef = await loadPinnedDefinition(child);
  const outcome = childDef ? childOutcome(childDef, result) : { status: 'failed' as const, output: {}, error: 'child definition missing' };
  if (outcome.status === 'completed') {
    await resumeRun(parentRunId, { [node.id]: outcome.output });
    return;
  }
  const error = `Sub-workflow ${outcome.status === 'failed' ? 'failed' : 'completed with errors'}: ${outcome.error ?? 'unknown error'}`;
  await upsertNodeExecution(parentRunId, node.id, { status: 'failed', error, completedAt: new Date() });
  await failRun({ workflowId: parent.workflowId, runId: parentRunId, error, label: 'sub-workflow' });
}
