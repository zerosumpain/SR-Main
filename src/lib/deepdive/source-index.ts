// Semantic index over research SOURCE MATERIALS — the fetched page content of a
// session's sources, chunked + embedded into `source_chunk`. Complements the
// `fact` layer: facts are the extractor's distilled claims; source chunks are the
// raw source text, so @research (searchResearch) can retrieve passages the
// extractor never turned into a fact. Mirrors $lib/file-index/store.ts, but the
// unit is a research source and vectors use deepdive's embedding model (same
// space as fact.embedding) so both can be searched with one query vector.

import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { sourceChunks, sources, facts, globalEntities, type NewSourceChunk, type Source } from '$lib/db/schema';
import { chunkText } from '$lib/rag/chunk';
import { generateEmbeddings } from './ai';
import { extractContent } from './extract-content';
import { hasOpenRouter, getEmbeddingModel } from '$lib/llm/keys';

// Cap the content we chunk per source. phase 2 already slices fetched content to
// ~10k chars; this is a hard ceiling for any other caller (e.g. backfill).
const MAX_CONTENT_CHARS = 20000;

const embeddingsAvailable = hasOpenRouter;

export type SourceIndexResult =
  | { status: 'skipped'; reason: 'no-embeddings' | 'no-content' | 'no-chunks' }
  | { status: 'indexed'; chunkCount: number };

/**
 * (Re)index one source's content into `source_chunk`. Idempotent: replaces any
 * existing chunks for the source. Never throws for an expected condition (no key,
 * empty content) — returns a status; real infra errors (embed gateway, DB) throw
 * so the caller can log without aborting the surrounding research run.
 */
export async function indexSourceContent(
  sessionId: string,
  source: Pick<Source, 'id'>,
  content: string,
): Promise<SourceIndexResult> {
  if (!(await embeddingsAvailable())) return { status: 'skipped', reason: 'no-embeddings' };
  const text = (content || '').slice(0, MAX_CONTENT_CHARS).trim();
  if (!text) return { status: 'skipped', reason: 'no-content' };

  const pieces = chunkText(text);
  if (!pieces.length) return { status: 'skipped', reason: 'no-chunks' };

  const vectors = await generateEmbeddings(pieces.map((p) => p.text));
  const model = getEmbeddingModel();

  const rows: NewSourceChunk[] = pieces.map((p, i) => ({
    sessionId,
    sourceId: source.id,
    chunkOrd: i,
    text: p.text,
    charStart: p.charStart,
    charEnd: p.charEnd,
    embedding: vectors[i],
    embeddingModel: model,
  }));

  // Replace-in-place under a transaction so a re-index can't leave a half-written
  // chunk set or trip the unique(sourceId, chunkOrd) index.
  await db.transaction(async (tx) => {
    await tx.delete(sourceChunks).where(eq(sourceChunks.sourceId, source.id));
    await tx.insert(sourceChunks).values(rows);
  });

  return { status: 'indexed', chunkCount: rows.length };
}

export type BackfillResult = { scanned: number; indexed: number; skipped: number; errors: number; chunks: number };

/**
 * Index sources that have no chunks yet. `refetch=false` (default) uses each
 * source's stored `snippet` — cheap, no outbound requests, but only the excerpt
 * the extractor already saw. `refetch=true` re-fetches the live page for the full
 * content (richer, but makes an outbound request per source). Scoped to one
 * session when `sessionId` is given, else all sources. Bounded by `limit`.
 */
export async function backfillSourceChunks(opts: {
  sessionId?: string;
  refetch?: boolean;
  limit?: number;
} = {}): Promise<BackfillResult> {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const result: BackfillResult = { scanned: 0, indexed: 0, skipped: 0, errors: 0, chunks: 0 };

  // Sources with no source_chunk rows yet (optionally within one session).
  const rows = await db
    .select({ id: sources.id, sessionId: sources.sessionId, url: sources.url, snippet: sources.snippet })
    .from(sources)
    .where(sql`
      NOT EXISTS (SELECT 1 FROM source_chunk sc WHERE sc.source_id = ${sources.id})
      ${opts.sessionId ? sql`AND ${sources.sessionId} = ${opts.sessionId}` : sql``}
    `)
    .limit(limit);

  for (const s of rows) {
    result.scanned++;
    try {
      let content = s.snippet ?? '';
      if (opts.refetch) {
        const fetched = await extractContent(s.url, content);
        content = fetched.content || content;
      }
      const r = await indexSourceContent(s.sessionId, { id: s.id }, content);
      if (r.status === 'indexed') {
        result.indexed++;
        result.chunks += r.chunkCount;
      } else {
        result.skipped++;
      }
    } catch (err) {
      result.errors++;
      console.warn(`[source-index] backfill ${s.id} failed: ${(err as Error).message}`);
    }
  }
  return result;
}

