// The only DB-aware part of the analytics layer.
//
// Loads the whole graph once and caches it briefly. Every analytic view
// (centrality, communities, surprising links, insights, path finding) wants the
// SAME snapshot, and recomputing Louvain plus Brandes per request would be both
// wasteful and inconsistent — two panels on one page could disagree about which
// cluster something is in. One cached snapshot per short window makes the whole
// dashboard coherent.
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import type { GraphSnapshot, GraphNode, GraphEdge, AdjacencyIndex } from './model';
import { buildIndex } from './model';
import { computeCentrality, type CentralityScores } from './centrality';
import { detectCommunities, type CommunityResult } from './community';
import { channelArtefactIds } from '../channel-artefacts';

export interface GraphAnalysis {
  snapshot: GraphSnapshot;
  index: AdjacencyIndex;
  centrality: CentralityScores;
  community: CommunityResult;
  /**
   * node id → embedding, only for entities that have one.
   *
   * EMPTY until `ensureEmbeddings(analysis)` has been awaited. Only the surprise
   * scorer reads these, and loading them is not cheap: 5,338 entities is ~87 MB
   * of `vector::text` and ~1.9 s of query plus float parsing, which every cold
   * analysis was paying — including the graph request, which never looks at
   * them. Filled in on demand and kept on the cached analysis, so the insights
   * panel pays it once per snapshot and the graph never pays it at all.
   */
  embeddings: Map<string, number[]>;
  /**
   * Pairs the user has explicitly said are NOT related, as `min|max` id keys.
   *
   * Held apart from the graph rather than in it. A suppressed edge must not be
   * drawn, counted in a degree, or walked by path finding — so it is excluded
   * from the snapshot — but the missing-link predictor still has to know about
   * it, or every rejected prediction is proposed again on the next run and
   * rejecting one achieves nothing.
   */
  suppressedPairs: Set<string>;
  computedAt: number;
}

