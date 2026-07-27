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

export interface GraphAnalysis {
  snapshot: GraphSnapshot;
  index: AdjacencyIndex;
  centrality: CentralityScores;
  community: CommunityResult;
  /** node id → embedding, only for entities that have one. */
  embeddings: Map<string, number[]>;
  computedAt: number;
}

/**
 * How long a computed analysis is reused. Long enough that clicking between
 * dashboard tabs is instant, short enough that a note added a minute ago shows
 * up without a restart.
 */
const TTL_MS = 60_000;

let cached: GraphAnalysis | null = null;
let inflight: Promise<GraphAnalysis> | null = null;
/**
 * Bumped on every invalidation. A computation that started before the bump is
 * reading pre-write data, so it must not install itself as the cache when it
 * finishes — otherwise a merge landing mid-computation would be papered over by
 * a stale snapshot for the whole TTL.
 */
let generation = 0;

/** Drop the cache — call after any write that changes the graph. */
export function invalidateGraphAnalysis(): void {
  cached = null;
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

async function loadSnapshot(): Promise<{ snapshot: GraphSnapshot; embeddings: Map<string, number[]> }> {
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
      e.confirmed,
      e.created_at,
      e.updated_at,
      e.embedding::text             AS embedding,
      e.aliases                     AS aliases,
      COALESCE(ne.note_count, 0)    AS note_count,
      ne.last_seen_at,
      COALESCE(ne.categories, ARRAY[]::text[]) AS categories
    FROM intel_entities e
    LEFT JOIN intel_entity_types t ON t.id = e.type_id
    LEFT JOIN (
      -- ER categories are set per SOURCE, so an entity carries the union of the
      -- categories of every note asserting it: filtering on 'work' returns
      -- everything work ever told us about. The lateral expansion multiplies
      -- rows, hence COUNT(DISTINCT note_id) rather than COUNT(*).
      SELECT ne.entity_id,
             COUNT(DISTINCT ne.note_id)::int AS note_count,
             MAX(n.created_at)               AS last_seen_at,
             ARRAY_AGG(DISTINCT cat.value) FILTER (WHERE cat.value IS NOT NULL) AS categories
      FROM intel_note_entities ne
      JOIN intel_notes n ON n.id = ne.note_id
      LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(n.categories, '[]'::jsonb))
        AS cat(value) ON TRUE
      GROUP BY ne.entity_id
    ) ne ON ne.entity_id = e.id
    WHERE e.merged_into_id IS NULL
  `);

  const embeddings = new Map<string, number[]>();
  const nodes: GraphNode[] = (entityRes.rows as Array<Record<string, unknown>>).map((r) => {
    const id = String(r.id);
    const vec = parseVector(r.embedding);
    if (vec) embeddings.set(id, vec);
    const created = r.created_at ? new Date(String(r.created_at)).getTime() : 0;
    const updated = r.updated_at ? new Date(String(r.updated_at)).getTime() : created;
    return {
      id,
      name: String(r.name ?? ''),
      typeId: String(r.type_id ?? ''),
      typeName: String(r.type_name ?? 'unknown'),
      icon: String(r.icon ?? '🔷'),
      color: String(r.color ?? '#7dd3fc'),
      summary: r.summary == null ? null : String(r.summary),
      confidence: String(r.confidence ?? 'medium'),
      confirmed: Boolean(r.confirmed),
      createdAt: created,
      updatedAt: updated,
      noteCount: Number(r.note_count ?? 0),
      lastSeenAt: r.last_seen_at ? new Date(String(r.last_seen_at)).getTime() : created,
      aliases: toStringArray(r.aliases),
      categories: toStringArray(r.categories),
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
      r.created_at
    FROM intel_relationships r
    LEFT JOIN intel_entities s  ON s.id  = r.source_entity_id
    LEFT JOIN intel_entities sm ON sm.id = s.merged_into_id
    LEFT JOIN intel_entities t  ON t.id  = r.target_entity_id
    LEFT JOIN intel_entities tm ON tm.id = t.merged_into_id
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
  }));

  return { snapshot: { nodes, edges }, embeddings };
}

/**
 * The current graph analysis, computed at most once per TTL. Concurrent callers
 * share one in-flight computation rather than each running Louvain.
 */
export async function getGraphAnalysis(force = false): Promise<GraphAnalysis> {
  const now = Date.now();
  if (!force && cached && now - cached.computedAt < TTL_MS) return cached;
  if (inflight) return inflight;

  const startedAt = generation;
  inflight = (async () => {
    const { snapshot, embeddings } = await loadSnapshot();
    const index = buildIndex(snapshot);
    const analysis: GraphAnalysis = {
      snapshot,
      index,
      centrality: computeCentrality(index),
      community: detectCommunities(index),
      embeddings,
      computedAt: Date.now(),
    };
    // Only cache if nothing invalidated while we were reading. The caller still
    // gets this result — it is the best available right now — but the next
    // caller recomputes rather than being served data known to be stale.
    if (generation === startedAt) cached = analysis;
    return analysis;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
