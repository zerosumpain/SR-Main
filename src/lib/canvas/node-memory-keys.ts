/**
 * Which persistent-memory keys does a workflow node read/write?
 *
 * Every piece of cross-run state in the engine lives in one table,
 * `workflow_data_store`, keyed by `(workflow_id, key)` — never by node id and
 * never by run id. So "this node's memory" is really "the keys this node's
 * config points at", and two nodes can legitimately share one key.
 *
 * Pure + config-only (no fetch), so both the canvas card badge
 * (`memory-badge.ts`) and the node inspector's memory block can resolve keys
 * the same way and never disagree.
 */

type MemoryNode = { type?: string; config?: Record<string, unknown> | null } | null | undefined;

/**
 * The WhatsApp node's duplicate-suppression ring buffer.
 *
 * This is the ONE definition: `src/lib/workflows/nodes/whatsapp.ts` imports it
 * as its `SENT_HASHES_KEY`. Keep it here rather than in the executor so the
 * browser doesn't drag a server-only node module in to learn a string, and so a
 * rename can't leave the inspector displaying and clearing a key nothing writes.
 */
export const WHATSAPP_SENT_HASHES_KEY = '_wa_sent_hashes';

/**
 * Keys something OUTSIDE the workflow engine reads. Clearing one of these
 * doesn't just reset a run — it takes a live surface down until the workflow
 * next writes the key, so the UI warns before offering the button.
 */
const SHARED_MEMORY_KEYS = new Map<string, string>([
  [
    'family_presence_states',
    'Read outside this workflow — /api/family-presence/stats returns 503 without it, and jkai’s family_presence_current tool goes blind until the next run rewrites it.',
  ],
]);

/** Warning text for a key read outside this workflow, or null for a plain key. */
export function sharedMemoryKeyWarning(key: string): string | null {
  return SHARED_MEMORY_KEYS.get(key.trim()) ?? null;
}

/**
 * Store keys a node touches, in the order the panel should show them.
 * Mirrors the executors:
 *   - `dedupe`     → `config.storeKey` (defaults to `seen_ids`)
 *   - `data-store` → `config.key` (no default; empty when unset)
 *   - `whatsapp`   → the hidden `_wa_sent_hashes` ring buffer, but only while
 *                    `suppressDuplicateWindowMins > 0` turns suppression on
 *
 * Keys may be templated (`cursor_{{input.accountId}}`) — they are returned
 * verbatim, never guessed at, because they only resolve at run time.
 */
export function memoryKeysFor(node: MemoryNode): string[] {
  if (!node) return [];
  const config = (node.config ?? {}) as Record<string, unknown>;

  if (node.type === 'dedupe') {
    return [String(config.storeKey ?? 'seen_ids').trim() || 'seen_ids'];
  }

  if (node.type === 'data-store') {
    const key = String(config.key ?? '').trim();
    return key ? [key] : [];
  }

  if (node.type === 'whatsapp') {
    const mins = Number(config.suppressDuplicateWindowMins ?? 0);
    return Number.isFinite(mins) && mins > 0 ? [WHATSAPP_SENT_HASHES_KEY] : [];
  }

  return [];
}
