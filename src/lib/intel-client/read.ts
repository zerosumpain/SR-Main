// Read-only views of the intel graph, for the site tools Main hosts.
//
// SR-Jkai-Core owns every intel row and is their only writer. Main still hosts
// the tools other processes call (`knowledge_search`, `intel_find`,
// `intel_neighbourhood`, `intel_path`: Core, Workflows, WhatsApp and MCP all
// execute them here over /api/platform/tools/invoke), and each needs a read per
// call. So these two reads run over the shared database directly — nothing in
// this module writes, curates or extracts.
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { pgTextArray } from '$lib/db/sql-array';
import { queryRecords } from '$lib/datastore';
import { buildIndex, type AdjacencyIndex, type GraphEdge, type GraphNode, type GraphSnapshot } from '$lib/graph-analytics/model';
import { computeCentrality, type CentralityScores } from '$lib/graph-analytics/centrality';
import { detectCommunities, type CommunityResult } from '$lib/graph-analytics/community';
import { generateEmbedding } from './embed';
import { OWNER_INTEL_SCOPE, scopeKey, spaceIn, type IntelScope } from './scope';

// ---------------------------------------------------------------------------
// Recall search
// ---------------------------------------------------------------------------

export type IntelItem = {
  id: string;
  kind: 'note' | 'entity';
  title: string;
  snippet: string;
  url?: string;
  createdAt: string;
  score: number;
  metadata?: {
    entityType?: string;
    tags?: string[];
    sourceTag?: string;
    /**
     * Set on notes minted by intel auto-extraction ('file' | 'research'),
     * absent on notes a human wrote. Unified recall uses this to drop the
     * derived note, whose text is already covered by the files/research
     * branches — the entities it produced are the part worth surfacing.
     */
    autoKind?: string;
  };
};

export type IntelFacets = {
  entityTypes?: string[];
  tags?: string[];
  timeRange?: { from: string; to: string } | null;
  limit?: number;
  ordering?: 'recent' | 'relevant';
};

