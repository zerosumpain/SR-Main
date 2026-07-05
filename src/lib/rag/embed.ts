// Embeddings for RAG. Routed through the OpenRouter gateway exactly like
// $lib/jkai/intel/embed.ts (never a direct SDK path). Biases to quality:
// text-embedding-3-large (3072-dim, verified served by OpenRouter 2026-07-05),
// with an automatic fallback to text-embedding-3-small (1536-dim) if the large
// model is rejected. The blob index is dimension-agnostic, so either is safe;
// the chosen model + dim are recorded on the collection so query-time matches.

import { getLLMClient } from '$lib/jkai/llm-client';
import { normalize } from './retrieve';

export const PRIMARY_EMBEDDING_MODEL = 'openai/text-embedding-3-large';
export const FALLBACK_EMBEDDING_MODEL = 'openai/text-embedding-3-small';

/** Max chars per input (well under the 8191-token per-input limit). */
const MAX_INPUT_CHARS = 24000;
/** Inputs per request — keeps total request tokens comfortably bounded. */
const BATCH_SIZE = 48;

async function embedOnce(model: string, inputs: string[]): Promise<number[][]> {
  const { client } = await getLLMClient({ provider: 'openrouter', modelId: model });
  const truncated = inputs.map((t) => t.slice(0, MAX_INPUT_CHARS));
  const response = await client.embeddings.create({ model, input: truncated });
  // OpenAI returns data in a stable order but includes an explicit index; sort
  // defensively so vectors line up with inputs regardless of provider ordering.
  const out = [...response.data]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding as number[]);
  // Invariant: exactly one embedding per input. A short response would misalign
  // every subsequent chunk's vector and silently corrupt the index, so fail loud.
  if (out.length !== inputs.length) {
    throw new Error(`embedding count mismatch: got ${out.length} for ${inputs.length} inputs (model ${model})`);
  }
  return out;
}

export type EmbedResult = { vectors: number[][]; model: string; dim: number };

/**
 * Embed a batch of texts, unit-normalizing each vector. Tries the primary
 * (quality) model first; on the FIRST request failing, falls back to the
 * smaller model and stays on it for the rest of the run so every vector in a
 * collection shares one model + dimension.
 */
export async function embedBatch(texts: string[]): Promise<EmbedResult> {
  if (!texts.length) return { vectors: [], model: PRIMARY_EMBEDDING_MODEL, dim: 0 };

  let model = PRIMARY_EMBEDDING_MODEL;
  const vectors: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    let out: number[][];
    try {
      out = await embedOnce(model, batch);
    } catch (err) {
      // Only fall back before any vector was produced (i === 0); mid-run failure
      // of the primary would mix dimensions, so surface it instead.
      if (model === PRIMARY_EMBEDDING_MODEL && i === 0) {
        console.warn(
          `[rag] ${PRIMARY_EMBEDDING_MODEL} embedding failed (${(err as Error).message}); falling back to ${FALLBACK_EMBEDDING_MODEL}`,
        );
        model = FALLBACK_EMBEDDING_MODEL;
        out = await embedOnce(model, batch);
      } else {
        throw err;
      }
    }
    for (const v of out) vectors.push(normalize(v));
  }

  return { vectors, model, dim: vectors[0]?.length ?? 0 };
}

/** Embed a single query string with a specific model (to match a collection). */
export async function embedQuery(text: string, model: string): Promise<number[]> {
  const [v] = await embedOnce(model, [text.slice(0, MAX_INPUT_CHARS)]);
  return normalize(v);
}
