import { emit } from './worker';
import type { SSEEvent } from './types';

/**
 * Desk artefact event layer.
 *
 * - `nextSeq` gives a monotonic, per-session sequence number used by the client
 *   to order/dedup artefact cards (DB row `id` is the dedup key; `seq` orders).
 * - `emitArtefact` stamps a seq, queues the artefact, and schedules a coalesced
 *   flush on a ~100ms timer so a deep run's hundreds of inserts don't overwhelm
 *   the SSE stream or the client's ~5ms debounced flush.
 * - `flushArtefacts` drains a session's queue immediately.
 *
 * Each queued artefact is emitted as ONE `{ type:'artefact', data:{...} }` SSEEvent
 * (not a batched array), so the client merge-by-id stays trivial. Coalescing here
 * is about *timing*, not payload shape.
 */

const FLUSH_INTERVAL_MS = 100;

type ArtefactType = 'source' | 'fact' | 'entity' | 'relationship';
type Phase = 1 | 2 | 3 | 'post';

interface QueuedArtefact {
  seq: number;
  artefactType: ArtefactType;
  phase: Phase;
  fields: Record<string, unknown> & { id: string };
}

// Monotonic per-session sequence counter.
const seqCounters = new Map<string, number>();
// Per-session pending artefact queue.
const queues = new Map<string, QueuedArtefact[]>();
// Per-session active flush timer (null/absent = no flush scheduled).
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Emit sink — defaults to the real worker emit(), swappable in tests.
type EmitFn = (sessionId: string, event: SSEEvent) => void;
let emitFn: EmitFn = emit;

/** Monotonic per-session counter; first call for a session returns 1. */
export function nextSeq(sessionId: string): number {
  const next = (seqCounters.get(sessionId) ?? 0) + 1;
  seqCounters.set(sessionId, next);
  return next;
}

/**
 * Queue an artefact for coalesced emission. Stamps a fresh `seq`, merges the
 * type-specific `fields` (must include a stable `id` from the `.returning()` row),
 * and schedules a flush ~100ms later if one isn't already pending.
 */
export function emitArtefact(
  sessionId: string,
  artefactType: ArtefactType,
  phase: Phase,
  fields: Record<string, unknown> & { id: string },
): void {
  const seq = nextSeq(sessionId);
  let queue = queues.get(sessionId);
  if (!queue) {
    queue = [];
    queues.set(sessionId, queue);
  }
  queue.push({ seq, artefactType, phase, fields });

  if (!flushTimers.has(sessionId)) {
    const timer = setTimeout(() => {
      flushTimers.delete(sessionId);
      flushArtefacts(sessionId);
    }, FLUSH_INTERVAL_MS);
    flushTimers.set(sessionId, timer);
  }
}

/** Drain a session's queued artefacts immediately, in seq order, one event each. */
export function flushArtefacts(sessionId: string): void {
  const timer = flushTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    flushTimers.delete(sessionId);
  }

  const queue = queues.get(sessionId);
  if (!queue || queue.length === 0) return;
  queues.set(sessionId, []);

  for (const item of queue) {
    emitFn(sessionId, {
      type: 'artefact',
      data: {
        seq: item.seq,
        artefactType: item.artefactType,
        phase: item.phase,
        ...item.fields,
      },
    });
  }
}

/**
 * Dispose all desk-events state for a session.
 *
 * Cancels any pending coalescing timer, flushes remaining queued artefacts
 * (so nothing is silently dropped), then removes the session's entries from
 * both module Maps.  Safe to call when nothing is queued; idempotent.
 */
export function disposeArtefacts(sessionId: string): void {
  // Flush first so callers don't lose in-flight artefacts.
  flushArtefacts(sessionId);
  // flushArtefacts already clears the timer and empties the queue; delete the
  // now-empty queue entry and the seq counter so the Maps don't retain the key.
  queues.delete(sessionId);
  seqCounters.delete(sessionId);
}

// ---- test hooks ----
/** Override the emit sink in tests; pass null to restore the real worker emit(). */
export function __setEmitForTest(fn: EmitFn | null): void {
  emitFn = fn ?? emit;
}

/** Reset all module state (counters, queues, timers) — test isolation. */
export function __resetForTest(): void {
  for (const t of flushTimers.values()) clearTimeout(t);
  seqCounters.clear();
  queues.clear();
  flushTimers.clear();
}
