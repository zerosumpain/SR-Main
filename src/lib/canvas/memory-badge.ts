/**
 * Client-side badge text for workflow nodes that read/write persistent memory
 * (the `data-store`, `dedupe` and duplicate-suppressing `whatsapp` nodes).
 * Rendered as a tiny chip under the node's summary line on the canvas so a
 * glance at the graph tells you which nodes remember state across runs — the
 * whole point of the memory rethink.
 *
 * Pure + config-only (no fetch), so it's cheap to call per-node in the card
 * template and trivially unit testable.
 */

import { memoryKeysFor } from './node-memory-keys';

type BadgeNode = { type?: string; config?: Record<string, unknown> | null } | null | undefined;

/**
 * Returns the memory badge label (e.g. `⌘ remembers seen_ids`) for a
 * memory-bearing node, or null for any other node type.
 *
 * Store-key resolution is delegated to `memoryKeysFor` so the chip and the
 * inspector's memory block can never name different keys.
 */
export function memoryBadgeFor(node: BadgeNode): string | null {
  const keys = memoryKeysFor(node);
  if (keys.length === 0) return null;
  return `⌘ remembers ${keys.join(', ')}`;
}
