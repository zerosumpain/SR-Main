import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { generateEmbedding } from './embed';

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

export async function searchIntel(query: string, facets: IntelFacets): Promise<SearchResult> {
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
      ${q ? sql`(n.title ILIKE ${`%${q}%`} OR COALESCE(n.processed_content, n.raw_content) ILIKE ${`%${q}%`})` : sql`TRUE`}
      ${fromTs ? sql`AND n.created_at >= ${fromTs}::timestamptz` : sql``}
      ${toTs ? sql`AND n.created_at < ${toTs}::timestamptz` : sql``}
      ${tagFilter ? sql`AND n.metadata->>'sourceTag' = ANY(${tagFilter}::text[])` : sql``}
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
      ${q ? sql`AND (e.name ILIKE ${`%${q}%`} OR e.summary ILIKE ${`%${q}%`})` : sql``}
      ${entityTypeFilter ? sql`AND et.name = ANY(${entityTypeFilter}::text[])` : sql``}
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
