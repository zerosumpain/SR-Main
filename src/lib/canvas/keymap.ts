/**
 * Tiny ordered keymap registry for the canvas.
 *
 * A single window keydown listener in the canvas dispatches into one of these.
 * Handlers are run in priority-descending order (registration order breaks
 * ties) until one returns `true` to signal it consumed the event. A handler
 * that returns `false`/`void` lets the dispatch continue to lower-priority
 * handlers — this is how several independent Escape handlers can all still fire
 * on the same key (each does its own work and declines to short-circuit).
 *
 * The module is intentionally window-free so it is unit-testable in isolation.
 */

export type KeymapHandler = (e: KeyboardEvent) => boolean | void;

interface KeymapEntry {
  id: string;
  handler: KeymapHandler;
  priority: number;
  /** Monotonic insertion sequence — stable tie-break for equal priorities. */
  seq: number;
}

export interface Keymap {
  /**
   * Register (or replace, by id) a handler. Returns an unregister function.
   * Re-registering the same id keeps its original insertion sequence so its
   * relative order among equal-priority handlers is stable across re-registers.
   */
  register(id: string, handler: KeymapHandler, opts?: { priority?: number }): () => void;
  /**
   * Dispatch a keydown event through the registry. Returns `true` if some
   * handler consumed it (returned `true`), otherwise `false`.
   */
  handleKeydown(e: KeyboardEvent): boolean;
  /** Number of currently-registered handlers (for tests/introspection). */
  size(): number;
}

export function createKeymap(): Keymap {
  const entries = new Map<string, KeymapEntry>();
  let seqCounter = 0;

  function register(
    id: string,
    handler: KeymapHandler,
    opts?: { priority?: number },
  ): () => void {
    const existing = entries.get(id);
    const seq = existing ? existing.seq : seqCounter++;
    const entry: KeymapEntry = { id, handler, priority: opts?.priority ?? 0, seq };
    entries.set(id, entry);
    // Only remove if this exact registration is still the live one — a stale
    // unregister from a replaced registration must not evict its successor.
    return () => {
      if (entries.get(id) === entry) entries.delete(id);
    };
  }

  function handleKeydown(e: KeyboardEvent): boolean {
    const ordered = [...entries.values()].sort(
      (a, b) => b.priority - a.priority || a.seq - b.seq,
    );
    for (const entry of ordered) {
      if (entry.handler(e) === true) return true;
    }
    return false;
  }

  return { register, handleKeydown, size: () => entries.size };
}
