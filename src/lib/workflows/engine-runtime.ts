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

/**
 * Race a promise against a hard timeout. On timeout we abort the supplied
 * controller (so well-behaved executors can short-circuit) AND reject the
 * race so the caller surfaces a node-level failure even if the executor
 * never observed the abort.
 */
export async function withNodeTimeout<T>(
  nodeId: string,
  nodeType: string,
  timeoutMs: number,
  controller: AbortController,
  fn: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try { controller.abort(); } catch { /* noop */ }
      reject(new NodeTimeoutError(nodeId, nodeType, timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
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
