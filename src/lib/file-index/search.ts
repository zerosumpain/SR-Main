// Retrieval over the global @files pgvector index. Embeds the query with the
// pinned model, then ranks chunks by cosine distance in-database via pgvector's
// `<=>` operator (mirrors $lib/jkai/intel/search.ts). Vectors are unit-normalized
// at write time so cosine distance = 1 − dot; score is reported as similarity.

import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { fileEmbeddings } from '$lib/db/schema';
import { embedQuery } from './embed';

export type FileSearchHit = {
  fileId: string;
  source: string;
  modality: string;
  chunkOrd: number;
  charStart: number;
  charEnd: number;
  passage: string;
  score: number; // cosine similarity in [-1, 1]; higher = more relevant
};

export type FileSearchOptions = { topK?: number; minSim?: number };

const DEFAULT_TOP_K = 8;
const DEFAULT_MIN_SIM = 0.2;
const MAX_PASSAGE_CHARS = 1200;

/** Semantic search over all indexed /drive file content. Returns ranked passages. */
export async function searchFiles(query: string, options: FileSearchOptions = {}): Promise<FileSearchHit[]> {
  const q = (query || '').trim();
  if (!q) return [];
  // Guard NaN (the tool coerces a non-numeric `limit` via Number(...)); `??` only
  // catches null/undefined, so a NaN would reach .limit(NaN) and fail the query.
  const topK = Number.isFinite(options.topK) ? Math.min(Math.max(options.topK as number, 1), 30) : DEFAULT_TOP_K;
  const minSim = Number.isFinite(options.minSim) ? (options.minSim as number) : DEFAULT_MIN_SIM;

  const vector = await embedQuery(q);
  const literal = `[${vector.join(',')}]`;
  const maxDistance = 1 - minSim;

  // Parameterize the vector literal and cast to pgvector; cosine distance via `<=>`.
  const distance = sql<number>`${fileEmbeddings.embedding} <=> ${literal}::vector`;

  const rows = await db
    .select({
      fileId: fileEmbeddings.fileId,
      source: fileEmbeddings.source,
      modality: fileEmbeddings.modality,
      chunkOrd: fileEmbeddings.chunkOrd,
      charStart: fileEmbeddings.charStart,
      charEnd: fileEmbeddings.charEnd,
      text: fileEmbeddings.text,
      distance,
    })
    .from(fileEmbeddings)
    .where(sql`${fileEmbeddings.embedding} <=> ${literal}::vector <= ${maxDistance}`)
    .orderBy(distance)
    .limit(topK);

  return rows.map((r) => ({
    fileId: r.fileId,
    source: r.source,
    modality: r.modality,
    chunkOrd: r.chunkOrd,
    charStart: r.charStart,
    charEnd: r.charEnd,
    passage: r.text.length > MAX_PASSAGE_CHARS ? r.text.slice(0, MAX_PASSAGE_CHARS) + '…' : r.text,
    score: Math.round((1 - Number(r.distance)) * 1000) / 1000,
  }));
}
