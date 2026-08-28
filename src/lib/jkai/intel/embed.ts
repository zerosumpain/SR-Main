import { getLLMClient } from '$lib/llm/client';
import { withActivity } from '$lib/context/activity';
import { db } from '$lib/db';
import { intelNotes, intelEntities } from '$lib/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';

/**
 * Characters sent per input, before any retry.
 *
 * The model's real limit is 8,192 TOKENS, and there is no honest constant that
 * converts one into the other: English prose runs about 4 chars a token, while
 * an email full of headers, URLs and quoted signatures runs closer to 2. This
 * module used to cut at 32,000 chars on the prose assumption and a 23,999-char
 * thread still overflowed — nine notes failed the backfill on 2026-08-27 with
 * `maximum context length is 8192 tokens`, and would have failed every night
 * afterwards.
 *
 * So the cut is conservative AND `shrinkToFit` below retries on overflow. The
 * guess gets the common case cheaply; the retry makes it correct.
 */
const MAX_INPUT_CHARS = 16_000;

/** How many times to halve an input that the model still says is too long. */
const SHRINK_ATTEMPTS = 3;

/** Does this error mean "your input was too long", as opposed to anything else? */
function isContextOverflow(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /maximum context length|context_length_exceeded|too many tokens|reduce the length/i.test(msg);
}

/**
 * Run an embedding call, halving the inputs each time the model says they are
 * too long.
 *
 * Truncating harder is safe here in a way it would not be for a chat call: an
 * embedding of the first half of a thread is a slightly worse vector, whereas
 * no embedding at all means the note is invisible to every similarity search
 * for ever. A worse answer beats an absent one.
 */
async function shrinkToFit<T>(
  inputs: string[],
  call: (inputs: string[]) => Promise<T>,
): Promise<T> {
  let cut = MAX_INPUT_CHARS;
  let lastError: unknown;
  for (let attempt = 0; attempt <= SHRINK_ATTEMPTS; attempt += 1) {
    try {
      return await call(inputs.map((t) => t.slice(0, cut)));
    } catch (err) {
      if (!isContextOverflow(err)) throw err;
      lastError = err;
      cut = Math.floor(cut / 2);
      console.warn(`[intel:embed] input too long — retrying at ${cut} chars`);
    }
  }
  throw lastError;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const { client } = await getLLMClient({ provider: 'openrouter', modelId: EMBEDDING_MODEL });

  const response = await shrinkToFit([text], (inputs) =>
    withActivity('embeddings', () =>
      client.embeddings.create({ model: EMBEDDING_MODEL, input: inputs[0] }),
    ),
  );

  return response.data[0].embedding;
}

/** Embeddings for several texts in one API call, in the order given. */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const { client } = await getLLMClient({ provider: 'openrouter', modelId: EMBEDDING_MODEL });
  const response = await shrinkToFit(texts, (inputs) =>
    withActivity('embeddings', () =>
      client.embeddings.create({ model: EMBEDDING_MODEL, input: inputs }),
    ),
  );
  // The API may return results out of order; `index` is authoritative.
  const out: number[][] = new Array(texts.length);
  for (const item of response.data) out[item.index] = item.embedding;
  return out;
}

export async function embedNote(noteId: string): Promise<void> {
  const [note] = await db
    .select({ id: intelNotes.id, processedContent: intelNotes.processedContent, rawContent: intelNotes.rawContent })
    .from(intelNotes)
    .where(eq(intelNotes.id, noteId))
    .limit(1);

  if (!note) return;

  const text = note.processedContent || note.rawContent;
  if (!text) return;

  const embedding = await generateEmbedding(text);

  await db
    .update(intelNotes)
    .set({ embedding })
    .where(eq(intelNotes.id, noteId));
}

/** The text an entity is embedded as. A name alone is enough to be useful. */
export function entityEmbeddingText(entity: {
  name: string;
  summary?: string | null;
  properties?: unknown;
}): string {
  return [
    entity.name,
    entity.summary ?? '',
    entity.properties ? JSON.stringify(entity.properties) : '',
  ]
    .filter(Boolean)
    .join(' — ');
}

export async function embedEntity(entityId: string): Promise<void> {
  const [entity] = await db
    .select()
    .from(intelEntities)
    .where(eq(intelEntities.id, entityId))
    .limit(1);

  if (!entity) return;

  const text = entityEmbeddingText(entity);
  if (!text) return;

  const embedding = await generateEmbedding(text);

  await db
    .update(intelEntities)
    .set({ embedding })
    .where(eq(intelEntities.id, entityId));
}

/**
 * Embed every entity that hasn't got a vector yet.
 *
 * This matters more than it looks. `extract.ts` retrieves entity-resolution
 * candidates with `WHERE embedding IS NOT NULL`, so an entity without one is
 * invisible to the matcher and a later note mentioning the same thing creates a
 * duplicate. Embeddings were only ever written as a side effect of the summary
 * pass, so entities the summariser skipped (no evidence to summarise from) were
 * left permanently unembedded — 342 of 492 in production, meaning roughly 70%
 * of the graph could not participate in its own deduplication.
 *
 * Batched, because one API call per entity for hundreds of entities is slow and
 * needlessly expensive. Name-only text is fine: an entity called "IBCA" embeds
 * usefully whether or not anyone has summarised it.
 */
export async function backfillEntityEmbeddings(
  limit = 500,
  batchSize = 96,
): Promise<{ embedded: number; remaining: number; failed: number }> {
  const capped = Math.max(1, Math.min(limit, 2000));

  const rows = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      summary: intelEntities.summary,
      properties: intelEntities.properties,
    })
    .from(intelEntities)
    .where(and(isNull(intelEntities.embedding), isNull(intelEntities.mergedIntoId)))
    .limit(capped);

  let embedded = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).filter((r) => entityEmbeddingText(r));
    if (!batch.length) continue;
    try {
      const vectors = await generateEmbeddings(batch.map((r) => entityEmbeddingText(r)));
      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (!vec) continue;
        await db
          .update(intelEntities)
          .set({ embedding: vec })
          .where(eq(intelEntities.id, batch[j].id));
        embedded++;
      }
    } catch (err) {
      // One bad batch must not abandon the sweep.
      failed += batch.length;
      console.error(
        '[intel:embed] batch failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  const [{ count: remaining } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(intelEntities)
    .where(and(isNull(intelEntities.embedding), isNull(intelEntities.mergedIntoId)));

  console.log(`[intel:embed] backfill — embedded ${embedded}, failed ${failed}, ${remaining} left`);
  return { embedded, remaining, failed };
}
