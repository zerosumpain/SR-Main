/**
 * Engine runtime infrastructure: per-node hard timeout, run-level heartbeat,
 * stale-run reaper, and dispatch-time concurrency cap. Pulled out of
 * engine.ts so it stays focused on graph execution.
 */
import { db } from '$lib/db';
import { workflowRuns } from '$lib/db/schema';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

const HEARTBEAT_INTERVAL_MS = 10_000;
const STALE_HEARTBEAT_MS = 5 * 60 * 1000;
const REAPER_INTERVAL_MS = 5 * 60 * 1000;
const ACTIVE_STATUSES = ['running', 'paused', 'pending'] as const;
type ActiveStatus = typeof ACTIVE_STATUSES[number];

const DEFAULT_NODE_TIMEOUT_MS = 5 * 60 * 1000;
const PER_TYPE_TIMEOUT_MS: Record<string, number> = {
  // Site mapping authors a brand-new playbook from scratch via an LLM-driven
  // browser session. The agent-loop budget alone is ~5min; allow 20.
  'site-mapper': 20 * 60 * 1000,
  // Stealth-scrape can chain script-author + retries; same headroom.
  'stealth-scrape': 20 * 60 * 1000,
  // LLM agents may run multi-tool loops with their own internal budgets.
  'llm-agent': 15 * 60 * 1000,
  'deep-research': 20 * 60 * 1000,
  'sub-workflow': 30 * 60 * 1000,
  'interactive-step': 60 * 60 * 1000,
};

export function nodeTimeoutMs(nodeType: string, configOverrideMs?: unknown): number {
  if (typeof configOverrideMs === 'number' && configOverrideMs > 0) return configOverrideMs;
  return PER_TYPE_TIMEOUT_MS[nodeType] ?? DEFAULT_NODE_TIMEOUT_MS;
}

