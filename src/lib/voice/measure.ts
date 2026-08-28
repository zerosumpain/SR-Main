// The measured layer of the Voice Card. Pure functions over text — no DB, no
// LLM, no network — so every number here is reproducible and none of it can be
// hallucinated. `scripts/build-voice-card.ts` feeds it the corpus.
//
// Two deliberate restraints:
//
//   Distributions, not means. A mean sentence length hides "short sentences
//   with the occasional long one", which is the actual shape of John's prose.
//   Median and p90 keep it.
//
//   Names that match what is computed. There is no fragment detector here,
//   because detecting a true fragment needs a parser; `shortSentenceRate` says
//   what it counts. Inventing precision is the failure mode this whole card is
//   supposed to guard against.

// Relative, not $lib — scripts/build-voice-card.ts runs this under tsx, outside
// SvelteKit, where the alias does not resolve.
import { plainTextFromHtml, readability, countWords } from '../blog/readability';
import type { Measured, Rates, Spread, DistinctiveTerm } from './types';

/** Block-level tags that end a paragraph. Split on these BEFORE stripping tags,
 *  or the whole post collapses into one run-on paragraph. */
const BLOCK_END =
  /<\/(p|div|h[1-6]|li|blockquote|figcaption|pre|section|article|td|tr)\s*>|<br\s*\/?>/gi;

