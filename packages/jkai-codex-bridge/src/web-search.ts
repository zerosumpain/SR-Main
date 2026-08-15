/**
 * Reading Codex's `web_search` items.
 *
 * A pure module on purpose. `codex-runner` imports `@openai/codex-sdk`, which
 * drags in the CLI subprocess wrapper and cannot be loaded in a unit test
 * without the package installed — that is exactly why `errors.test.ts` fails on
 * a machine that has not installed it. Parsing has no such dependency, so it
 * lives here and stays testable.
 *
 * The shape below is NOT in the SDK's typings. `WebSearchItem` is declared as
 * `{ id, type, query }`, but the runtime also carries `action`, and for a page
 * fetch the URL arrives in `query` rather than anything URL-shaped. Verified
 * against SDK 0.147.0 on 2026-08-15.
 */

/**
 * A page or query the model consulted while answering.
 *
 * `fetch` values are the only citations this path produces; `search` values are
 * what makes the answer auditable.
 */
export interface CapturedSearch {
  kind: 'search' | 'fetch';
  /** The query, or the URL when `kind` is 'fetch'. */
  value: string;
}

/** Read a `web_search` item off the event stream, or null if it is not one. */
export function toCapturedSearch(item: unknown): CapturedSearch | null {
  const it = item as { type?: string; query?: unknown } | null;
  if (!it || it.type !== 'web_search') return null;
  const value = typeof it.query === 'string' ? it.query.trim() : '';
  if (!value) return null;
  // Decided on the VALUE, not on `action.type`. Codex reports 'search' for a
  // query and 'other' for a fetch today, but a third action kind would then be
  // filed as a query and rendered as one — whereas a value that starts http is
  // a page however it was reached.
  return { kind: /^https?:\/\//i.test(value) ? 'fetch' : 'search', value };
}

/**
 * Pages the model read, in the shape OpenRouter uses for the same thing.
 *
 * Deliberately the same `url_citation` annotation rather than a bridge-shaped
 * field, so a caller that renders citations from one provider renders them from
 * the other with no branch. Only fetches become citations — a query the model
 * ran is not a source, and listing it as one would put a search string where a
 * reader expects something they can open.
 */
export function toAnnotations(
  searches: CapturedSearch[] | undefined,
): Array<{ type: 'url_citation'; url_citation: { url: string } }> {
  return (searches ?? [])
    .filter((s) => s.kind === 'fetch')
    .map((s) => ({ type: 'url_citation' as const, url_citation: { url: s.value } }));
}
