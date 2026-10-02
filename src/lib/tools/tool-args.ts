/**
 * Argument coercion for LLM-callable site tools.
 *
 * `String(args.name)` on a missing key yields the literal string "undefined",
 * which then flows into a WHERE clause and matches nothing — the handler
 * reports that the *record* doesn't exist rather than that the *call* was
 * malformed. That happened three times in one turn on 2026-08-09, when the
 * model passed `{id}` to a tool keyed on `name`.
 *
 * Same shape as the in-repo precedent in `tools/gmail.ts`: coerce, trim,
 * and return a `success: false` the model can act on.
 */
export function requiredString(
  args: Record<string, unknown>,
  key: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const raw = args[key];
  if (raw === undefined || raw === null) {
    return { ok: false, error: `${key} is required` };
  }
  const value = String(raw).trim();
  // "undefined"/"null" reaching us as text means the caller stringified a
  // missing value somewhere upstream. Treat it as absent, not as a name.
  if (!value || value === 'undefined' || value === 'null') {
    return { ok: false, error: `${key} is required` };
  }
  return { ok: true, value };
}

/** Optional string, trimmed, with the same "undefined"-as-text guard. */
export function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).trim();
  if (!value || value === 'undefined' || value === 'null') return undefined;
  return value;
}
