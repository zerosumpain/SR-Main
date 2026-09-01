// RAG orchestration: build a persistent index from Drive files, and answer a
// question over it with a streamed, citation-grounded completion.

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { workflowFiles, ragCollections } from '$lib/db/schema';
import { readBuffer } from '$lib/file-store/storage';
import { extractText, kindFromMime } from '$lib/jkai/extract';
import { getLLMClient } from '$lib/llm/client';
import { resolveRagModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';
import type { ModelContext } from '$lib/server/models/types';
import { chunkText } from './chunk';
import { embedBatch, embedQuery } from './embed';
import { saveIndex, readIndex, deleteIndex } from './index-store';
import { retrieve, buildContextBlock } from './retrieve';
import type { RagChunk, RagCitation } from './types';

// Kinds we index. Audio/video are excluded — their "extraction" is ffmpeg+whisper
// transcription (heavy/slow) and not what "chat over my documents" implies.
const INDEXABLE_KINDS = new Set(['pdf', 'docx', 'doc', 'pptx', 'markdown', 'spreadsheet', 'text']);

export type BuildResult = {
  chunkCount: number;
  model: string;
  dim: number;
  indexedFiles: string[];
  skippedFiles: string[];
};

/**
 * (Re)build the index for a collection from the CURRENT bytes of its files.
 * Sets status → indexing → ready|error on the collection row.
 */
export async function buildCollection(collectionId: string): Promise<BuildResult> {
  const [col] = await db.select().from(ragCollections).where(eq(ragCollections.id, collectionId)).limit(1);
  if (!col) throw new Error('collection not found');

  await db
    .update(ragCollections)
    .set({ status: 'indexing', error: null, updatedAt: new Date() })
    .where(eq(ragCollections.id, collectionId));

  try {
    const ids = (col.fileIds as string[]) ?? [];
    const rows = ids.length
      ? await db.select().from(workflowFiles).where(inArray(workflowFiles.id, ids))
      : [];

    // Preserve the caller's file order for stable citations.
    const byId = new Map(rows.map((r) => [r.id, r]));
    const chunks: RagChunk[] = [];
    const chunkTexts: string[] = [];
    const indexedFiles: string[] = [];
    const skippedFiles: string[] = [];
    let ord = 0;

    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        skippedFiles.push(id);
        continue;
      }
      const kind = kindFromMime(row.mimeType, row.name);
      if (!kind || !INDEXABLE_KINDS.has(kind)) {
        skippedFiles.push(row.name);
        continue;
      }
      let text = '';
      try {
        const buf = await readBuffer(row.diskPath);
        const res = await extractText(buf, row.mimeType, row.name);
        text = res.text ?? '';
      } catch (err) {
        console.warn(`[rag] extract failed for ${row.name}: ${(err as Error).message}`);
        skippedFiles.push(row.name);
        continue;
      }
      const pieces = chunkText(text);
      if (!pieces.length) {
        skippedFiles.push(row.name);
        continue;
      }
      indexedFiles.push(row.name);
      for (const p of pieces) {
        chunks.push({
          id: `${collectionId}#${ord}`,
          text: p.text,
          vector: [], // filled after embedding
          source: row.name,
          ord,
          charStart: p.charStart,
          charEnd: p.charEnd,
        });
        chunkTexts.push(p.text);
        ord++;
      }
    }

    if (!chunks.length) {
      throw new Error(
        skippedFiles.length
          ? `No indexable text found (skipped: ${skippedFiles.join(', ')})`
          : 'No indexable text found in the selected files',
      );
    }

    const { vectors, model, dim } = await embedBatch(chunkTexts);
    for (let i = 0; i < chunks.length; i++) chunks[i].vector = vectors[i];

    const blobKey = await saveIndex(collectionId, chunks);

    const updated = await db
      .update(ragCollections)
      .set({
        status: 'ready',
        embeddingModel: model,
        embeddingDim: dim,
        chunkCount: chunks.length,
        indexBlobKey: blobKey,
        fileNames: indexedFiles,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(ragCollections.id, collectionId))
      .returning({ id: ragCollections.id });

    // The collection was deleted while we were building (delete removed its blob
    // before we wrote ours) — clean up the just-written blob so it isn't orphaned.
    if (updated.length === 0) {
      await deleteIndex(collectionId).catch(() => {});
    }

    return { chunkCount: chunks.length, model, dim, indexedFiles, skippedFiles };
  } catch (err) {
    const message = (err as Error).message || 'indexing failed';
    await db
      .update(ragCollections)
      .set({ status: 'error', error: message, updatedAt: new Date() })
      .where(eq(ragCollections.id, collectionId));
    throw err;
  }
}