export type SearchResult = {
  items: IntelItem[];
  total: number;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * `scope` is a separate trailing parameter rather than a facet: the canvas
 * preview and the intelligence node build facets from request and node input,
 * and a field on that object is one a caller could fill from outside.
 */
export async function searchIntel(
  query: string,
  facets: IntelFacets = {},
  scope: IntelScope = OWNER_INTEL_SCOPE,
): Promise<SearchResult> {
  const q = query.trim();
  const hasTimeRange = facets.timeRange != null;
  const hasEntityTypes = (facets.entityTypes?.length ?? 0) > 0;
  const hasTags = (facets.tags?.length ?? 0) > 0;

  if (!q && !hasTimeRange && !hasEntityTypes && !hasTags) {
    return { items: [], total: 0 };
  }

  const limit = Math.min(facets.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const ordering = facets.ordering ?? 'relevant';

  // Build optional filters as SQL fragments.
  const fromTs = facets.timeRange?.from ?? null;
  const toTs = facets.timeRange?.to ?? null;
  const entityTypeFilter = hasEntityTypes ? facets.entityTypes! : null;
  const tagFilter = hasTags ? facets.tags! : null;

  let embedding: number[] | null = null;
  if (q && ordering === 'relevant') {
    try {
      embedding = await generateEmbedding(q);
    } catch {
      embedding = null;
    }
  }
  const vectorStr = embedding ? `[${embedding.join(',')}]` : null;

  // Notes.
  const notesRes = await db.execute(sql`
    SELECT n.id,
           n.title,
           substring(COALESCE(n.processed_content, n.raw_content) from 1 for 300) AS snippet,
           n.created_at AS "createdAt",
           n.metadata->>'sourceTag' AS source_tag,
           n.metadata->>'sourceUrl' AS source_url,
           n.metadata->>'autoKind' AS auto_kind,
           ${vectorStr != null
             ? sql`(n.embedding <=> ${vectorStr}::vector)`
             : sql`0.5::float8`} AS distance
    FROM intel_notes n
    WHERE
      -- Only what the graph is actually allowed to know. A note held at the mail
      -- gate is stored and embedded so the admission queue can cluster and search
      -- it, and this is the door it must not come through: intel recall answers
      -- questions ABOUT the graph, and a marketing email nobody approved is not
      -- part of it. Admitted mail is searchable here and, at passage level, via
      -- $lib/mail-index.
      n.graph_state = 'admitted'
      AND ${spaceIn(sql`n.space_id`, scope)}
      AND ${q ? sql`(n.title ILIKE ${`%${q}%`} OR COALESCE(n.processed_content, n.raw_content) ILIKE ${`%${q}%`})` : sql`TRUE`}
      ${fromTs ? sql`AND n.created_at >= ${fromTs}::timestamptz` : sql``}
      ${toTs ? sql`AND n.created_at < ${toTs}::timestamptz` : sql``}
      ${tagFilter ? sql`AND n.metadata->>'sourceTag' = ANY(${pgTextArray(tagFilter)}::text[])` : sql``}
    ORDER BY ${ordering === 'recent' ? sql`n.created_at DESC` : sql`distance ASC, n.created_at DESC`}
    LIMIT ${limit}
  `);

  // Entities.
  const entitiesRes = await db.execute(sql`
    SELECT e.id,
           e.name,
           et.name AS type_name,
           e.summary,
           e.updated_at AS "updatedAt",
           ${vectorStr != null
             ? sql`(e.embedding <=> ${vectorStr}::vector)`
             : sql`0.5::float8`} AS distance
    FROM intel_entities e
    JOIN intel_entity_types et ON e.type_id = et.id
    WHERE e.merged_into_id IS NULL
      AND ${spaceIn(sql`e.space_id`, scope)}
      ${q ? sql`AND (e.name ILIKE ${`%${q}%`} OR e.summary ILIKE ${`%${q}%`})` : sql``}
      ${entityTypeFilter ? sql`AND et.name = ANY(${pgTextArray(entityTypeFilter)}::text[])` : sql``}
      ${fromTs ? sql`AND e.updated_at >= ${fromTs}::timestamptz` : sql``}
      ${toTs ? sql`AND e.updated_at < ${toTs}::timestamptz` : sql``}
    ORDER BY ${ordering === 'recent' ? sql`e.updated_at DESC` : sql`distance ASC, e.updated_at DESC`}
    LIMIT ${limit}
  `);

  const noteItems: IntelItem[] = (notesRes.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    kind: 'note' as const,
    title: (r.title as string | null) || 'Untitled note',
    snippet: (r.snippet as string | null) || '',
    url: (r.source_url as string | undefined) ?? undefined,
    createdAt: new Date(r.createdAt as string).toISOString(),
    score: Math.max(0, 1 - Number(r.distance ?? 0.5)),
    metadata: {
      sourceTag: (r.source_tag as string | undefined) ?? undefined,
      autoKind: (r.auto_kind as string | undefined) ?? undefined,
    },
  }));

  const entityItems: IntelItem[] = (entitiesRes.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    kind: 'entity' as const,
    title: String(r.name ?? 'Unnamed entity'),
    snippet: (r.summary as string | null) || '',
    createdAt: new Date(r.updatedAt as string).toISOString(),
    score: Math.max(0, 1 - Number(r.distance ?? 0.5)),
    metadata: {
      entityType: (r.type_name as string | undefined) ?? undefined,
    },
  }));

  // Merge, sort by score desc (or date desc for 'recent'), dedupe (ids are disjoint by kind, so no collisions).
  const merged = [...noteItems, ...entityItems];
  merged.sort((a, b) =>
    ordering === 'recent'
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : b.score - a.score,
  );
  const items = merged.slice(0, limit);

  return { items, total: merged.length };
}

// ---------------------------------------------------------------------------
// Graph analysis
// ---------------------------------------------------------------------------

export interface GraphAnalysis {
  snapshot: GraphSnapshot;
  index: AdjacencyIndex;
  centrality: CentralityScores;
  community: CommunityResult;
  scope: IntelScope;
  computedAt: number;
}

/**
 * How long one analysis is reused. A chat turn often asks two or three graph
 * questions in a row; recomputing Louvain and Brandes for each would be both
 * slow and able to disagree with itself about which cluster something is in.
 */
const TTL_MS = 60_000;
const cached = new Map<string, GraphAnalysis>();
const inflight = new Map<string, Promise<GraphAnalysis>>();

/**
 * Entities that identify the channel rather than anything that came down it
 * (the mailbox owner, "jkai" on every chat note). Core flags them in the
 * `intel_channel_artefacts` datastore collection; they are left out of the
 * analysed graph so they do not dominate every centrality and path.
 *
 * Read-only: a missing collection or a datastore error analyses the whole graph
 * rather than failing the tool call.
 */
async function channelArtefactIds(): Promise<Set<string>> {
  try {
    const out = new Set<string>();
    for (let offset = 0; ; offset += 200) {
      const { records } = await queryRecords('intel_channel_artefacts', { limit: 200, offset }, 'system');
      for (const r of records) {
        const id = (r.data as { entityId?: unknown }).entityId;
        if (typeof id === 'string') out.add(id);
      }
      if (records.length < 200) break;
    }
    return out;
  } catch {
    return new Set();
  }
}

