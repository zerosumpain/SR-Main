// src/lib/utils/title-similarity.ts
//
// PURE, no imports. The one definition of "these two titles read as the same
// claim", moved out of `$lib/daydream/refutations` (which imports `$lib/db`)
// and down into `$lib/utils` so that the improvement backlog's intake dedup
// and `createChangeRequest`'s dedup use the SAME arithmetic the think loop's
// `liveEchoOf` does, without `$lib/jkai` importing `$lib/daydream` or
// `$lib/selfimprove` (both already import it) — a second definition of
// "the same idea" is how two producers end up queueing one idea twice.

/**
 * Trigram similarity of two titles, 0..1 (Jaccard over character trigrams
 * of the lower-cased letters and digits). In code rather than `pg_trgm` so
 * it costs one query for the live rows and no round trip per candidate, and
 * so the threshold is testable.
 */
export function titleSimilarity(a: string, b: string): number {
  const grams = (t: string): Set<string> => {
    const clean = ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
    const out = new Set<string>();
    for (let i = 0; i + 3 <= clean.length; i++) out.add(clean.slice(i, i + 3));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return shared / (ga.size + gb.size - shared);
}

/** Two musings whose titles read as one claim. 0.6 is where "A clear window
 *  before school resumes" and "A clear window before the school term" meet
 *  and "A clear window" and "A clear diary" do not. */
export const TITLE_ECHO_SIMILARITY = 0.6;
