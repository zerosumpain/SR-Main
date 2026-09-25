/**
 * #19 DURABLE RUN-WORKER — the poll loop.
 *
 * ADDITIVE + FEATURE-FLAGGED (`JKAI_RUN_WORKER === '1'`). When the flag is OFF
 * this module is never started; the in-process execute() path is unchanged.
 *
 * Responsibility: claim pending runs from the DB-backed queue (run-queue.ts),
 * execute them via the existing `engine.execute()` (NO engine changes), renew
 * the lease via a heartbeat while a run is in flight, persist results, and clear
 * the lease on completion. Because runs live in the DB, a deploy/restart/OOM of
 * the SvelteKit web process no longer kills in-flight work — the worker is a
 * separate process and any run it doesn't finish (worker crash) becomes
 * re-claimable once its lease expires.
 */

import { executeRun, loadPinnedDefinition } from './start-run';
import { failRun } from './run-finalise';
import {
  claimNext,
  renewLease,
  clearLease,
  releaseExpiredLeases,
  deriveWorkerId,
  DEFAULT_LEASE_MS,
  type ClaimedRun,
} from './run-queue';
import { hostname } from 'os';

const POLL_INTERVAL_MS = Math.max(250, Number(process.env.JKAI_RUN_WORKER_POLL_MS ?? 1000));
const LEASE_MS = Math.max(5_000, Number(process.env.JKAI_RUN_WORKER_LEASE_MS ?? DEFAULT_LEASE_MS));
// Renew the lease at ~1/3 of its duration so a couple of missed beats don't
// drop the claim under another worker.
const RENEW_INTERVAL_MS = Math.max(2_000, Math.round(LEASE_MS / 3));

let running = false;
let stopping = false;
let workerId = '';
let loopPromise: Promise<void> | null = null;

/** Execute one claimed run end-to-end with a lease-renewal heartbeat. */
async function executeClaimed(claimed: ClaimedRun): Promise<void> {
  const { id: runId, workflowId } = claimed;
  // Lease-renewal heartbeat: keeps our claim alive while the run executes.
  const renewTimer = setInterval(() => {
    void renewLease(runId, workerId, LEASE_MS).catch((e) =>
      console.warn(`[run-worker] lease renew failed run=${runId}:`, e instanceof Error ? e.message : e),
    );
  }, RENEW_INTERVAL_MS);

  try {
    // The version pinned when the run was enqueued, not the graph as it is now.
    const def = await loadPinnedDefinition(claimed);
    if (!def) {
      await failRun({ workflowId, runId, error: `workflow ${workflowId} not found`, label: 'run-worker' });
      return;
    }
    // Same kernel as every in-process start path. Note: this process has its
    // own platform bus, so the workflow_completed it emits reaches listeners in
    // the WORKER process only.
    await executeRun({
      runId,
      workflowId,
      definition: def,
      input: claimed.input ?? {},
      trigger: claimed.trigger,
      selfHealing: true,
      label: 'run-worker',
    });
  } catch (err) {
    console.error(`[run-worker] run ${runId} threw:`, err instanceof Error ? err.message : err);
    await failRun({ workflowId, runId, error: err, label: 'run-worker' }).catch(() => {});
  } finally {
    clearInterval(renewTimer);
    await clearLease(runId, workerId).catch(() => {});
  }
}

/** The poll loop. Claims and runs one run per iteration; periodically releases
 *  expired leases so a dead worker's pending claims return to the fleet. */
async function loop(): Promise<void> {
  let sinceSweep = 0;
  while (!stopping) {
    try {
      // Periodic expired-lease sweep (~every 30s worth of idle polls).
      if (sinceSweep++ * POLL_INTERVAL_MS >= 30_000) {
        sinceSweep = 0;
        await releaseExpiredLeases().catch(() => 0);
      }

      const claimed = await claimNext(workerId, LEASE_MS);
      if (!claimed) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      console.log(`[run-worker] ${workerId} claimed run ${claimed.id} (wf=${claimed.workflowId})`);
      await executeClaimed(claimed);
    } catch (err) {
      console.error('[run-worker] loop error:', err instanceof Error ? err.message : err);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Start the run-worker poll loop. Idempotent. Guarded by the caller behind the
 * JKAI_RUN_WORKER flag (and again here as belt-and-braces). Returns immediately;
 * the loop runs until stop().
 */
export function startRunWorker(): void {
  if (process.env.JKAI_RUN_WORKER !== '1') {
    console.log('[run-worker] JKAI_RUN_WORKER !== "1" — not starting (in-process mode)');
    return;
  }
  if (running) return;
  running = true;
  stopping = false;
  workerId = deriveWorkerId(hostname(), process.pid, Math.random().toString(36).slice(2, 10));
  console.log(`[run-worker] starting (workerId=${workerId}, poll=${POLL_INTERVAL_MS}ms, lease=${LEASE_MS}ms)`);
  loopPromise = loop();
}

/**
 * Stop the poll loop and wait for the current iteration to settle. Bounded by
 * the in-flight run; safe to call on shutdown.
 */
export async function stopRunWorker(): Promise<void> {
  if (!running) return;
  stopping = true;
  await loopPromise?.catch(() => {});
  running = false;
  console.log('[run-worker] stopped');
}
