import { db } from '$lib/db';
import { workflowNodes, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from './types';
import { emitWorkflowEvent, onWorkflowEvent } from './events';

// Idle timeout — if NO workflow events are emitted for this long we assume
// the engine has hung silently inside a node (LLM call with no streaming,
// external HTTP without a timeout, etc). Typical healthy chat runs emit
// token/log events every few ms.
const RUN_IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 min
// Hard cap regardless of activity — a runaway tool-call loop that keeps
// emitting tokens forever shouldn't lock the UI indefinitely.
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

  // Watchdog: the engine can hang silently inside a node (LLM call with
  // no timeout, external HTTP that never returns, etc) with no activity
  // on the event bus. We run BOTH:
  //   - an idle watchdog that resets on every emitted event
  //   - a hard cap as a last resort
  // When either fires we mark the run failed and broadcast run_failed so
  // SSE subscribers close out instead of spinning forever.
  let settled = false;
  let idleWatchdog: ReturnType<typeof setTimeout> | null = null;
  const hardWatchdog = setTimeout(() => fire(
    `Run exceeded max duration (${Math.round(RUN_HARD_TIMEOUT_MS / 1000)}s). A node likely hung — check logs and re-run.`,
  ), RUN_HARD_TIMEOUT_MS);

  function clearAllWatchdogs() {
    clearTimeout(hardWatchdog);
    if (idleWatchdog) clearTimeout(idleWatchdog);
    idleWatchdog = null;
    unsubscribeWatchdog?.();
    unsubscribeWatchdog = null;
  }

  async function fire(message: string) {
    if (settled) return;
    settled = true;
    clearAllWatchdogs();
    console.error(`[${label}] watchdog firing for run ${runId}: ${message}`);
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
  }

  function resetIdleWatchdog() {
    if (idleWatchdog) clearTimeout(idleWatchdog);
    idleWatchdog = setTimeout(
      () => fire(
        `Run idle for ${Math.round(RUN_IDLE_TIMEOUT_MS / 1000)}s with no events — assumed hung.`,
      ),
      RUN_IDLE_TIMEOUT_MS,
    );
  }

  // Subscribe to the run's event bus; ANY event (node_started, token,
  // tool_result, log, etc) counts as liveness and resets the idle timer.
  let unsubscribeWatchdog: (() => void) | null = onWorkflowEvent(runId, (event) => {
    if (event.type === 'run_completed' || event.type === 'run_completed_with_errors' || event.type === 'run_failed') {
      settled = true;
      clearAllWatchdogs();
    } else {
      resetIdleWatchdog();
    }
  });
  resetIdleWatchdog();

  engine
    .execute(definition, runId, initialInput, breakpoints, workflowId, { selfHealing })
    .then(async (result) => {
      settled = true;
      clearAllWatchdogs();
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
      clearAllWatchdogs();
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