/** Count of sources currently represented in the index (observability). */
export async function indexedSourceCount(): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(distinct ${sourceChunks.sourceId})::int` })
    .from(sourceChunks);
  return r?.n ?? 0;
}

export type ReembedResult = { scanned: number; embedded: number; errors: number; model: string };

/**
 * Re-embed facts into the CURRENT embedding space. Targets facts whose stored
 * `embedding_model` differs from the current model (or is null) and that have
 * usable content — i.e. facts embedded under an old model, plus never-embedded
 * facts. Idempotent + resumable: a completed fact is stamped with the model, so a
 * repeat run skips it. Bounded by `limit`; loop until `scanned` is 0.
 * Used to migrate the corpus when getEmbeddingModel() changes.
 */
export async function reembedFacts(opts: { limit?: number } = {}): Promise<ReembedResult> {
  const model = getEmbeddingModel();
  const result: ReembedResult = { scanned: 0, embedded: 0, errors: 0, model };
  if (!(await embeddingsAvailable())) return result;

  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const rows = await db
    .select({ id: facts.id, content: facts.content })
    .from(facts)
    .where(sql`
      length(coalesce(${facts.content}, '')) >= 10
      AND (${facts.embeddingModel} IS DISTINCT FROM ${model} OR ${facts.embedding} IS NULL)
    `)
    .limit(limit);

  if (!rows.length) return result;
  result.scanned = rows.length;

  // Batch-embed all this page's contents in one space, then stamp each row.
  const vectors = await generateEmbeddings(rows.map((r) => r.content));
  for (let i = 0; i < rows.length; i++) {
    try {
      await db
        .update(facts)
        .set({ embedding: vectors[i], embeddingModel: model })
        .where(eq(facts.id, rows[i].id));
      result.embedded++;
    } catch (err) {
      result.errors++;
      console.warn(`[source-index] reembed fact ${rows[i].id} failed: ${(err as Error).message}`);
    }
  }
  return result;
}

/**
 * Re-embed the global cross-session entity index into the current space. These
 * vectors gate cross-session entity dedup at a 0.85 cosine threshold, so after an
 * embedding-model change they must move to the new space or every entity reads as
 * new (duplicate global entities). Only rows that currently HAVE an embedding are
 * touched (that's the set the matcher compares against). One pass, capped; the
 * embed text mirrors cross-session.ts's `${name}: ${description ?? type}`.
 */
export async function reembedGlobalEntities(opts: { limit?: number } = {}): Promise<{ scanned: number; embedded: number; errors: number }> {
  const result = { scanned: 0, embedded: 0, errors: 0 };
  if (!(await embeddingsAvailable())) return result;
  const limit = Math.min(Math.max(opts.limit ?? 1000, 1), 5000);

  const rows = await db
    .select({ id: globalEntities.id, name: globalEntities.canonicalName, type: globalEntities.type, description: globalEntities.description })
    .from(globalEntities)
    .where(sql`${globalEntities.embedding} IS NOT NULL`)
    .limit(limit);
  if (!rows.length) return result;
  result.scanned = rows.length;

  const vectors = await generateEmbeddings(rows.map((r) => `${r.name}: ${r.description ?? r.type}`));
  for (let i = 0; i < rows.length; i++) {
    try {
      await db.update(globalEntities).set({ embedding: vectors[i] }).where(eq(globalEntities.id, rows[i].id));
      result.embedded++;
    } catch (err) {
      result.errors++;
      console.warn(`[source-index] reembed global_entity ${rows[i].id} failed: ${(err as Error).message}`);
    }
  }
  return result;
}

/** Count of facts embedded under the current model (observability). */
export async function factsInCurrentSpace(): Promise<{ current: number; total: number; model: string }> {
  const model = getEmbeddingModel();
  const [r] = await db
    .select({
      current: sql<number>`count(*) FILTER (WHERE ${facts.embeddingModel} = ${model})::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(facts);
  return { current: r?.current ?? 0, total: r?.total ?? 0, model };
}
