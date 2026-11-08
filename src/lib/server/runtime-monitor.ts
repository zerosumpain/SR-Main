/**
 * Process runtime telemetry: event-loop stall tracking and live batch
 * reporting for the health probe and heartbeat. Workflow runs execute in
 * SR-Workflows; Main no longer runs nodes, reaps runs or holds run slots.
 */

/** Main executes no workflow runs; the shape is kept for the pulse and
 *  engine-probe readers. */
export function getRuntimeStats() {
  return { activeRuns: 0, queued: 0, cap: 0 };
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
