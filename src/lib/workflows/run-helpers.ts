import { db } from '$lib/db';
import { workflowNodes, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from './types';
import { emitWorkflowEvent } from './events';

// Hard cap on a single workflow run. If engine.execute hasn't resolved by
// this point we assume a node (typically an LLM call or external HTTP)
// has hung, mark the run failed, and emit run_failed so any SSE client
// subscribed to the run unfreezes instead of waiting on keepalives forever.
const RUN_HARD_TIMEOUT_MS = 15 * 60 * 1000; // 15 min

/**
 * Fire a workflow run and persist its results when it resolves.
 *
 * Shared by /api/workflows/[id]/run and /api/workflows/[id]/chat so
 * both paths write node_executions + workflow_runs consistently.
 *
 * Returns immediately; the post-run DB writes happen in a detached
 * promise chain. Errors are logged.
 */
export function runWorkflowAndPersist(
  definition: WorkflowDefinition,
  runId: string,
  initialInput: Record<string, unknown>,
  opts: {
    workflowId: string;
    breakpoints?: Set<string>;
    selfHealing?: boolean;
    label?: string;
  },
): void {
  const { workflowId, breakpoints, selfHealing = true, label = 'run' } = opts;

  // Watchdog: if the engine hangs (e.g. a node's external call never
  // resolves), time out the run, mark it failed, and broadcast
  // run_failed so the SSE stream closes and clients stop spinning.
  let settled = false;
  const watchdog = setTimeout(async () => {
    if (settled) return;
    console.error(
      `[${label}] run ${runId} exceeded ${RUN_HARD_TIMEOUT_MS}ms — forcing failure`,
    );
    const message = `Run exceeded max duration (${Math.round(
      RUN_HARD_TIMEOUT_MS / 1000,
    )}s). A node likely hung — check logs and re-run.`;
    try {
      await db
        .update(workflowRuns)
        .set({ status: 'failed', completedAt: new Date(), error: message })
        .where(eq(workflowRuns.id, runId));
    } catch (err) {
      console.error(`[${label}] failed to persist watchdog timeout`, err);
    }
    emitWorkflowEvent({
      runId,
      timestamp: new Date().toISOString(),
      type: 'run_failed',
      data: { error: message },
    });
  }, RUN_HARD_TIMEOUT_MS);

  engine
    .execute(definition, runId, initialInput, breakpoints, workflowId, { selfHealing })
    .then(async (result) => {
      settled = true;
      clearTimeout(watchdog);
      const healingHistory = result.healingHistory || [];

      try {
        // For awaiting_human: don't set completedAt; persist pausedAtNodeId instead.
        const isPaused = result.status === 'awaiting_human';
        await db
          .update(workflowRuns)
          .set({
            status: result.status,
            completedAt: isPaused ? undefined : new Date(),
            error: result.error || null,
            healingHistory: healingHistory.length > 0 ? healingHistory : undefined,
            ...(isPaused ? { pausedAtNodeId: result.pausedAtNodeId ?? null } : {}),
          })
          .where(eq(workflowRuns.id, runId));

        if (result.status === 'completed' || result.status === 'completed_with_errors') {
          try {
            const { emit } = await import('$lib/workflows/event-bus');
            emit('workflow_completed', { workflowId, runId, status: result.status });
          } catch {
            /* event bus is not critical */
          }
        }

        for (const [nodeId, output] of result.nodeOutputs) {
          const inputData = result.nodeInputs.get(nodeId);
          await db
            .update(nodeExecutions)
            .set({
              status: 'completed',
              inputData: inputData ?? null,
              outputData: output,
              completedAt: new Date(),
            })
            .where(eq(nodeExecutions.nodeId, nodeId));
        }

        for (const [nodeId, error] of result.nodeErrors) {
          await db
            .update(nodeExecutions)
            .set({
              status: 'failed',
              error,
              completedAt: new Date(),
            })
            .where(eq(nodeExecutions.nodeId, nodeId));
        }

        for (const entry of healingHistory) {
          await db
            .update(workflowNodes)
            .set({ config: entry.newConfig })
            .where(eq(workflowNodes.id, entry.nodeId));
        }
      } catch (err) {
        console.error(`[${label}] failed to persist run results (runId=${runId})`, err);
      }
    })
    .catch(async (err) => {
      settled = true;
      clearTimeout(watchdog);
      console.error(`[${label}] workflow execution threw (runId=${runId})`, err);
      const message = err instanceof Error ? err.message : String(err);
      try {
        await db
          .update(workflowRuns)
          .set({
            status: 'failed',
            completedAt: new Date(),
            error: message,
          })
          .where(eq(workflowRuns.id, runId));
      } catch {
        /* swallow */
      }
      // The engine is supposed to emit run_failed itself on thrown errors,
      // but if it didn't (exception before the event layer, or a bug), this
      // guarantees SSE subscribers get a terminal event.
      emitWorkflowEvent({
        runId,
        timestamp: new Date().toISOString(),
        type: 'run_failed',
        data: { error: message },
      });
    });
}