const SYSTEM_PROMPT = `You are a document assistant. Answer the user's question using ONLY the provided document excerpts.

Rules:
- Ground every claim in the excerpts. When you use an excerpt, cite it inline as [n] using its number.
- If the answer is not contained in the excerpts, say so plainly — do not invent facts or use outside knowledge.
- Be concise and well-structured (Markdown). Prefer quoting or closely paraphrasing the source.`;

export type AnswerResult = { text: string; citations: RagCitation[]; usedContext: boolean };

/**
 * Stream a chat completion through the canonical LLM gateway (getLLMClient),
 * which routes through OpenRouter — so the caller can pick ANY model the
 * site's ModelPicker offers. GLM burns reasoning out of max_tokens, so the
 * ceiling stays generous (feedback_glm_reasoning_tokens).
 */
const STREAM_IDLE_TIMEOUT_MS = 45_000; // reasoning models can be slow to first token

async function streamAnswer(
  ctx: ModelContext,
  system: string,
  user: string,
  opts: { onToken?: (t: string) => void; signal?: AbortSignal },
): Promise<string> {
  const { client, model } = await getLLMClient(ctx);

  // Idle watchdog: abort if no token arrives within the timeout, so a stuck
  // provider can't hang the request forever (getLLMClient has no built-in one).
  const idleAc = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idleAc.abort(new Error('stream idle timeout')), STREAM_IDLE_TIMEOUT_MS);
  };
  if (opts.signal) {
    if (opts.signal.aborted) idleAc.abort(opts.signal.reason);
    else opts.signal.addEventListener('abort', () => idleAc.abort(opts.signal!.reason), { once: true });
  }
  resetIdle();

  try {
    const stream = (await (client.chat.completions.create as never as (...a: unknown[]) => Promise<AsyncIterable<{ choices: Array<{ delta?: { content?: string } }> }>>)(
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        max_tokens: 3000,
        stream: true,
      },
      { signal: idleAc.signal },
    ));
    let text = '';
    for await (const chunk of stream) {
      resetIdle();
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        opts.onToken?.(delta);
      }
    }
    return text;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}

/**
 * Answer a question over a built collection. Streams tokens via onToken and
 * returns the full text + the citations that were injected. `model` chooses
 * the generation model (defaults to the site chat model).
 */
export async function answer(
  collectionId: string,
  question: string,
  opts: { onToken?: (t: string) => void; signal?: AbortSignal; model?: ModelContext } = {},
): Promise<AnswerResult> {
  const [col] = await db.select().from(ragCollections).where(eq(ragCollections.id, collectionId)).limit(1);
  if (!col) throw new Error('collection not found');
  if (col.status !== 'ready' || !col.embeddingModel) throw new Error('collection is not ready');

  const index = await readIndex(collectionId);
  const queryVector = await embedQuery(question, col.embeddingModel);
  const hits = retrieve(index, queryVector);
  const { block, citations } = buildContextBlock(hits);

  const userPrompt = block
    ? `${block}\n\n--- Question ---\n${question}`
    : `The document index returned no relevant excerpts for this question.\n\n--- Question ---\n${question}`;

  const ctx = opts.model ?? (await resolveRagModel());
  const text = await withActivity('rag', () =>
    streamAnswer(ctx, SYSTEM_PROMPT, userPrompt, { onToken: opts.onToken, signal: opts.signal }),
  );

  return { text, citations: block ? citations : [], usedContext: !!block };
}

/** Owner-scoped fetch helper reused by the routes. */
export async function getOwnedCollection(collectionId: string, owner: string) {
  const [col] = await db
    .select()
    .from(ragCollections)
    .where(and(eq(ragCollections.id, collectionId), eq(ragCollections.owner, owner)))
    .limit(1);
  return col ?? null;
}

// A build only lives inside a single request/process. If the server is
// restarted (deploy/crash) mid-build, a collection is left 'indexing' forever
// with no worker to finish it. Reconcile on read: any in-flight collection whose
// updatedAt is older than this is treated as interrupted and flipped to 'error'
// so the owner gets a Retry affordance instead of an infinite spinner.
const STALE_INDEXING_MS = 5 * 60 * 1000;

/**
 * If the collection is stuck 'pending'/'indexing' past the stale threshold,
 * flip it to 'error' (persisted) and return the updated row; otherwise return
 * it unchanged. Safe to call from GET handlers.
 */
export async function reconcileStale<T extends { id: string; status: string; updatedAt: Date; error: string | null }>(
  col: T,
): Promise<T> {
  if (col.status !== 'pending' && col.status !== 'indexing') return col;
  const age = Date.now() - new Date(col.updatedAt).getTime();
  if (age < STALE_INDEXING_MS) return col;
  const message = 'Indexing was interrupted (the server likely restarted). Retry to rebuild.';
  await db
    .update(ragCollections)
    .set({ status: 'error', error: message, updatedAt: new Date() })
    .where(eq(ragCollections.id, col.id));
  return { ...col, status: 'error', error: message };
}
