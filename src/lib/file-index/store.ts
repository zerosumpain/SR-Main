// Global @files index maintenance. Auto-embed a single /drive file on upload or
// content edit, remove it on delete, and backfill pre-existing files.
//
// The unit of work is indexFile(fileId): it reads the CURRENT bytes, hashes them,
// and only re-embeds when the hash differs from workflow_files.content_hash — so
// it is idempotent and safe to fire-and-forget from every byte-write site
// (upload, WebDAV PUT/COPY, convert). A metadata-only PATCH bumps updatedAt but
// not the bytes, so its hash is unchanged and no work happens.
//
// Concurrency: two writes to the same file can each fire a reindex. The final
// delete/insert/hash-stamp runs inside a per-file transaction advisory lock and
// re-verifies the on-disk bytes under the lock, so out-of-order commits can never
// leave stale vectors, and the unique(fileId,chunkOrd) index can never be hit by
// a losing racer.

import { eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { workflowFiles, fileEmbeddings, type NewFileEmbedding } from '$lib/db/schema';
import { readBuffer } from '$lib/file-store/storage';
import { chunkText } from '$lib/rag/chunk';
import { sha256Hex } from './hash';
import { fileToText, isIndexableMime } from './content';
import { embedChunks, FILE_INDEX_EMBEDDING_MODEL } from './embed';

// Cap the bytes we ever read into RAM to embed. The WebDAV write site allows
// multi-GB files; loading one whole into a single Buffer on the memory-constrained
// homeserv box would OOM the always-on service. Text extraction / captioning of
// anything this large is also not what @files search is for.
const MAX_INDEXABLE_BYTES = 25 * 1024 * 1024; // 25 MB

// Bound a single backfill request so it can't run unboundedly long / re-read the
// entire corpus in one HTTP call.
const BACKFILL_LIMIT = 1000;

export type IndexResult =
  | { status: 'skipped'; reason: 'not-indexable' | 'too-large' | 'unchanged' | 'no-text' | 'missing' | 'superseded' }
  | { status: 'indexed'; chunkCount: number; modality: string };

/** Remove all embedding rows for a file (used on delete-fallback and when a file becomes non-indexable). */
export async function removeFile(fileId: string): Promise<void> {
  await db.delete(fileEmbeddings).where(eq(fileEmbeddings.fileId, fileId));
}

/** Clear a file's rows and stamp its content_hash so it retires from the backfill set (no re-embed until bytes change). */
async function retireNoText(fileId: string, hash: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(fileEmbeddings).where(eq(fileEmbeddings.fileId, fileId));
    await tx.update(workflowFiles).set({ contentHash: hash }).where(eq(workflowFiles.id, fileId));
  });
}

/**
 * (Re)index one file's content into the global @files store, gated on the content
 * hash. Never throws for an expected per-file condition — returns a status. Real
 * infra errors (embedding gateway down, DB error) DO throw so a caller can log.
 */
