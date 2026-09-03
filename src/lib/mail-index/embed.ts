// Embeddings for the mail passage index.
//
// Pinned to the SAME model and dimension as the @files index
// ($lib/file-index/embed) and for the same reason: every chunk has to share one
// vector space or a cross-corpus query is meaningless. It is pinned twice
// rather than imported once on purpose — the pin is a promise about what is
// already in the table, and a shared constant would let a change to /drive's
// index silently invalidate every mail vector without re-embedding them.
//
// Changing either value requires a full re-embed of that corpus. They are not
// config.

import { getLLMClient } from '$lib/llm/client';
import { normalize } from '$lib/rag/retrieve';
import { withActivity } from '$lib/context/activity';

export const MAIL_INDEX_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export const MAIL_INDEX_EMBEDDING_DIM = 1536;

/** Max chars per input, well under the 8191-token per-input limit. */
const MAX_INPUT_CHARS = 24000;
/** Inputs per request. */
const BATCH_SIZE = 48;

async function embedOnce(inputs: string[]): Promise<number[][]> {
  const { client } = await getLLMClient({
    provider: 'openrouter',
    modelId: MAIL_INDEX_EMBEDDING_MODEL,
  });
  const truncated = inputs.map((t) => t.slice(0, MAX_INPUT_CHARS));
  // Tagged so mail-index embedding spend joins the `embeddings` row rather than
  // the untagged gateway bucket. The model here is a constant of the INDEX (a
  // change re-vectors every stored row), so the tag names where the money went
  // without implying the picker can move it — see FILE_INDEX_EMBEDDING_MODEL's
  // sibling note.
  const response = await withActivity('embeddings', () =>
    client.embeddings.create({
      model: MAIL_INDEX_EMBEDDING_MODEL,
      input: truncated,
    }),
  );
  const out = [...response.data]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding as number[]);
  // One embedding per input, or every subsequent chunk gets the wrong vector
  // and the index is quietly wrong rather than loudly broken.
  if (out.length !== inputs.length) {
    throw new Error(`mail embedding count mismatch: got ${out.length} for ${inputs.length} inputs`);
  }
  return out;
}

/** Embed chunk texts, unit-normalizing each vector so cosine distance = 1 − dot. */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const out = await embedOnce(texts.slice(i, i + BATCH_SIZE));
    for (const v of out) vectors.push(normalize(v));
  }
  return vectors;
}

/** Embed one query the same way the chunks were embedded. */
export async function embedQuery(query: string): Promise<number[]> {
  const [vector] = await embedChunks([query]);
  return vector ?? [];
}