async function loadSnapshot(scope: IntelScope): Promise<GraphSnapshot> {
  const artefacts = await channelArtefactIds();

  // Merged entities are aliases of a survivor and would show as duplicates.
  const entityRes = await db.execute(sql`
    SELECT e.id, e.name, e.type_id,
           COALESCE(t.name, 'unknown')  AS type_name,
           COALESCE(t.icon, '🔷')       AS icon,
           COALESCE(t.color, '#7dd3fc') AS color,
           e.summary, e.confidence, e.confidence_score, e.confirmed,
           e.created_at, e.updated_at, e.aliases, e.space_id
    FROM intel_entities e
    LEFT JOIN intel_entity_types t ON t.id = e.type_id
    WHERE e.merged_into_id IS NULL
      AND ${spaceIn(sql`e.space_id`, scope)}
  `);

  const nodes: GraphNode[] = (entityRes.rows as Array<Record<string, unknown>>)
    .filter((r) => !artefacts.has(String(r.id)))
    .map((r) => {
      const created = r.created_at ? new Date(String(r.created_at)).getTime() : 0;
      const updated = r.updated_at ? new Date(String(r.updated_at)).getTime() : created;
      return {
        id: String(r.id),
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
        // The tools answer about structure; none of them reads evidence counts
        // or the per-source facets the dashboards used, so they are not loaded.
        noteCount: 0,
        lastSeenAt: updated,
        evidenceAt: updated,
        aliases: Array.isArray(r.aliases) ? (r.aliases as unknown[]).filter((a): a is string => typeof a === 'string') : [],
        categories: [],
        sources: [],
        space: String(r.space_id),
      };
    });

  // An edge whose endpoint was merged away is remapped onto the survivor, so a
  // merge never loses an edge. Every join is scoped: an out-of-scope endpoint
  // leaves a raw id that names no node, and buildIndex drops the edge. A
  // suppressed edge was deleted deliberately and must not reappear.
  const edgeRes = await db.execute(sql`
    SELECT r.id,
           COALESCE(sm.id, r.source_entity_id) AS source,
           COALESCE(tm.id, r.target_entity_id) AS target,
           r.type, r.label, r.confidence, r.strength, r.created_at, r.weight, r.last_seen_at,
           n.source AS source_kind
    FROM intel_relationships r
    LEFT JOIN intel_entities s  ON s.id  = r.source_entity_id AND ${spaceIn(sql`s.space_id`, scope)}
    LEFT JOIN intel_entities sm ON sm.id = s.merged_into_id   AND ${spaceIn(sql`sm.space_id`, scope)}
    LEFT JOIN intel_entities t  ON t.id  = r.target_entity_id AND ${spaceIn(sql`t.space_id`, scope)}
    LEFT JOIN intel_entities tm ON tm.id = t.merged_into_id   AND ${spaceIn(sql`tm.space_id`, scope)}
    LEFT JOIN intel_notes n     ON n.id  = r.source_note_id   AND ${spaceIn(sql`n.space_id`, scope)}
    WHERE r.suppressed IS NOT TRUE
      AND ${spaceIn(sql`r.space_id`, scope)}
  `);

  const edges: GraphEdge[] = (edgeRes.rows as Array<Record<string, unknown>>)
    .filter((r) => !artefacts.has(String(r.source)) && !artefacts.has(String(r.target)))
    .map((r) => {
      const created = r.created_at ? new Date(String(r.created_at)).getTime() : 0;
      return {
        id: String(r.id),
        source: String(r.source),
        target: String(r.target),
        type: String(r.type ?? 'related_to'),
        label: r.label == null ? null : String(r.label),
        confidence: String(r.confidence ?? 'medium'),
        strength: String(r.strength ?? 'moderate'),
        createdAt: created,
        weight: Number.isFinite(Number(r.weight)) ? Number(r.weight) : 0.5,
        lastSeenAt: r.last_seen_at ? new Date(String(r.last_seen_at)).getTime() : created,
        sourceKind: r.source_kind == null ? null : String(r.source_kind),
      };
    });

  return { nodes, edges };
}

/**
 * The intel graph within `scope`, with its centrality and communities, computed
 * at most once a minute per scope. Concurrent callers share one computation.
 * The scope is part of the cache key: a shared entry would serve one person's
 * graph to another.
 */
export async function getGraphAnalysis(scope: IntelScope = OWNER_INTEL_SCOPE): Promise<GraphAnalysis> {
  const key = scopeKey(scope);
  const hit = cached.get(key);
  if (hit && Date.now() - hit.computedAt < TTL_MS) return hit;
  const running = inflight.get(key);
  if (running) return running;

  const work = (async () => {
    const snapshot = await loadSnapshot(scope);
    const index = buildIndex(snapshot);
    const analysis: GraphAnalysis = {
      snapshot,
      index,
      centrality: await computeCentrality(index),
      community: detectCommunities(index),
      scope,
      computedAt: Date.now(),
    };
    cached.set(key, analysis);
    return analysis;
  })();
  inflight.set(key, work);
  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}
