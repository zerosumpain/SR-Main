// Embeddings for the global @files index. Mirrors $lib/rag/embed.ts (same
// gateway, same batching, same unit-normalization) but PINS a single model +
// dimension for the whole corpus: text-embedding-3-small (1536-dim). This is
// deliberate — the store is pgvector-backed (vector(1536)) and every chunk must
// share one vector space for cross-file retrieval to be meaningful, so there is
// no quality/size fallback here (unlike the per-collection RAG, which records a
// per-collection model and can differ from this one).

import { getLLMClient } from '$lib/llm/client';
import { normalize } from '$lib/rag/retrieve';

/** Pinned global model + dim for the @files index. Do not change without a full re-embed. */
export const FILE_INDEX_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export const FILE_INDEX_EMBEDDING_DIM = 1536;

/** Max chars per input (well under the 8191-token per-input limit). */
const MAX_INPUT_CHARS = 24000;
/** Inputs per request — keeps total request tokens comfortably bounded. */
const BATCH_SIZE = 48;

async function embedOnce(inputs: string[]): Promise<number[][]> {
  const { client } = await getLLMClient({ provider: 'openrouter', modelId: FILE_INDEX_EMBEDDING_MODEL });
  const truncated = inputs.map((t) => t.slice(0, MAX_INPUT_CHARS));
  const response = await client.embeddings.create({ model: FILE_INDEX_EMBEDDING_MODEL, input: truncated });
  const out = [...response.data]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding as number[]);
  // Invariant: exactly one embedding per input; a short response would misalign
  // every subsequent chunk's vector, so fail loud.
  if (out.length !== inputs.length) {
    throw new Error(`file-index embedding count mismatch: got ${out.length} for ${inputs.length} inputs`);
  }
  return out;
}

/** Embed a batch of chunk texts, unit-normalizing each vector. */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const out = await embedOnce(texts.slice(i, i + BATCH_SIZE));
    for (const v of out) vectors.push(normalize(v));
  }
  return vectors;
}

/** Embed a single query string with the pinned model (matches the stored index). */
export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedOnce([text.slice(0, MAX_INPUT_CHARS)]);
  return normalize(v);
}
