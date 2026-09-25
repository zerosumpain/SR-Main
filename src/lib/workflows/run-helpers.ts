import { db } from '$lib/db';
import { workflowRuns } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
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
 * Watchdogs for an interactive run (canvas chat, single-node re-run, the
 * `workflow_run` tool): an idle timer reset by every event on the run's bus,
 * and a hard cap. When either fires the run is marked failed and `run_failed`
 * is broadcast so SSE subscribers close out instead of spinning forever.
 * Returns the disarm function the run kernel calls when the run settles.
 */
export function armRunWatchdog(runId: string, label = 'run'): () => void {
  let settled = false;
  let idle: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  const hard = setTimeout(() => fire(
    `Run exceeded max duration (${Math.round(RUN_HARD_TIMEOUT_MS / 1000)}s). A node likely hung — check logs and re-run.`,
  ), RUN_HARD_TIMEOUT_MS);

  function disarm() {
    settled = true;
    clearTimeout(hard);
    if (idle) clearTimeout(idle);
    idle = null;
    unsubscribe?.();
    unsubscribe = null;
  }

  async function fire(message: string) {
    if (settled) return;
    disarm();
    console.error(`[${label}] watchdog firing for run ${runId}: ${message}`);
    try {
      await db.update(workflowRuns).set({ status: 'failed', completedAt: new Date(), error: message }).where(eq(workflowRuns.id, runId));
    } catch (err) {
      console.error(`[${label}] failed to persist watchdog timeout`, err);
    }
    emitWorkflowEvent({ runId, timestamp: new Date().toISOString(), type: 'run_failed', data: { error: message } });
  }

  function resetIdle() {
    if (idle) clearTimeout(idle);
    idle = setTimeout(
      () => fire(`Run idle for ${Math.round(RUN_IDLE_TIMEOUT_MS / 1000)}s with no events — assumed hung.`),
      RUN_IDLE_TIMEOUT_MS,
    );
  }

  // ANY event on the run's bus (node_started, token, tool_result, log…) is liveness.
  unsubscribe = onWorkflowEvent(runId, (event) => {
    if (event.type === 'run_completed' || event.type === 'run_completed_with_errors' || event.type === 'run_failed') disarm();
    else resetIdle();
  });
  resetIdle();
  return disarm;
}
