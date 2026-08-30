/**
 * The rules that shape an edge BEFORE it is stored.
 *
 * Both rules here were conventions honoured by one caller and enforced by
 * nothing, and production shows what that costs.
 *
 * 1. SYMMETRIC EDGES NEED A CANONICAL DIRECTION.
 *
 *    `co_change` means "these two files were edited in the same session", which
 *    is symmetric. `codegraph-backfill.mjs` sorts the pair before emitting it,
 *    with a comment explaining exactly why. The ingest route did not check, and
 *    the unique index is on the ORDERED triple `(source, target, kind)` — so
 *    `(a,b)` and `(b,a)` are two different rows to Postgres and coexist forever.
 *
 *    Measured in production: 408 of 1,410 `co_change` rows — **58%** — were the
 *    mirror of another row, plus 753 mirrored `needs_context` pairs. The cost is
 *    the one the backfill's own comment predicts: `weight` is the observation
 *    count, so a habit seen twice is stored as two rows of weight 1 and ranks
 *    below a genuine single pairing of weight 2. And because `walk()` reads
 *    edges undirected (`source ∈ frontier OR target ∈ frontier`) under a 400-row
 *    cap, each duplicated relationship also burns two slots of that budget.
 *
 *    Enforcing it at the single write point rather than trusting every caller is
 *    the same principle as `retrieve.ts` being the one loader and `familyOf`
 *    being stamped server-side: a rule a caller can disagree with is a rule.
 *
 * 2. NOT EVERY PATH SHOULD CARRY A BEHAVIOURAL EDGE.
 *
 *    A plan document under `docs/superpowers/plans/` names every file its plan
 *    touches, so a session that follows the plan "co-changes" the document with
 *    all of them. That is tautological — the document lists them, it did not
 *    learn anything about them — and every duplicated `co_change` pair sampled
 *    from production was exactly this shape. Markdown stays in the graph as a
 *    node (lessons cite documentation, and that is a real relation) but stops
 *    manufacturing behavioural evidence about code.
 */

/**
 * Edge kinds whose direction carries no meaning.
 *
 * `imports` and `tests` are NOT here and must not be: `a imports b` is a
 * different fact from `b imports a`, and a mutual pair is a real (and
 * interesting) circular dependency rather than a duplicate. Production holds 35
 * such mutual `imports` pairs and they should stay as they are.
 *
 * `needs_context` is symmetric in practice though directional on paper — it
 * means "one was read before the other was edited", and 753 production pairs
 * appear in both directions. Reads treat it as undirected anyway, so storing
 * both halves buys nothing and splits the weight.
 */
export const SYMMETRIC_EDGE_KINDS = new Set(['co_change', 'needs_context']);

export interface EdgeEndpoints {
  source: string;
  target: string;
  kind: string;
  weight?: number;
}

/**
 * Put a symmetric edge into its canonical direction, leaving directional kinds
 * untouched. Ordering is by the raw identifier, which is all that is needed —
 * the rule only has to be TOTAL and STABLE, not meaningful.
 */
export function canonicalEdge<T extends EdgeEndpoints>(edge: T): T {
  if (!SYMMETRIC_EDGE_KINDS.has(edge.kind)) return edge;
  if (edge.source <= edge.target) return edge;
  return { ...edge, source: edge.target, target: edge.source };
}

/**
 * Paths that may take part in `co_change` / `needs_context`.
 *
 * Documentation and plans are excluded: they enumerate the files they describe,
 * so pairing them with those files records the table of contents rather than an
 * observation. Static assets and lockfiles are excluded for the adjacent reason
 * — they change with everything and predict nothing.
 *
 * Deliberately NOT applied to `imports` or `tests`, which are static facts
 * derived from the source itself, nor to node creation: a markdown file cited by
 * a lesson still needs a node to hang that citation on.
 */
export function carriesBehaviouralEdges(path: string | null | undefined): boolean {
  if (!path) return false;
  const p = String(path).trim();
  if (!p) return false;
  if (/\.(md|mdx|txt|json|lock|svg|png|jpe?g|gif|webp|ico|woff2?)$/i.test(p)) return false;
  if (/^docs\//.test(p)) return false;
  if (/^static\//.test(p)) return false;
  if (/(^|\/)package-lock\.json$/.test(p)) return false;
  return true;
}

/**
 * Filter a batch of edges down to the ones worth storing, in canonical form,
 * with within-batch duplicates merged.
 *
 * THE MERGE IS NOT TIDINESS. Canonicalising is what creates the collision:
 * a batch holding both `(a,b)` and `(b,a)` becomes two rows with an identical
 * `(source, target, kind)`, and Postgres rejects that outright —
 * *"ON CONFLICT DO UPDATE command cannot affect row a second time"* — failing
 * the whole insert, not the offending row. So the fix for the mirror problem
 * introduces a hard error unless the halves are summed here first.
 *
 * Summing (rather than taking one) is right because the caller already sends a
 * per-pair TOTAL and the ingest REPLACES rather than adds: two mirrored halves
 * are two partial totals of one relationship, and their sum is the number that
 * should have been stored all along.
 *
 * Self-pairs are dropped here as well as at the DB layer, so a caller that
 * canonicalises first cannot turn a legitimate `(a,b)` into a self-loop.
 */
export function shapeEdges<T extends EdgeEndpoints>(edges: readonly T[]): T[] {
  const merged = new Map<string, T>();
  for (const e of edges) {
    if (!e || e.source === e.target) continue;
    if (
      SYMMETRIC_EDGE_KINDS.has(e.kind) &&
      !(carriesBehaviouralEdges(e.source) && carriesBehaviouralEdges(e.target))
    ) {
      continue;
    }
    const c = canonicalEdge(e);
    const key = `${c.source}\u0000${c.target}\u0000${c.kind}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, c);
      continue;
    }
    merged.set(key, { ...prev, weight: (prev.weight ?? 1) + (c.weight ?? 1) });
  }
  return [...merged.values()];
}