/** Stable order-independent key for an unordered pair of entity ids. */
export function pairKeyFor(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * How long a computed analysis is reused. Long enough that clicking between
 * dashboard tabs is instant, short enough that a note added a minute ago shows
 * up without a restart.
 */
const TTL_MS = 60_000;

/**
 * One cache per variant. The analysed graph excludes channel artefacts; the
 * `withArtefacts` variant exists only so a surface can SHOW them on request,
 * and keying them separately is what stops a request for the display variant
 * poisoning the analytic one for the rest of the TTL.
 */
const cached = new Map<string, GraphAnalysis>();
const inflight = new Map<string, Promise<GraphAnalysis>>();
const variantKey = (includeArtefacts: boolean) => (includeArtefacts ? 'with-artefacts' : 'analysed');
/**
 * Bumped on every invalidation. A computation that started before the bump is
 * reading pre-write data, so it must not install itself as the cache when it
 * finishes — otherwise a merge landing mid-computation would be papered over by
 * a stale snapshot for the whole TTL.
 */
let generation = 0;

/** Drop the cache — call after any write that changes the graph. */
export function invalidateGraphAnalysis(): void {
  cached.clear();
  generation++;
}

/**
 * Normalise the two shapes these columns come back in — `aliases` is jsonb (an
 * array, or a JSON string when the driver hands it back unparsed) and
 * `categories` is a real text[] built by ARRAY_AGG.
 */
function toStringArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseVector(raw: unknown): number[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw.map(Number).filter((n) => Number.isFinite(n));
  if (typeof raw !== 'string') return null;
  const body = raw.trim().replace(/^\[|\]$/g, '');
  if (!body) return null;
  const out = body.split(',').map(Number);
  return out.every((n) => Number.isFinite(n)) ? out : null;
}

async function loadSnapshot(includeArtefacts: boolean): Promise<{
  snapshot: GraphSnapshot;
  suppressedPairs: Set<string>;
}> {
  // Channel artefacts are excluded HERE and nowhere else.
  //
  // This is the one place the whole analytics layer gets its data — clustering,
  // centrality, insights, path finding and the cluster roster all read the
  // snapshot this returns — so gating here covers every one of them by
  // construction. A flag honoured in six places is a flag that will be
  // forgotten in the seventh.
  const artefacts = includeArtefacts ? new Set<string>() : await channelArtefactIds();

  // Merged entities are excluded: they are aliases resolved into a survivor and
  // would otherwise show as duplicate nodes.
  const entityRes = await db.execute(sql`
    SELECT
      e.id,
      e.name,
      e.type_id,
      COALESCE(t.name, 'unknown')   AS type_name,
      COALESCE(t.icon, '🔷')        AS icon,
      COALESCE(t.color, '#7dd3fc')  AS color,
      e.summary,
      e.confidence,
      e.confidence_score,
      e.confirmed,
      e.created_at,
      e.updated_at,
      e.aliases                     AS aliases,
      COALESCE(ne.note_count, 0)    AS note_count,
      ne.last_seen_at,
      COALESCE(ne.categories, ARRAY[]::text[]) AS categories,
      COALESCE(ne.sources, ARRAY[]::text[])    AS sources,
      -- Where the entity was FIRST seen, which is provenance the join below
      -- cannot see. An entity extracted from a deep dive or a chat thread often
      -- has no intel_note_entities row at all — 561 of 4,737 on 2026-08-05 —
      -- and was therefore reported as having no source whatsoever. Since the
      -- source filter keeps sourceless entities (so the picker cannot silently
      -- delete history), every one of them surfaced under EVERY source: asking
      -- for 'email' returned entities whose only footprint was a research note.
      fsn.source                    AS first_seen_source,
      fsn.created_at                AS first_seen_at
    FROM intel_entities e
    LEFT JOIN intel_entity_types t ON t.id = e.type_id
    LEFT JOIN intel_notes fsn ON fsn.id = e.first_seen_in
    LEFT JOIN (
      -- ER categories are set per SOURCE, so an entity carries the union of the
      -- categories of every note asserting it: filtering on 'work' returns
      -- everything work ever told us about. The lateral expansion multiplies
      -- rows, hence COUNT(DISTINCT note_id) rather than COUNT(*).
      --
      -- Sources are unioned for the same reason and aggregated here rather
      -- than in a second query: the lateral join over categories already
      -- multiplies rows, so a naive ARRAY_AGG(n.source) elsewhere would count
      -- one note once per category it carries. DISTINCT covers that.
      SELECT ne.entity_id,
             COUNT(DISTINCT ne.note_id)::int AS note_count,
             -- observed_at where the note knows when the thing it describes
             -- actually happened, created_at only as a fallback. The two are
             -- very different for correspondence: every email note is written on
             -- the night its sweep runs, so dating evidence by created_at makes
             -- an eleven-week-old thread exactly as fresh as this morning's.
             MAX(COALESCE(n.observed_at, n.created_at)) AS last_seen_at,
             ARRAY_AGG(DISTINCT cat.value) FILTER (WHERE cat.value IS NOT NULL) AS categories,
             ARRAY_AGG(DISTINCT n.source)   FILTER (WHERE n.source IS NOT NULL) AS sources
      FROM intel_note_entities ne
      JOIN intel_notes n ON n.id = ne.note_id
      LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(n.categories, '[]'::jsonb))
        AS cat(value) ON TRUE
      GROUP BY ne.entity_id
    ) ne ON ne.entity_id = e.id
    WHERE e.merged_into_id IS NULL
  `);

  const nodes: GraphNode[] = (entityRes.rows as Array<Record<string, unknown>>)
    .filter((r) => !artefacts.has(String(r.id)))
    .map((r) => {
    const id = String(r.id);
    const created = r.created_at ? new Date(String(r.created_at)).getTime() : 0;
    const updated = r.updated_at ? new Date(String(r.updated_at)).getTime() : created;
    // Unioned, not substituted: an entity first seen in a deep dive and since
    // corroborated by email belongs to BOTH, and the source picker should find
    // it under either. Only entities with no note links at all gain a source
    // they did not have before.
    const firstSeenSource = r.first_seen_source == null ? null : String(r.first_seen_source);
    const sources = toStringArray(r.sources);
    if (firstSeenSource && !sources.includes(firstSeenSource)) sources.push(firstSeenSource);
    // Same reasoning for the clock: an entity whose only evidence is the note it
    // was extracted from is as old as that note, not as old as `created_at`
    // happens to be. Staleness and anything ranking on age read this.
    const firstSeenAt = r.first_seen_at ? new Date(String(r.first_seen_at)).getTime() : 0;
    return {
      id,
      name: String(r.name ?? ''),
      typeId: String(r.type_id ?? ''),
      typeName: String(r.type_name ?? 'unknown'),
      icon: String(r.icon ?? '🔷'),
      color: String(r.color ?? '#7dd3fc'),
      summary: r.summary == null ? null : String(r.summary),
      confidence: String(r.confidence ?? 'medium'),
      confidenceScore: r.confidence_score == null ? null : Number(r.confidence_score),
      confirmed: Boolean(r.confirmed),
      createdAt: created,
      updatedAt: updated,
      noteCount: Number(r.note_count ?? 0),
      lastSeenAt: r.last_seen_at
        ? new Date(String(r.last_seen_at)).getTime()
        : firstSeenAt || created,
      // Provisional: raised to the newest incident edge observation once the
      // edges are loaded, below.
      evidenceAt: 0,
      aliases: toStringArray(r.aliases),
      categories: toStringArray(r.categories),
      sources,
    };
  });

  // Relationships whose endpoints were merged away are remapped onto the
  // surviving entity rather than dropped, so a merge never loses an edge.
  const edgeRes = await db.execute(sql`
    SELECT
      r.id,
      COALESCE(sm.id, r.source_entity_id) AS source,
      COALESCE(tm.id, r.target_entity_id) AS target,
      r.type,
      r.label,
      r.confidence,
      r.strength,
      r.created_at,
      r.weight,
      r.last_seen_at,
      n.source AS source_kind
    FROM intel_relationships r
    LEFT JOIN intel_entities s  ON s.id  = r.source_entity_id
    LEFT JOIN intel_entities sm ON sm.id = s.merged_into_id
    LEFT JOIN intel_entities t  ON t.id  = r.target_entity_id
    LEFT JOIN intel_entities tm ON tm.id = t.merged_into_id
    LEFT JOIN intel_notes n     ON n.id  = r.source_note_id
    -- A suppressed edge was deleted deliberately with a reason. It must not
    -- reappear in the analysed graph, or "reject this link" would be cosmetic.
    WHERE r.suppressed IS NOT TRUE
  `);

  const edges: GraphEdge[] = (edgeRes.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    source: String(r.source),
    target: String(r.target),
    type: String(r.type ?? 'related_to'),
    label: r.label == null ? null : String(r.label),
    confidence: String(r.confidence ?? 'medium'),
    strength: String(r.strength ?? 'moderate'),
    createdAt: r.created_at ? new Date(String(r.created_at)).getTime() : 0,
    weight: Number.isFinite(Number(r.weight)) ? Number(r.weight) : 0.5,
    // Falls back to creation time: an edge written before `last_seen_at` was
    // populated is as old as it looks, not infinitely stale.
    lastSeenAt: r.last_seen_at
      ? new Date(String(r.last_seen_at)).getTime()
      : r.created_at
        ? new Date(String(r.created_at)).getTime()
        : 0,
    sourceKind: r.source_kind == null ? null : String(r.source_kind),
  }));

  // Suppressed pairs, remapped through merges the same way edges are — a
  // rejection must survive one of its endpoints being merged into another
  // entity, or merging would quietly resurrect a link the user ruled out.
  const suppressedRes = await db.execute(sql`
    SELECT
      COALESCE(sm.id, r.source_entity_id) AS source,
      COALESCE(tm.id, r.target_entity_id) AS target
    FROM intel_relationships r
    LEFT JOIN intel_entities s  ON s.id  = r.source_entity_id
    LEFT JOIN intel_entities sm ON sm.id = s.merged_into_id
    LEFT JOIN intel_entities t  ON t.id  = r.target_entity_id
    LEFT JOIN intel_entities tm ON tm.id = t.merged_into_id
    WHERE r.suppressed IS TRUE
  `);
  const suppressedPairs = new Set(
    (suppressedRes.rows as Array<Record<string, unknown>>).map((r) =>
      pairKeyFor(String(r.source), String(r.target)),
    ),
  );

  // Resolve each entity's observation clock now that both halves are in hand.
  //
  // The later of the two observation clocks, which is now a fair comparison:
  // `lastSeenAt` reads `observed_at` (when the mail landed) rather than
  // `created_at` (when the sweep ran), so neither clock is systematically newer
  // than the other any more. Taking the max therefore means "when did we last
  // see this entity", and it is monotone — a new observation can only move an
  // entity forward, which matters because the watchlist alerts on the change.
  //
  // Before `observed_at` existed this had to prefer the edge clock outright:
  // the note clock was the ingest time and would have won nearly every
  // comparison, burying the observed date it was meant to correct.
  const newestEdge = new Map<string, number>();
  for (const e of edges) {
    if (!e.lastSeenAt) continue;
    if ((newestEdge.get(e.source) ?? 0) < e.lastSeenAt) newestEdge.set(e.source, e.lastSeenAt);
    if ((newestEdge.get(e.target) ?? 0) < e.lastSeenAt) newestEdge.set(e.target, e.lastSeenAt);
  }
  for (const n of nodes) {
    n.evidenceAt = Math.max(n.lastSeenAt, newestEdge.get(n.id) ?? 0);
  }

  return { snapshot: { nodes, edges }, suppressedPairs };
}

