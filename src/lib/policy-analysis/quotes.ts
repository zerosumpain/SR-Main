// Locating a model's quotation inside the text it was extracted from.
//
// WHY THIS EXISTS. The first production run of /policy-analysis died here.
// `validation.ts` asked for `passage.statement.includes(sourceQuote)` — an exact
// substring — against text that `extractPdf` hands over with the PDF's own hard
// line breaks still in it. A 20-page government PDF wraps at roughly 90
// characters, so any quotation longer than one line contains a newline the model
// did not reproduce:
//
//   passage:  "…we focus on what\nlandlords achieve, but we do not prescribe…"
//   quote:    "what landlords achieve"          <- verbatim, and not a substring
//
// Measured on the 19 quotations in that run's final rejected response: 10 passed
// exact matching, 19 passed the normalised matching below. At ~47% per quote
// over ~19 quotes a stage, the chance of a real document ever completing was nil.
//
// The normalisation is for LOCATING ONLY. Nothing stored is normalised: the
// caller gets offsets into the ORIGINAL text and the exact original substring,
// so provenance stays verbatim — strictly better than before, because a quote
// that survived exact matching was trusted as typed rather than re-read from the
// document.

/** Characters that carry no meaning for a quotation and are dropped outright. */
const INVISIBLE = new Set(['­', '​', '‌', '‍', '﻿']);

/** Typographic variants folded to their ASCII form before comparison. */
const FOLD: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '…': '...', ' ': ' ',
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl',
};

type Normalised = { text: string; map: number[] };

/**
 * Fold `source` for comparison, keeping a per-character index back into it.
 *
 * Whitespace runs collapse to one space, invisible characters vanish, typographic
 * variants fold to ASCII, case is dropped, and a hyphen immediately before a line
 * break is treated as hyphenation and removed with the break — all four are
 * artefacts of PDF extraction rather than differences of meaning.
 */
function normalise(source: string): Normalised {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (INVISIBLE.has(c)) continue;
    if (c === '-' || c === '‐' || c === '‑') {
      // "imple-\nmentation" is one word broken by the typesetter, not two.
      let j = i + 1;
      while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
      if (j < source.length && (source[j] === '\n' || source[j] === '\r')) {
        while (j < source.length && /\s/.test(source[j])) j++;
        i = j - 1;
        continue;
      }
    }
    if (/\s/.test(c)) {
      if (out.length) pendingSpace = true;
      continue;
    }
    if (pendingSpace) { out.push(' '); map.push(i); pendingSpace = false; }
    for (const ch of (FOLD[c] ?? c).toLowerCase()) { out.push(ch); map.push(i); }
  }
  return { text: out.join(''), map };
}

export type QuoteMatch = {
  /** Offset of the first character of the match in the ORIGINAL text. */
  start: number;
  /** Offset one past the last character of the match in the ORIGINAL text. */
  end: number;
  /** The original text's own wording for the span — what should be stored. */
  quote: string;
  /** True when the quotation was already a byte-exact substring. */
  exact: boolean;
};

/**
 * Find `quote` inside `source`, tolerating line wrapping, hyphenation, smart
 * punctuation, ligatures and case. Returns null when the quotation genuinely is
 * not in the text — a fabricated citation still fails, which is the point of the
 * check.
 */
export function locateQuote(source: string, quote: string): QuoteMatch | null {
  if (!quote) return null;
  const exactAt = source.indexOf(quote);
  if (exactAt >= 0) return { start: exactAt, end: exactAt + quote.length, quote, exact: true };

  const hay = normalise(source);
  const needle = normalise(quote);
  // A quotation folded away to nothing (or to punctuation alone) proves nothing.
  if (needle.text.replace(/[^a-z0-9]/g, '').length < 3) return null;
  const at = hay.text.indexOf(needle.text);
  if (at < 0) return null;
  const start = hay.map[at];
  const end = hay.map[at + needle.text.length - 1] + 1;
  return { start, end, quote: source.slice(start, end), exact: false };
}
