// src/lib/canvas/intelligence/desk/coalesce.ts
//
// makeCoalescer — trailing debounce with a hard max-wait.
//
// Calling schedule() resets an idle timer; fn fires after idleMs of quiet.
// If schedule() keeps being called, fn fires at most every maxMs regardless
// (latency bound: prevents unbounded delay on a heavy streaming run).
//
// API:
//   schedule()  — arm/re-arm the idle timer; starts the max-wait on first call
//   flushNow()  — call fn immediately, cancel any pending timers
//   cancel()    — cancel pending timers without calling fn
//
// IMPORTANT: all timer handles are plain `let` variables — NOT $state —
// so they can safely be read from inside scheduling callbacks without
// triggering Svelte reactivity loops.

export interface Coalescer {
  schedule(): void;
  flushNow(): void;
  cancel(): void;
}

export interface CoalescerOptions {
  /** Milliseconds of idle before the trailing flush fires. */
  idleMs: number;
  /** Hard cap: force a flush after this many ms even if schedule() keeps being called. */
  maxMs: number;
}

export function makeCoalescer(
  { idleMs, maxMs }: CoalescerOptions,
  fn: () => void,
): Coalescer {
  // Plain let — NOT $state — so these can be read inside timer callbacks
  // without re-triggering effects.
  let idleHandle: ReturnType<typeof setTimeout> | null = null;
  let maxHandle: ReturnType<typeof setTimeout> | null = null;

  function clearAll() {
    if (idleHandle !== null) {
      clearTimeout(idleHandle);
      idleHandle = null;
    }
    if (maxHandle !== null) {
      clearTimeout(maxHandle);
      maxHandle = null;
    }
  }

  function doFlush() {
    clearAll();
    fn();
  }

  function schedule() {
    // Always reset the idle (trailing) timer.
    if (idleHandle !== null) {
      clearTimeout(idleHandle);
    }
    idleHandle = setTimeout(doFlush, idleMs);

    // Only start the max-wait timer once per "burst" (first schedule() after
    // a flush or after cancel). When it fires it resets itself so the next
    // burst gets a fresh maxMs window.
    if (maxHandle === null) {
      maxHandle = setTimeout(doFlush, maxMs);
    }
  }

  function flushNow() {
    clearAll();
    fn();
  }

  function cancel() {
    clearAll();
  }

  return { schedule, flushNow, cancel };
}
