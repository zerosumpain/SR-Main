// Text chunker for RAG indexing. There is no existing chunker in the codebase
// to reuse, so this is a small, well-tested standalone util.
//
// Strategy: walk the text in windows of ~chunkChars. For each window, seek the
// nearest "good" break point (paragraph > sentence > whitespace) at or before
// the target end so chunks fall on natural boundaries. Consecutive chunks
// overlap by ~overlapChars so a passage split across a boundary is still
// retrievable from at least one chunk.

import { CHUNK_CHARS, OVERLAP_CHARS } from './types';

export type Chunk = {
  text: string;
  charStart: number;
  charEnd: number;
};

export type ChunkOptions = {
  chunkChars?: number;
  overlapChars?: number;
};

/** Look backwards from `hardEnd` for the best boundary at or after `minEnd`. */
function seekBoundary(text: string, minEnd: number, hardEnd: number): number {
  // 1. Paragraph break (blank line) — strongest boundary.
  const paraSearch = text.lastIndexOf('\n\n', hardEnd);
  if (paraSearch >= minEnd && paraSearch < hardEnd) return paraSearch + 2;

  // 2. Sentence terminator followed by whitespace.
  for (let i = hardEnd; i >= minEnd; i--) {
    const ch = text[i];
    if ((ch === '.' || ch === '!' || ch === '?' || ch === '\n') && /\s/.test(text[i + 1] ?? ' ')) {
      return i + 1;
    }
  }

  // 3. Any whitespace.
  for (let i = hardEnd; i >= minEnd; i--) {
    if (/\s/.test(text[i])) return i + 1;
  }

  // 4. No boundary found — hard cut.
  return hardEnd;
}

export function chunkText(input: string, options: ChunkOptions = {}): Chunk[] {
  const chunkChars = Math.max(50, options.chunkChars ?? CHUNK_CHARS);
  const overlapChars = Math.max(0, Math.min(options.overlapChars ?? OVERLAP_CHARS, Math.floor(chunkChars / 2)));

  if (!input || !input.trim()) return [];

  const text = input;
  const n = text.length;
  const chunks: Chunk[] = [];
  let start = 0;

  while (start < n) {
    // Skip leading whitespace so a chunk doesn't start blank.
    while (start < n && /\s/.test(text[start])) start++;
    if (start >= n) break;

    const targetEnd = Math.min(start + chunkChars, n);
    let end: number;
    if (targetEnd >= n) {
      end = n;
    } else {
      // Seek a boundary within the back ~40% of the window (never before the
      // 60% mark, so chunks don't collapse to tiny fragments).
      const minEnd = start + Math.floor(chunkChars * 0.6);
      end = seekBoundary(text, Math.min(minEnd, targetEnd), targetEnd);
      if (end <= start) end = targetEnd; // safety
    }

    const slice = text.slice(start, end).trim();
    if (slice) {
      const charStart = text.indexOf(slice[0], start);
      chunks.push({
        text: slice,
        charStart: charStart >= 0 ? charStart : start,
        charEnd: end,
      });
    }

    if (end >= n) break;
    // Advance with overlap, but always make forward progress.
    const next = end - overlapChars;
    start = next > start ? next : end;
  }

  return chunks;
}