export class NodeTimeoutError extends Error {
  constructor(public readonly nodeId: string, public readonly nodeType: string, public readonly timeoutMs: number) {
    super(`Node ${nodeId} (${nodeType}) timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'NodeTimeoutError';
  }
}

/** Raised when an in-flight node is aborted by run cancellation (#11) rather
 *  than by its own per-node timeout. Surfaces as a node-level failure. */
export class RunAbortedError extends Error {
  constructor(public readonly nodeId: string, public readonly nodeType: string) {
    super(`Node ${nodeId} (${nodeType}) aborted: run cancelled`);
    this.name = 'RunAbortedError';
  }
}

/**
 * Race a promise against a hard timeout. On timeout we abort the supplied
 * controller (so well-behaved executors can short-circuit) AND reject the
 * race so the caller surfaces a node-level failure even if the executor
 * never observed the abort.
 *
 * #11 CANCEL: the race ALSO rejects if `controller` becomes aborted from the
 * outside (run cancellation aborts it). This lets a cancel interrupt a node
 * that ignores its abortSignal, even before its timeout fires. (The timeout
 * path already aborts this same controller, so adding the abort listener
 * changes nothing about the timeout behaviour.)
 */
export async function withNodeTimeout<T>(
  nodeId: string,
  nodeType: string,
  timeoutMs: number,
  controller: AbortController,
  fn: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // If the controller is already aborted before we even start, surface a
  // cancellation immediately rather than launching the executor.
  if (controller.signal.aborted) {
    throw new RunAbortedError(nodeId, nodeType);
  }
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try { controller.abort(); } catch { /* noop */ }
      reject(new NodeTimeoutError(nodeId, nodeType, timeoutMs));
    }, timeoutMs);
  });
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new RunAbortedError(nodeId, nodeType));
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([fn(), timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
  }
}

/** Start a heartbeat timer that pings the run's `heartbeat_at` every
 *  HEARTBEAT_INTERVAL_MS. Returns a `stop()` to clear it. Best-effort: a DB
 *  hiccup logs and keeps trying. */
export function startHeartbeat(runId: string): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await db.update(workflowRuns).set({ heartbeatAt: new Date() }).where(eq(workflowRuns.id, runId));
    } catch (e) {
      console.warn(`[engine-runtime] heartbeat write failed for ${runId}:`, e instanceof Error ? e.message : e);
    }
  };
  // Fire one immediately so a long first node can't trip the reaper.
  void tick();
  const id = setInterval(tick, HEARTBEAT_INTERVAL_MS);
  return () => { stopped = true; clearInterval(id); };
}

/** One pass of the stale-run reaper. Marks runs whose heartbeat is older than
 *  STALE_HEARTBEAT_MS (or never set + startedAt older than the threshold) as
 *  `failed` with an explanatory error. Returns the count of reaped runs. */
export async function reapStaleRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_HEARTBEAT_MS);
  const stale = await db
    .select({ id: workflowRuns.id, status: workflowRuns.status })
    .from(workflowRuns)
    .where(
      and(
        inArray(workflowRuns.status, ACTIVE_STATUSES as unknown as ActiveStatus[]),
        or(
          lt(workflowRuns.heartbeatAt, cutoff),
          and(isNull(workflowRuns.heartbeatAt), lt(workflowRuns.startedAt, cutoff)),
        ),
      ),
    );
  if (stale.length === 0) return 0;
  const ids = stale.map((r) => r.id);
  await db.update(workflowRuns)
    .set({
      status: 'failed',
      completedAt: new Date(),
      error: 'abandoned: heartbeat stale (engine crashed, restarted, or run wedged)',
    })
    .where(inArray(workflowRuns.id, ids));
  console.warn(`[engine-runtime] reaped ${ids.length} stale run(s):`, ids.slice(0, 10).join(', '));
  return ids.length;
}

let reaperStarted = false;
export function startReaper(): void {
  if (reaperStarted) return;
  reaperStarted = true;
  // Boot sweep first — clears anything left behind by the previous process
  // (deploy mid-run, OOM, manual restart). Then a periodic sweep catches
  // anything that wedges later.
  void reapStaleRuns().catch((e) => console.warn('[engine-runtime] boot reap failed:', e));
  setInterval(() => {
    void reapStaleRuns().catch((e) => console.warn('[engine-runtime] periodic reap failed:', e));
  }, REAPER_INTERVAL_MS).unref();
}

/** Concurrency cap. MAX_CONCURRENT_RUNS env var (default 5) gates how many
 *  runs the engine will execute at once. New runs above the cap wait in a
 *  FIFO queue rather than starving a slow runner or piling up. */
const MAX_CONCURRENT_RUNS = Math.max(1, Number(process.env.MAX_CONCURRENT_RUNS ?? 5));
let activeRuns = 0;
const waiters: Array<() => void> = [];

export async function acquireRunSlot(runId: string): Promise<() => void> {
  if (activeRuns >= MAX_CONCURRENT_RUNS) {
    console.log(`[engine-runtime] run ${runId} queued (active=${activeRuns}, cap=${MAX_CONCURRENT_RUNS}, queued=${waiters.length})`);
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  activeRuns++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeRuns--;
    const next = waiters.shift();
    if (next) next();
  };
}

export function getRuntimeStats() {
  return { activeRuns, queued: waiters.length, cap: MAX_CONCURRENT_RUNS };
}

/** Event-loop blockage tracker for the health probe. Reads the maxima from a
 *  perf_hooks histogram so we report the worst stall observed in the last
 *  sampling window. Reset after each read so health reflects current state. */
import { monitorEventLoopDelay, type IntervalHistogram } from 'perf_hooks';

let histogram: IntervalHistogram | undefined;
export function initEventLoopMonitor(): void {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: 50 });
  histogram.enable();
}

export function readEventLoopMaxMs(): number {
  if (!histogram) return 0;
  // .max is in nanoseconds.
  const max = histogram.max / 1_000_000;
  histogram.reset();
  return Math.round(max);
}

// ---------------------------------------------------------------------------
// Long-running batch work: busy is not the same as wedged
// ---------------------------------------------------------------------------
//
// The health probe restarts this service when the event loop stalls past its
// threshold, which is right for a wedged process and wrong for a batch job
// doing real CPU work. The nightly intel sweep is the latter, and the watchdog
// killed it three minutes in — twice — taking the work with it.
//
// Fixing individual hot spots (betweenness now yields) does not settle this:
// any sufficiently heavy stage re-opens it, and the failure mode is a job that
// can never finish. So a batch registers itself and BEATS as it makes progress.
// While a beat is fresh the probe treats a stall as busy rather than broken.
// If the beats stop, the job really is stuck and the restart is correct again —
// which is the distinction the probe could not previously draw.

/** How long a batch may go without a beat before it counts as wedged. */
const BATCH_STALE_MS = 120_000;

interface BatchState {
  name: string;
  phase: string;
  startedAt: number;
  lastBeatAt: number;
}

const batches = new Map<symbol, BatchState>();

export interface BatchHandle {
  /** Record progress. Call between units of work, not inside them. */
  beat(phase?: string): void;
  end(): void;
}

/**
 * Register a long-running batch job. Always pair with `end()` in a `finally`,
 * or the process keeps claiming to be busy after the work has finished.
 */
export function beginBatch(name: string, phase = 'starting'): BatchHandle {
  const key = Symbol(name);
  const now = Date.now();
  batches.set(key, { name, phase, startedAt: now, lastBeatAt: now });
  return {
    beat(nextPhase?: string) {
      const state = batches.get(key);
      if (!state) return;
      state.lastBeatAt = Date.now();
      if (nextPhase) state.phase = nextPhase;
    },
    end() {
      batches.delete(key);
    },
  };
}

export interface BatchReport {
  name: string;
  phase: string;
  runningMs: number;
  sinceBeatMs: number;
  stale: boolean;
}

export function activeBatches(): BatchReport[] {
  const now = Date.now();
  return [...batches.values()].map((b) => ({
    name: b.name,
    phase: b.phase,
    runningMs: now - b.startedAt,
    sinceBeatMs: now - b.lastBeatAt,
    stale: now - b.lastBeatAt > BATCH_STALE_MS,
  }));
}

/**
 * True when a stall should be read as work rather than a fault: at least one
 * batch is registered and still beating. A batch that has stopped beating does
 * NOT suppress anything — that is exactly the case the watchdog exists for.
 */
export function isBusyWithLiveBatch(): boolean {
  return activeBatches().some((b) => !b.stale);
}

/**
 * Name the phase that was running when the loop stalled.
 *
 * The first blocker here (synchronous betweenness) took a benchmark to find
 * because nothing recorded what the process was doing at the time. This turns
 * the next one into a log line instead of an investigation.
 */
const BLOCK_LOG_THRESHOLD_MS = 2_000;
const SAMPLE_MS = 1_000;
let sampler: ReturnType<typeof setInterval> | null = null;

export function startBlockReporter(): void {
  if (sampler) return;
  let expected = Date.now() + SAMPLE_MS;
  sampler = setInterval(() => {
    const now = Date.now();
    const drift = now - expected;
    expected = now + SAMPLE_MS;
    if (drift < BLOCK_LOG_THRESHOLD_MS) return;
    const busy = activeBatches();
    const where = busy.length
      ? busy.map((b) => `${b.name}:${b.phase} (${Math.round(b.runningMs / 1000)}s in)`).join(', ')
      : 'no batch registered';
    console.warn(`[runtime] event loop blocked ~${drift}ms during ${where}`);
  }, SAMPLE_MS);
  sampler.unref?.();
}

export function stopBlockReporter(): void {
  if (sampler) clearInterval(sampler);
  sampler = null;
}
