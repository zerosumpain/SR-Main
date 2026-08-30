/**
 * Segment a post body into paragraphs and sentences. The LLM is shown stable
 * indices like [0.0] / [1.2] and can refer to a sentence without ever
 * choosing arbitrary character boundaries — that eliminates "deleted too
 * much / too little" entirely, because the server resolves an index back
 * to the exact sentence string at apply time.
 */

export type Paragraph = { text: string; sentences: string[] };
export type Segmented = { paragraphs: Paragraph[] };

/**
 * The tags that end a "paragraph" for segmentation purposes.
 *
 * EXPORTED because `$lib/blog/assistant/autopilot` has to split the body the
 * same way to work out which paragraphs contain markup a plain-text rewrite
 * would destroy. Two copies of this pattern would drift, and the drift is
 * invisible: the indices still resolve, they just point at a different
 * paragraph, so the exclusion protects the wrong one.
 *
 * Only ever used with `String.replace`, which resets `lastIndex` on completion.
 * Do NOT call `.test()` on it — a shared /g regex is stateful between calls.
 *
 * `td`, `th`, `tr`, `summary`, `figcaption` and `aside` were added on
 * 2026-08-30. Without them a table collapsed into ONE run-on paragraph
 * ("ThingValueRowsShould have rules…"), which autopilot then offered to rewrite
 * as flowing prose — accepting that would have destroyed the table.
 */
export const BLOCK_END_RE =
  /<\/(?:p|h[1-6]|blockquote|li|pre|td|th|tr|summary|figcaption|aside|dd|dt)>/gi;
const TAG_RE = /<\/?[^>]+>/g;
// Sentence terminator followed by whitespace and an opener (capital, quote, paren).
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z"'(\[“‘])/g;

export function segmentBody(html: string): Segmented {
  // Replace block ends with a sentinel newline so paragraphs split cleanly,
  // then strip remaining inline tags.
  const withBoundaries = html.replace(BLOCK_END_RE, '\n');
  const stripped = withBoundaries.replace(TAG_RE, '');
  const paragraphs: Paragraph[] = [];
  for (const raw of stripped.split('\n')) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const sentences = text.split(SENTENCE_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
    paragraphs.push({ text, sentences: sentences.length ? sentences : [text] });
  }
  return { paragraphs };
}

/** Render the segmented body for the LLM's prompt with stable [p.s] indices. */
export function renderForPrompt(seg: Segmented): string {
  const lines: string[] = [];
  for (let p = 0; p < seg.paragraphs.length; p++) {
    const para = seg.paragraphs[p];
    if (para.sentences.length === 0) continue;
    for (let s = 0; s < para.sentences.length; s++) {
      lines.push(`[${p}.${s}] ${para.sentences[s]}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** Look up a sentence by index. Returns null if out of range. */
export function getSentence(seg: Segmented, paragraphIdx: number, sentenceIdx: number): string | null {
  const p = seg.paragraphs[paragraphIdx];
  if (!p) return null;
  return p.sentences[sentenceIdx] ?? null;
}
