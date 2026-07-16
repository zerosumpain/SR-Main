/**
 * Pure summariser for a single workflow-data-store row's value, used by the
 * memory-visibility API (GET /api/workflows/[id]/data-store) so the canvas
 * Memory panel can show a compact, bounded preview of every remembered key.
 *
 * Extracted as a pure function so the truncation/item-count behaviour is unit
 * testable without a DB or a route.
 */

/** Preview values are truncated to this many characters (~2KB). */
export const STORE_VALUE_PREVIEW_LIMIT = 2048;

export type StoreValueSummary = {
  /** JSON string preview, sliced to at most `limit` characters. */
  value: string;
  /** True when the underlying value was longer than `limit` and got sliced. */
  truncated: boolean;
  /** Array length when the value is an array, else null. */
  itemCount: number | null;
};

/**
 * Serialise an arbitrary stored value to a bounded JSON-string preview.
 * Non-serialisable values fall back to `String(value)`.
 */
export function summarizeStoreValue(
  value: unknown,
  limit: number = STORE_VALUE_PREVIEW_LIMIT,
): StoreValueSummary {
  const itemCount = Array.isArray(value) ? value.length : null;

  let str: string;
  try {
    // JSON.stringify(undefined) === undefined → fall back to String().
    str = JSON.stringify(value) ?? String(value);
  } catch {
    str = String(value);
  }

  if (str.length > limit) {
    return { value: str.slice(0, limit), truncated: true, itemCount };
  }
  return { value: str, truncated: false, itemCount };
}
