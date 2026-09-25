import { db } from '$lib/db';
import { workflowRuns, nodeExecutions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { emit as emitPlatformEvent, runChainDepth, clearRunChainDepth } from '$lib/events/platform-bus';
import type { EngineResult } from './engine';
import { emitObs } from './observability-bus';

/**
 * The ONE place a settled run is written down and announced.
 *
 * Every start path — the manual run route, run-helpers (chat + single-node
 * re-run), the scheduler, the run-worker, the webhook route, the platform event
 * bus, the gmail and whatsapp dispatchers, and engine-resume — used to carry its
 * own copy of this. The copies had drifted:
 *
 * - only two of them emitted `workflow_completed`, so a scheduled, webhook or
 *   event-started run could never trigger a chained workflow or deliver to a
 *   subscribed build;
 * - four never saved `pausedAtNodeId`, so a run started by a schedule, webhook
 *   or event that hit an approval could not be resumed;
 * - three wrote every self-heal straight back to the saved node config — a
 *   model's guess silently becoming the workflow. Heals are PROPOSALS now
 *   (fix-proposals.server), recorded here and applied only by the owner.
 *
 * Each step is best-effort: a DB hiccup persisting node rows must not stop the
 * run's terminal status being written or the completion being announced.
 */

export interface FinaliseRunInput {
  workflowId: string;
  runId: string;
  result: EngineResult;
  /** Wall-clock ms the run began, for the obs duration. */
  runStartedAt: number;
  /** Resume path: nodes whose outputs were seeded (already persisted). */
  seededNodeIds?: ReadonlySet<string>;
  /**
   * How many `workflow_completed` hops led to this run. An event-started run
   * passes the depth of the event that started it, plus one, so a chain of
   * workflows triggering each other stops (see event-bus MAX_CHAIN_DEPTH).
   */
  chainDepth?: number;
  /** Log prefix. */
  label?: string;
}

type NodeExecFields = Partial<typeof nodeExecutions.$inferInsert>;

/**
 * Write one node's execution row, creating it when the start path never
 * pre-created one. The manual route and the scheduler insert `pending` rows up
 * front; the webhook, event, gmail and whatsapp paths never did — which is why a
 * run they started kept no node outputs, and so had nothing for engine-resume to
 * seed from.
 */
export async function upsertNodeExecution(runId: string, nodeId: string, fields: NodeExecFields): Promise<void> {
  const updated = await db
    .update(nodeExecutions)
    .set(fields)
    .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.nodeId, nodeId)))
    .returning({ id: nodeExecutions.id });
  if (updated.length > 0) return;
  await db.insert(nodeExecutions).values({ status: 'pending', ...fields, runId, nodeId });
}

async function persistNodeRows(input: FinaliseRunInput): Promise<void> {
  const { runId, result, seededNodeIds } = input;
  const seeded = seededNodeIds ?? new Set<string>();
  const handles = result.nodeSelectedHandles ?? new Map<string, string>();

  for (const [nodeId, output] of result.nodeOutputs) {
    if (seeded.has(nodeId)) continue;
    await upsertNodeExecution(runId, nodeId, {
      status: 'completed',
      startedAt: result.nodeStartTimes.get(nodeId) ?? undefined,
      inputData: result.nodeInputs.get(nodeId) ?? null,
      outputData: output,
      selectedHandle: handles.get(nodeId) ?? null,
      completedAt: new Date(),
      ...(result.nodeUsage.get(nodeId) ?? {}),
    });
  }

  for (const [nodeId, error] of result.nodeErrors) {
    if (seeded.has(nodeId)) continue;
    await upsertNodeExecution(runId, nodeId, {
      status: 'failed',
      startedAt: result.nodeStartTimes.get(nodeId) ?? undefined,
      // The input it failed on — what a single-node re-run retries with.
      inputData: result.nodeInputs.get(nodeId) ?? null,
      selectedHandle: handles.get(nodeId) ?? null,
      error,
      completedAt: new Date(),
      ...(result.nodeUsage.get(nodeId) ?? {}),
    });
  }

  // The paused node has no output yet, but engine-resume needs the input it
  // paused on to build its output from the human's resolution.
  const pausedId = result.status === 'awaiting_human' ? result.pausedAtNodeId : undefined;
  if (pausedId && !result.nodeOutputs.has(pausedId)) {
    await upsertNodeExecution(runId, pausedId, {
      startedAt: result.nodeStartTimes.get(pausedId) ?? undefined,
      inputData: result.nodeInputs.get(pausedId) ?? null,
    });
  }
}

export async function finaliseRun(input: FinaliseRunInput): Promise<void> {
  const { workflowId, runId, result, runStartedAt, label = 'run' } = input;
  const healingHistory = result.healingHistory ?? [];
  const isPaused = result.status === 'awaiting_human';
  const completedAt = isPaused ? undefined : new Date();

  try {
    await db
      .update(workflowRuns)
      .set({
        status: result.status,
        completedAt,
        error: result.error || null,
        healingHistory: healingHistory.length > 0 ? healingHistory : undefined,
        ...(isPaused ? { pausedAtNodeId: result.pausedAtNodeId ?? null } : {}),
      })
      .where(eq(workflowRuns.id, runId));
  } catch (err) {
    console.error(`[${label}] failed to persist run status (runId=${runId})`, err);
  }

  try {
    await persistNodeRows(input);
  } catch (err) {
    console.error(`[${label}] failed to persist node executions (runId=${runId})`, err);
  }

  // Never a write to workflow_nodes: a heal that worked is a proposal.
  if (healingHistory.some((e) => e.retrySucceeded)) {
    try {
      const { recordFixProposalsFromHealing } = await import('./fix-proposals.server');
      await recordFixProposalsFromHealing(workflowId, runId, healingHistory);
    } catch (err) {
      console.error(`[${label}] failed to record fix proposals (runId=${runId})`, err);
    }
  }

  if (completedAt && result.status === 'failed') {
    emitObs('run.failed', {
      workflowId,
      runId,
      error: result.error ?? 'run failed',
      completedAt: completedAt.toISOString(),
    });
  } else if (completedAt) {
    emitObs('run.completed', {
      workflowId,
      runId,
      status: result.status as 'completed' | 'completed_with_errors',
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - runStartedAt,
    });
  }

  // Last, so a subscriber reading node_executions sees this run's outputs. The
  // run is the event's origin, so it can never trigger itself.
  const chainDepth = input.chainDepth ?? runChainDepth(runId);
  if (!isPaused) clearRunChainDepth(runId);
  if (result.status === 'completed' || result.status === 'completed_with_errors') {
    emitPlatformEvent(
      'workflow.completed',
      { workflowId, runId, status: result.status },
      { source: 'run-finalise', chainDepth, originWorkflowId: workflowId },
    );
  }
}

/**
 * The thrown-error half: the engine is supposed to resolve with
 * `status:'failed'` rather than throw, but a start path that catches anyway
 * records it the same way everywhere.
 */
export async function failRun(opts: { workflowId: string; runId: string; error: unknown; label?: string }): Promise<void> {
  const { workflowId, runId, label = 'run' } = opts;
  const message = opts.error instanceof Error ? opts.error.message : String(opts.error);
  const failedAt = new Date();
  try {
    await db
      .update(workflowRuns)
      .set({ status: 'failed', completedAt: failedAt, error: message })
      .where(eq(workflowRuns.id, runId));
  } catch (err) {
    console.error(`[${label}] failed to persist run failure (runId=${runId})`, err);
  }
  emitObs('run.failed', { workflowId, runId, error: message, completedAt: failedAt.toISOString() });
}
