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

import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from './types';
import { isDisplayOnlyType } from './types';
import { emitObs } from './observability-bus';
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

/** The worker id for this process (set on start). Exported for diagnostics. */
export function getWorkerId(): string {
  return workerId;
}

/** Build a runnable WorkflowDefinition from the persisted nodes/edges. Mirrors
 *  the scheduler / run-route shaping so the worker executes identically. */
async function loadDefinition(workflowId: string): Promise<WorkflowDefinition | null> {
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  if (!workflow) return null;

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, workflowId));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId));

  const runnableNodes = nodes.filter((n) => !isDisplayOnlyType(n.type));
  const runnableEdges = edges.filter((e) => {
    const src = runnableNodes.find((n) => n.id === e.sourceNodeId);
    const tgt = runnableNodes.find((n) => n.id === e.targetNodeId);
    return src && tgt;
  });

  return {
    id: workflowId,
    name: workflow.name,
    nodes: runnableNodes.map((n) => ({
      id: n.id,
      type: n.type,
      config: (n.config as Record<string, unknown>) ?? {},
      label: n.label ?? n.type,
      position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
    })),
    edges: runnableEdges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
    })),
  };
}

/** Ensure pending node_executions rows exist for the run (idempotent — the
 *  enqueuing route/scheduler already creates them; this is a safety net for
 *  runs enqueued without them). */
async function ensureNodeExecutions(runId: string, def: WorkflowDefinition): Promise<void> {
  const existing = await db
    .select({ nodeId: nodeExecutions.nodeId })
    .from(nodeExecutions)
    .where(eq(nodeExecutions.runId, runId));
  const have = new Set(existing.map((r) => r.nodeId));
  for (const node of def.nodes) {
    if (!have.has(node.id)) {
      await db.insert(nodeExecutions).values({ runId, nodeId: node.id, status: 'pending' });
    }
  }
}

/** Persist a settled run result. Mirrors scheduler/run-route persistence. */
async function persistResult(
  claimed: ClaimedRun,
  result: Awaited<ReturnType<typeof engine.execute>>,
  runStartedAt: number,
): Promise<void> {
  const { id: runId, workflowId } = claimed;
  const isPaused = result.status === 'awaiting_human';
  const completedAt = isPaused ? undefined : new Date();
  const healingHistory = result.healingHistory || [];

  await db
    .update(workflowRuns)
    .set({
      status: result.status,
      completedAt,
      error: result.error ?? null,
      healingHistory: healingHistory.length > 0 ? healingHistory : undefined,
      ...(isPaused ? { pausedAtNodeId: result.pausedAtNodeId ?? null } : {}),
    })
    .where(eq(workflowRuns.id, runId));

  for (const [nodeId, output] of result.nodeOutputs) {
    const inputData = result.nodeInputs.get(nodeId);
    const usage = result.nodeUsage.get(nodeId);
    await db
      .update(nodeExecutions)
      .set({
        status: 'completed',
        startedAt: result.nodeStartTimes.get(nodeId) ?? undefined,
        inputData: inputData ?? null,
        outputData: output,
        completedAt: new Date(),
        ...(usage ?? {}),
      })
      .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.nodeId, nodeId)));
  }

  for (const [nodeId, error] of result.nodeErrors) {
    const usage = result.nodeUsage.get(nodeId);
    await db
      .update(nodeExecutions)
      .set({
        status: 'failed',
        startedAt: result.nodeStartTimes.get(nodeId) ?? undefined,
        error,
        completedAt: new Date(),
        ...(usage ?? {}),
      })
      .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.nodeId, nodeId)));
  }

  for (const entry of healingHistory) {
    await db.update(workflowNodes).set({ config: entry.newConfig }).where(eq(workflowNodes.id, entry.nodeId));
  }

  const done = new Date();
  if (result.status === 'failed') {
    emitObs('run.failed', { workflowId, runId, error: result.error ?? 'run failed', completedAt: done.toISOString() });
  } else if (!isPaused) {
    emitObs('run.completed', {
      workflowId,
      runId,
      status: result.status as 'completed' | 'completed_with_errors',
      completedAt: done.toISOString(),
      durationMs: done.getTime() - runStartedAt,
    });
  }
}

/** Execute one claimed run end-to-end with a lease-renewal heartbeat. */
async function executeClaimed(claimed: ClaimedRun): Promise<void> {
  const { id: runId, workflowId } = claimed;
  const runStartedAt = Date.now();

  // Lease-renewal heartbeat: keeps our claim alive while the run executes.
  const renewTimer = setInterval(() => {
    void renewLease(runId, workerId, LEASE_MS).catch((e) =>
      console.warn(`[run-worker] lease renew failed run=${runId}:`, e instanceof Error ? e.message : e),
    );
  }, RENEW_INTERVAL_MS);

  try {
    const def = await loadDefinition(workflowId);
    if (!def) {
      await db
        .update(workflowRuns)
        .set({ status: 'failed', completedAt: new Date(), error: `workflow ${workflowId} not found` })
        .where(eq(workflowRuns.id, runId));
      return;
    }
    await ensureNodeExecutions(runId, def);

    emitObs('run.started', {
      workflowId,
      runId,
      trigger: (claimed.trigger as 'manual' | 'scheduled' | 'event') ?? 'manual',
      startedAt: new Date(runStartedAt).toISOString(),
    });

    const result = await engine.execute(def, runId, {}, undefined, workflowId, { selfHealing: true });
    await persistResult(claimed, result, runStartedAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[run-worker] run ${runId} threw:`, message);
    try {
      await db
        .update(workflowRuns)
        .set({ status: 'failed', completedAt: new Date(), error: message })
        .where(eq(workflowRuns.id, runId));
    } catch {
      /* swallow */
    }
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
