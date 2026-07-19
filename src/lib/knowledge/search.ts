// Unified Knowledge Recall — one search that fans out across every place JKai
// remembers things: /drive file embeddings, deep-dive research facts, personal
// memory, and datastore records. Each branch reuses the store's OWN search
// primitive; this module only normalises + merges + ranks. Best-effort: a
// failing branch degrades to empty (recorded in `errors`) rather than failing
// the whole recall.
import { db } from '$lib/db';
import { and, desc, ilike, isNull } from 'drizzle-orm';
import { jkaiMemories } from '$lib/db/schema';
import { searchFiles } from '$lib/file-index/search';
import { searchResearch } from '$lib/deepdive/research-search';
import { listCollections, queryRecords } from '$lib/datastore';

export type KnowledgeSource = 'files' | 'research' | 'memory' | 'datastore';
export const ALL_SOURCES: KnowledgeSource[] = ['files', 'research', 'memory', 'datastore'];

export interface KnowledgeHit {
  source: KnowledgeSource;
  /** Human-readable label for the hit (file source, research topic, memory category, collection name). */
  title: string;
  /** The matched passage / content. */
  passage: string;
  /** 0..1 relevance. Semantic branches report cosine similarity; keyword branches a fixed prior. */
  score: number;
  matchKind: 'semantic' | 'keyword';
  /** Ids/urls for citation + deep-linking, shape depends on source. */
  ref: Record<string, unknown>;
}

export interface KnowledgeSearchOptions {
  sources?: KnowledgeSource[];
  /** Max hits kept per source before the global merge (default 5). */
  limitPerSource?: number;
  /** Which datastore collections to keyword-search. Omit = every non-system collection. */
  datastoreCollections?: string[];
}

export interface KnowledgeSearchResult {
  query: string;
  hits: KnowledgeHit[];
  counts: Record<KnowledgeSource, number>;
  errors: Partial<Record<KnowledgeSource, string>>;
}

const KEYWORD_SCORE = 0.45; // moderate prior so keyword hits interleave under strong semantic ones
const MAX_DATASTORE_COLLECTIONS = 12;
const MAX_RECORDS_PER_COLLECTION = 100;
const MAX_PASSAGE = 600;

function clip(s: string): string {
  const t = (s ?? '').toString();
  return t.length > MAX_PASSAGE ? t.slice(0, MAX_PASSAGE) + '…' : t;
}

async function branchFiles(query: string, limit: number): Promise<KnowledgeHit[]> {
  const hits = await searchFiles(query, { topK: limit });
  return hits.map((h) => ({
    source: 'files' as const,
    title: h.source || 'file',
    passage: clip(h.passage),
    score: h.score,
    matchKind: 'semantic' as const,
    ref: { fileId: h.fileId, source: h.source, chunkOrd: h.chunkOrd },
  }));
}

async function branchResearch(query: string, limit: number): Promise<KnowledgeHit[]> {
  const hits = await searchResearch(query, { topK: limit });
  return hits.map((h) => ({
    source: 'research' as const,
    title: h.sessionTopic || 'research',
    passage: clip(h.passage),
    score: h.score,
    matchKind: 'semantic' as const,
    ref: {
      factId: h.factId,
      sessionId: h.sessionId,
      sourceUrl: h.sourceUrl,
      sourceTitle: h.sourceTitle,
    },
  }));
}

async function branchMemory(query: string, limit: number): Promise<KnowledgeHit[]> {
  const q = query.trim();
  if (!q) return [];
  const rows = await db
    .select()
    .from(jkaiMemories)
    .where(and(ilike(jkaiMemories.content, `%${q}%`), isNull(jkaiMemories.supersededBy)))
    .orderBy(desc(jkaiMemories.updatedAt))
    .limit(limit);
  return rows.map((r) => ({
    source: 'memory' as const,
    title: r.category || 'memory',
    passage: clip(r.content),
    score: KEYWORD_SCORE,
    matchKind: 'keyword' as const,
    ref: { memoryId: r.id, category: r.category },
  }));
}

async function branchDatastore(
  query: string,
  limit: number,
  collections?: string[],
): Promise<KnowledgeHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  let slugs = collections;
  if (!slugs) {
    const cols = await listCollections('owner');
    slugs = cols.filter((c) => !c.isSystem).map((c) => c.slug).slice(0, MAX_DATASTORE_COLLECTIONS);
  }
  const hits: KnowledgeHit[] = [];
  for (const slug of slugs) {
    if (hits.length >= limit) break;
    let records;
    try {
      ({ records } = await queryRecords(slug, { limit: MAX_RECORDS_PER_COLLECTION }, 'owner'));
    } catch {
      continue; // a missing/forbidden collection just contributes nothing
    }
    for (const rec of records) {
      const blob = JSON.stringify(rec.data ?? {});
      if (blob.toLowerCase().includes(q)) {
        hits.push({
          source: 'datastore',
          title: `${slug}/${rec.key ?? rec.id}`,
          passage: clip(blob),
          score: KEYWORD_SCORE,
          matchKind: 'keyword',
          ref: { collection: slug, key: rec.key ?? rec.id },
        });
        if (hits.length >= limit) break;
      }
    }
  }
  return hits;
}

/**
 * Fan out `query` across every knowledge store in parallel, merge, and rank by
 * score (semantic similarity for files/research, a keyword prior for
 * memory/datastore). Resilient: a branch that throws is recorded in `errors`
 * and contributes no hits.
 */
export async function searchKnowledge(
  query: string,
  options: KnowledgeSearchOptions = {},
): Promise<KnowledgeSearchResult> {
  const sources = options.sources?.length ? options.sources : ALL_SOURCES;
  const perSource = Math.min(Math.max(options.limitPerSource ?? 5, 1), 20);

  const branches: Array<[KnowledgeSource, Promise<KnowledgeHit[]>]> = [];
  if (sources.includes('files')) branches.push(['files', branchFiles(query, perSource)]);
  if (sources.includes('research')) branches.push(['research', branchResearch(query, perSource)]);
  if (sources.includes('memory')) branches.push(['memory', branchMemory(query, perSource)]);
  if (sources.includes('datastore'))
    branches.push(['datastore', branchDatastore(query, perSource, options.datastoreCollections)]);

  const settled = await Promise.allSettled(branches.map(([, p]) => p));

  const hits: KnowledgeHit[] = [];
  const counts = { files: 0, research: 0, memory: 0, datastore: 0 } as Record<KnowledgeSource, number>;
  const errors: Partial<Record<KnowledgeSource, string>> = {};

  settled.forEach((res, i) => {
    const source = branches[i][0];
    if (res.status === 'fulfilled') {
      counts[source] = res.value.length;
      hits.push(...res.value);
    } else {
      errors[source] = res.reason instanceof Error ? res.reason.message : String(res.reason);
    }
  });

  hits.sort((a, b) => b.score - a.score);
  return { query, hits, counts, errors };
}
