// Retrieval over an in-memory chunk index. Vectors are unit-normalized at
// write time, so cosine similarity is a plain dot product. Mirrors the shape of
// $lib/jkai/intel/context.ts (labelled context block, threshold, '' when empty).

import {
  RETRIEVE_TOP_K,
  RETRIEVE_MIN_SIM,
  MAX_PASSAGE_CHARS,
  type RagChunk,
  type RagHit,
  type RagCitation,
} from './types';

export function dot(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}

/** Unit-normalize; a zero vector maps to itself (all zeros) rather than NaN. */
export function normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v.map(() => 0);
  return v.map((x) => x / norm);
}

export type RetrieveOptions = { topK?: number; minSim?: number };

export function retrieve(
  index: RagChunk[],
  queryVector: number[],
  options: RetrieveOptions = {},
): RagHit[] {
  const topK = options.topK ?? RETRIEVE_TOP_K;
  const minSim = options.minSim ?? RETRIEVE_MIN_SIM;
  if (!index.length) return [];

  const scored: RagHit[] = index.map((c) => ({ ...c, score: dot(c.vector, queryVector) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((h) => h.score >= minSim).slice(0, topK);
}

/**
 * Assemble a numbered context block for injection into the model prompt, plus
 * the citation list surfaced back to the UI. Returns '' when there are no hits
 * so the caller can cleanly skip injecting empty context.
 */
export function buildContextBlock(hits: RagHit[]): { block: string; citations: RagCitation[] } {
  if (!hits.length) return { block: '', citations: [] };

  const citations: RagCitation[] = [];
  const parts: string[] = ['--- Documents ---'];
  hits.forEach((h, i) => {
    const n = i + 1;
    citations.push({ n, source: h.source, ord: h.ord });
    const passage = h.text.length > MAX_PASSAGE_CHARS ? h.text.slice(0, MAX_PASSAGE_CHARS) + '…' : h.text;
    parts.push(`[${n}] (${h.source})\n${passage}`);
  });
  return { block: parts.join('\n\n'), citations };
}