/** In-flight embedding loads, so concurrent callers share one query. */
const embeddingLoads = new WeakMap<GraphAnalysis, Promise<Map<string, number[]>>>();

/**
 * Populate `analysis.embeddings`, once per analysis.
 *
 * Anything that scores semantic distance must await this first; everything else
 * should not call it at all. Fills the analysis's own map in place so the
 * synchronous detectors that read `analysis.embeddings` keep working unchanged.
 */
export async function ensureEmbeddings(analysis: GraphAnalysis): Promise<Map<string, number[]>> {
  const started = embeddingLoads.get(analysis);
  if (started) return started;

  const load = (async () => {
    const res = await db.execute(sql`
      SELECT id, embedding::text AS embedding
      FROM intel_entities
      WHERE merged_into_id IS NULL AND embedding IS NOT NULL
    `);
    // Parsed in chunks with a yield between them. Several thousand 1,536-value
    // vectors is ~1.1s of unbroken string splitting, and that lands in the same
    // request as the surprise sweep — together they blocked the event loop past
    // the 5s the health probe 503s at, which the watchdog restarts the service
    // for. Same reasoning as the yields in ./centrality.
    const rows = res.rows as Array<Record<string, unknown>>;
    for (let i = 0; i < rows.length; i++) {
      const vec = parseVector(rows[i].embedding);
      if (vec) analysis.embeddings.set(String(rows[i].id), vec);
      if ((i & 255) === 255) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return analysis.embeddings;
  })();

  embeddingLoads.set(analysis, load);
  try {
    return await load;
  } catch (err) {
    // A failed load must not be remembered as done — the next caller should be
    // able to try again rather than scoring every pair as semantically unknown
    // for the life of the snapshot.
    embeddingLoads.delete(analysis);
    throw err;
  }
}

/**
 * The current graph analysis, computed at most once per TTL. Concurrent callers
 * share one in-flight computation rather than each running Louvain.
 */
export async function getGraphAnalysis(
  force = false,
  { includeArtefacts = false }: { includeArtefacts?: boolean } = {},
): Promise<GraphAnalysis> {
  const key = variantKey(includeArtefacts);
  const now = Date.now();
  const hit = cached.get(key);
  if (!force && hit && now - hit.computedAt < TTL_MS) return hit;
  const running = inflight.get(key);
  if (running) return running;

  const startedAt = generation;
  const work = (async () => {
    const { snapshot, suppressedPairs } = await loadSnapshot(includeArtefacts);
    const index = buildIndex(snapshot);
    const analysis: GraphAnalysis = {
      snapshot,
      index,
      centrality: await computeCentrality(index),
      community: detectCommunities(index),
      // Filled in by `ensureEmbeddings` on first use — see the field's comment.
      embeddings: new Map<string, number[]>(),
      suppressedPairs,
      computedAt: Date.now(),
    };
    // Only cache if nothing invalidated while we were reading. The caller still
    // gets this result — it is the best available right now — but the next
    // caller recomputes rather than being served data known to be stale.
    if (generation === startedAt) cached.set(key, analysis);
    return analysis;
  })();

  inflight.set(key, work);
  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}