export function extractParagraphs(html: string): string[] {
  if (!html) return [];
  return html
    .replace(BLOCK_END, '\n\n')
    .split(/\n{2,}/)
    .map((chunk) => plainTextFromHtml(chunk).replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/** Sentence split on terminal punctuation. Good enough for prose; it will treat
 *  "e.g." as a boundary, which is why abbreviations are guarded explicitly. */
const ABBREV = /\b(?:e\.g|i\.e|etc|Mr|Mrs|Ms|Dr|vs|No|St|approx|Fig)\.$/i;

export function splitSentences(text: string): string[] {
  const rough = text.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  for (const piece of rough) {
    const prev = out[out.length - 1];
    if (prev !== undefined && ABBREV.test(prev)) {
      out[out.length - 1] = `${prev} ${piece}`;
    } else {
      out.push(piece);
    }
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

export function spread(values: number[]): Spread {
  if (values.length === 0) return { median: 0, p90: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    median: round1(at(0.5)),
    p90: round1(at(0.9)),
    max: sorted[sorted.length - 1],
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

// -- lexical markers -------------------------------------------------------

const CONTRACTION = /\b[a-z]+['’](?:s|t|re|ve|ll|d|m)\b/gi;
const FIRST_PERSON = /\b(?:I|I['’](?:m|ve|d|ll)|me|my|mine|myself)\b/g;

/** British spellings John actually uses. Kept short and specific — a long
 *  generated list would flag words that never appear and inflate the rate. */
const BRITISH =
  /\b\w*(?:ise|ised|ising|isation|isations|our|ours|oured|ogue|amme|ammes|lled|lling|yse|ysed)\b|\b(?:whilst|amongst|maths|autumn|programme|licence|defence|grey|realise|organise|recognise)\b/gi;

/** Americanisms. Every hit is a defect to fix, not a trait to reproduce. */
const AMERICANISMS =
  /\b(?:color|colors|colored|organize|organized|organizing|organization|recognize|recognized|analyze|analyzed|behavior|behaviors|favorite|favorites|center|centers|meter|meters|liter|liters|defense|offense|license(?=\s|$)|gotten|math\b|fall(?=\s+season)|apartment|elevator|sidewalk|gasoline|cellphone|realize|realized|specialty|traveled|traveling|canceled|labeled|modeling)\b/gi;

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

function rates(text: string, words: number): Rates {
  const per1000 = (n: number) => (words === 0 ? 0 : round2((n / words) * 1000));
  return {
    contractions: per1000(countMatches(text, CONTRACTION)),
    firstPerson: per1000(countMatches(text, FIRST_PERSON)),
    emDash: per1000(countMatches(text, /—/g)),
    semicolon: per1000(countMatches(text, /;/g)),
    colon: per1000(countMatches(text, /:/g)),
    parenthetical: per1000(countMatches(text, /\(/g)),
    exclamation: per1000(countMatches(text, /!/g)),
    question: per1000(countMatches(text, /\?/g)),
    britishSpellings: per1000(countMatches(text, BRITISH)),
    americanisms: per1000(countMatches(text, AMERICANISMS)),
  };
}

// -- distinctiveness -------------------------------------------------------

export function tokenise(text: string): string[] {
  return (text.toLowerCase().match(/\b[a-z][a-z'’-]*\b/g) ?? []).map((t) =>
    t.replace(/[’']$/, ''),
  );
}

function counts(texts: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of texts) {
    for (const tok of tokenise(t)) m.set(tok, (m.get(tok) ?? 0) + 1);
  }
  return m;
}

/**
 * Log-odds ratio with an informative Dirichlet prior (Monroe, Colaresi & Quinn
 * 2008). Raw frequency comparison returns "the, and, of"; a plain log-odds on a
 * corpus this small returns whatever hapax happened to land in one side. The
 * prior — the pooled counts of both corpora — shrinks rare terms toward zero,
 * and the z-score reports how much confidence the counts actually support.
 *
 * `minCount` is a second guard: below it, a term is noise however it scores.
 */
export function distinctiveTerms(
  target: string[],
  contrast: string[],
  { limit = 20, minCount = 4 }: { limit?: number; minCount?: number } = {},
): DistinctiveTerm[] {
  const yi = counts(target);
  const yj = counts(contrast);

  const vocab = new Set([...yi.keys(), ...yj.keys()]);
  const alpha = new Map<string, number>();
  let alpha0 = 0;
  for (const w of vocab) {
    const a = (yi.get(w) ?? 0) + (yj.get(w) ?? 0);
    alpha.set(w, a);
    alpha0 += a;
  }

  const ni = [...yi.values()].reduce((a, b) => a + b, 0);
  const nj = [...yj.values()].reduce((a, b) => a + b, 0);

  const out: DistinctiveTerm[] = [];
  for (const w of vocab) {
    const ci = yi.get(w) ?? 0;
    if (ci < minCount) continue;
    const cj = yj.get(w) ?? 0;
    const aw = alpha.get(w) ?? 0;

    const numI = ci + aw;
    const denI = ni + alpha0 - ci - aw;
    const numJ = cj + aw;
    const denJ = nj + alpha0 - cj - aw;
    if (numI <= 0 || denI <= 0 || numJ <= 0 || denJ <= 0) continue;

    const delta = Math.log(numI / denI) - Math.log(numJ / denJ);
    const variance = 1 / numI + 1 / numJ;
    const z = delta / Math.sqrt(variance);
    out.push({ term: w, z: round2(z), count: ci });
  }

  return out.sort((a, b) => b.z - a.z).slice(0, limit);
}

// -- the whole measurement -------------------------------------------------

/** Below this many words, the distribution stats describe these few documents
 *  rather than the person who wrote them, and the card says so out loud. */
export const CONFIDENT_CORPUS_WORDS = 10_000;

export type MeasureInput = {
  /** HTML or plain text, one entry per document. */
  documents: string[];
  /** Documents to compare against for distinctiveness. Optional — without it,
   *  `distinctive` comes back empty rather than fabricated. */
  contrast?: string[];
  /** Set false when documents are already plain text (chat turns). */
  isHtml?: boolean;
};

export function measure({ documents, contrast = [], isHtml = true }: MeasureInput): Measured {
  const paragraphsPerDoc = documents.map((d) =>
    isHtml ? extractParagraphs(d) : d.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
  );
  const paragraphs = paragraphsPerDoc.flat();
  const plain = paragraphs.join('\n\n');

  const sentences = paragraphs.flatMap(splitSentences);
  const sentenceWordCounts = sentences.map(countWords);
  const paragraphWordCounts = paragraphs.map(countWords);
  const words = paragraphWordCounts.reduce((a, b) => a + b, 0);

  const scores = readability(plain);
  const shortSentences = sentenceWordCounts.filter((n) => n > 0 && n <= 5).length;

  const contrastPlain = contrast.map((d) =>
    isHtml ? extractParagraphs(d).join('\n\n') : d,
  );

  const out: Measured = {
    posts: documents.length,
    words,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    fleschReadingEase: scores.fleschReadingEase,
    fleschKincaidGrade: scores.fleschKincaidGrade,
    audience: scores.audience,
    sentenceWords: spread(sentenceWordCounts),
    paragraphWords: spread(paragraphWordCounts),
    shortSentenceRate: sentences.length === 0 ? 0 : round2(shortSentences / sentences.length),
    rates: rates(plain, words),
    distinctive: contrastPlain.length > 0 ? distinctiveTerms([plain], contrastPlain) : [],
  };

  const topZ = out.distinctive[0]?.z ?? 0;
  if (out.distinctive.length > 0 && topZ < 1.96) {
    out.distinctive = out.distinctive.map((d) => ({ ...d }));
    out.distinctiveNote =
      `Nothing clears the usual z > 1.96 bar (top term scores ${topZ}), so read this as ` +
      `a ranking, not a set of findings. The list also mixes style with subject matter — ` +
      `at this corpus size a topic word and a habit are indistinguishable.`;
  }

  if (words < CONFIDENT_CORPUS_WORDS) {
    out.caveat =
      `Measured over ${words.toLocaleString('en-GB')} words across ${documents.length} ` +
      `document(s) — below the ${CONFIDENT_CORPUS_WORDS.toLocaleString('en-GB')}-word mark ` +
      `where these figures start describing the author rather than these particular ` +
      `documents. Treat them as bands to stay inside, not targets to hit.`;
  }

  return out;
}