export async function indexFile(fileId: string): Promise<IndexResult> {
  const [row] = await db.select().from(workflowFiles).where(eq(workflowFiles.id, fileId)).limit(1);
  if (!row) return { status: 'skipped', reason: 'missing' };

  // Cheap pre-checks before reading bytes: drop stale rows for anything we can't
  // (or shouldn't) index, then stop.
  if (!isIndexableMime(row.mimeType, row.name)) {
    await removeFile(fileId);
    return { status: 'skipped', reason: 'not-indexable' };
  }
  if (row.sizeBytes > MAX_INDEXABLE_BYTES) {
    await removeFile(fileId);
    return { status: 'skipped', reason: 'too-large' };
  }

  const buf = await readBuffer(row.diskPath);
  const hash = sha256Hex(buf);
  if (row.contentHash === hash) {
    return { status: 'skipped', reason: 'unchanged' };
  }

  const content = await fileToText(buf, row.mimeType, row.name);
  if (!content) {
    // Passed the mime/size pre-checks but produced no text (empty doc, or a
    // transient caption/transcription failure). Clear rows AND stamp the hash so
    // this content is not re-read + re-sent to the vision/STT model on every
    // backfill. A later edit yields a new hash and re-triggers via the hooks.
    await retireNoText(fileId, hash);
    return { status: 'skipped', reason: 'no-text' };
  }

  const pieces = chunkText(content.text);
  if (!pieces.length) {
    await retireNoText(fileId, hash);
    return { status: 'skipped', reason: 'no-text' };
  }

  const vectors = await embedChunks(pieces.map((p) => p.text));
  const dim = vectors[0]?.length ?? 0;

  const rows: NewFileEmbedding[] = pieces.map((p, i) => ({
    fileId,
    contentHash: hash,
    chunkOrd: i,
    source: row.name,
    modality: content.modality,
    text: p.text,
    charStart: p.charStart,
    charEnd: p.charEnd,
    embeddingModel: FILE_INDEX_EMBEDDING_MODEL,
    embeddingDim: dim,
    embedding: vectors[i],
  }));

  // Commit under a per-file advisory lock and re-verify the on-disk bytes: if a
  // newer write changed the file while we were embedding, that write's reindex
  // owns the index now, so we decline rather than clobber it with our stale
  // vectors. This makes the outcome correct under any commit ordering and removes
  // the unique(fileId,chunkOrd) race entirely.
  let applied = false;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${fileId}, 0))`);
    const [cur] = await tx.select().from(workflowFiles).where(eq(workflowFiles.id, fileId)).limit(1);
    if (!cur) return; // deleted while embedding
    if (cur.contentHash === hash) return; // a concurrent writer already indexed these exact bytes
    if (cur.sizeBytes > MAX_INDEXABLE_BYTES) return; // replaced by an oversized file — not our bytes
    if (sha256Hex(await readBuffer(cur.diskPath)) !== hash) return; // bytes moved on — newer write owns it
    await tx.delete(fileEmbeddings).where(eq(fileEmbeddings.fileId, fileId));
    await tx.insert(fileEmbeddings).values(rows);
    await tx.update(workflowFiles).set({ contentHash: hash }).where(eq(workflowFiles.id, fileId));
    applied = true;
  });

  return applied
    ? { status: 'indexed', chunkCount: rows.length, modality: content.modality }
    : { status: 'skipped', reason: 'superseded' };
}

/**
 * Fire-and-forget wrapper for the byte-write hooks — never rejects, logs on
 * failure. Use `void reindexFileInBackground(id)` at upload/edit sites so the
 * request is not blocked on embedding.
 */
export function reindexFileInBackground(fileId: string): void {
  void indexFile(fileId)
    .then((r) => {
      if (r.status === 'indexed') {
        console.log(`[file-index] indexed ${fileId}: ${r.chunkCount} chunks (${r.modality})`);
      }
    })
    .catch((err) => console.warn(`[file-index] indexFile(${fileId}) failed: ${(err as Error).message}`));
}

export type BackfillResult = { scanned: number; indexed: number; skipped: number; errors: number; truncated: boolean };

/**
 * Embed files that are not yet indexed. Default (`full=false`) targets only files
 * that have never been embedded (content_hash IS NULL) — cheap, for the initial
 * corpus + any file whose fire-and-forget embed was lost to a restart. With
 * `full=true` it scans ALL files and lets indexFile's hash gate re-embed only
 * those whose bytes drifted (self-heals a byte change made through a write path
 * that skipped the reindex hook). Runs sequentially to bound gateway load.
 */
export async function backfillMissing(full = false): Promise<BackfillResult> {
  const base = db
    .select({ id: workflowFiles.id, mimeType: workflowFiles.mimeType, name: workflowFiles.name })
    .from(workflowFiles);
  const candidates = await (full ? base : base.where(isNull(workflowFiles.contentHash))).limit(BACKFILL_LIMIT + 1);
  const truncated = candidates.length > BACKFILL_LIMIT;
  const batch = truncated ? candidates.slice(0, BACKFILL_LIMIT) : candidates;

  const result: BackfillResult = { scanned: 0, indexed: 0, skipped: 0, errors: 0, truncated };
  for (const c of batch) {
    if (!isIndexableMime(c.mimeType, c.name)) {
      result.skipped++;
      continue;
    }
    result.scanned++;
    try {
      const r = await indexFile(c.id);
      if (r.status === 'indexed') result.indexed++;
      else result.skipped++;
    } catch (err) {
      result.errors++;
      console.warn(`[file-index] backfill ${c.id} failed: ${(err as Error).message}`);
    }
  }
  return result;
}

/** Count of files currently represented in the index (for status/observability). */
export async function indexedFileCount(): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(distinct ${fileEmbeddings.fileId})::int` })
    .from(fileEmbeddings);
  return r?.n ?? 0;
}
