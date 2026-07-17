/**
 * Client-side badge text for workflow nodes that read/write persistent memory
 * (the `data-store` and `dedupe` nodes). Rendered as a tiny chip under the
 * node's summary line on the canvas so a glance at the graph tells you which
 * nodes remember state across runs — the whole point of the memory rethink.
 *
 * Pure + config-only (no fetch), so it's cheap to call per-node in the card
 * template and trivially unit testable.
 */

type BadgeNode = { type?: string; config?: Record<string, unknown> | null } | null | undefined;

/**
 * Returns the memory badge label (e.g. `⌘ remembers seen_ids`) for a
 * memory-bearing node, or null for any other node type.
 *
 * Store-key resolution mirrors the node panels/executors:
 *   - `dedupe`     → `config.storeKey` (defaults to `seen_ids`)
 *   - `data-store` → `config.key` (no default; null when unset)
 */
export function memoryBadgeFor(node: BadgeNode): string | null {
  if (!node) return null;
  const config = (node.config ?? {}) as Record<string, unknown>;

  if (node.type === 'dedupe') {
    const key = String(config.storeKey ?? 'seen_ids').trim() || 'seen_ids';
    return `⌘ remembers ${key}`;
  }

  if (node.type === 'data-store') {
    const key = String(config.key ?? '').trim();
    if (!key) return null;
    return `⌘ remembers ${key}`;
  }

  return null;
}
