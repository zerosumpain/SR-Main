// Inline source citations for jkai replies.
//
// jkai's @files / @research answers name their sources in the prose (the skills
// tell the model to "cite the source file name(s)" / "cite the sourceTitle /
// sessionTopic"). Rather than dumping a chip row below the reply, we turn those
// in-prose mentions into clickable citation links that open the same viewers the
// chips do. Any source the model didn't mention by name is left for a compact
// fallback chip row, so no source is ever lost.
//
// This runs over the ALREADY-sanitised chat HTML (see sanitize-chat), purely as a
// string transform so it is SSR-safe (no DOMParser). The matched text is taken
// verbatim from the escaped HTML, and the only attributes we inject are a fixed
// class plus integer data-attributes — so linkification cannot introduce markup
// the sanitiser didn't already allow.

export type CiteKind = 'file' | 'research';

export interface CiteTarget {
  kind: CiteKind;
  /** Index back into the original fileRefs / researchRefs array. */
  idx: number;
  /** Candidate strings to look for in the prose, longest/most-specific first. */
  anchors: string[];
}

// Anchors shorter than this are too generic to match safely (e.g. a bare "ai"
// domain fragment would linkify unrelated prose).
const MIN_ANCHOR_LEN = 4;

/** Just the file's basename — the folder path is rarely written in prose. */
function basename(name: string): string {
  const parts = name.split('/').filter(Boolean);
  return parts[parts.length - 1] || name;
}

/** Candidate anchors for a @files reference, most-specific first. */
export function fileAnchors(source: string): string[] {
  const base = basename(source);
  const noExt = base.replace(/\.[^.]+$/, '');
  // Full path → basename → basename without extension. De-duped, order-preserving.
  return dedupeAnchors([source, base, noExt]);
}

/** Candidate anchors for a @research reference, most-specific first. */
export function researchAnchors(ref: {
  sourceTitle: string | null;
  domain: string | null;
  sessionTopic: string;
}): string[] {
  const candidates: string[] = [];
  if (ref.sourceTitle) candidates.push(ref.sourceTitle);
  if (ref.sessionTopic) candidates.push(ref.sessionTopic);
  if (ref.domain) candidates.push(ref.domain);
  // Models routinely shorten a title/topic to its leading phrase
  // ("Stealth scraping techniques in 2026" → "Stealth scraping"), so also offer
  // a leading-phrase prefix of the longest label as a looser anchor.
  const longest = ref.sourceTitle || ref.sessionTopic || '';
  const prefix = leadingPhrase(longest);
  if (prefix) candidates.push(prefix);
  return dedupeAnchors(candidates);
}

// Function words trimmed off the ends of a leading-phrase anchor so it stays a
// clean, distinctive fragment ("Anti-bot detection in" → "Anti-bot detection").
const STOP_WORDS = new Set([
  'in', 'of', 'the', 'a', 'an', 'and', 'for', 'to', 'on', 'at', 'with', 'from',
  '2024', '2025', '2026', '2027',
]);

/**
 * A short leading fragment of a label, for when the model shortens a title/topic
 * to its opening words ("Stealth scraping techniques in 2026" → "Stealth
 * scraping"). Takes the first two significant words so the anchor is a SUBSET the
 * shortened prose is likely to contain; returns '' when the label is already
 * short (a one-word prefix would be too generic).
 */
function leadingPhrase(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2) return '';
  const slice = words.slice(0, 2);
  while (slice.length && STOP_WORDS.has(slice[slice.length - 1].toLowerCase())) slice.pop();
  const phrase = slice.join(' ');
  return phrase.length >= MIN_ANCHOR_LEN + 2 ? phrase : '';
}

function dedupeAnchors(anchors: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of anchors) {
    const trimmed = (a ?? '').trim();
    if (trimmed.length < MIN_ANCHOR_LEN) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  // Longest first so a specific anchor (full filename) wins over a generic one
  // (basename without extension) when both could match at the same spot.
  return out.sort((a, b) => b.length - a.length);
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9]/.test(ch);
}

/**
 * Find the earliest, word-bounded, case-insensitive occurrence of `needle`
 * within `haystack`. Returns the match start index or -1. Boundaries stop a
 * filename anchor like "report" from matching inside "reporting".
 */
function findBounded(haystack: string, needle: string): number {
  const hay = haystack.toLowerCase();
  const nee = needle.toLowerCase();
  let from = 0;
  for (;;) {
    const at = hay.indexOf(nee, from);
    if (at < 0) return -1;
    const before = at > 0 ? haystack[at - 1] : undefined;
    const after = at + nee.length < haystack.length ? haystack[at + nee.length] : undefined;
    if (!isWordChar(before) && !isWordChar(after)) return at;
    from = at + 1;
  }
}

const OPEN_A = /^<a(\s|>)/i;
const CLOSE_A = /^<\/a\s*>/i;

/**
 * Wrap the first in-prose mention of each citation target in a clickable
 * `<a class="cite-link" data-cite-kind data-cite-idx>` element.
 *
 * - Operates on sanitised HTML as a tag/text token stream (SSR-safe).
 * - Never links inside an existing `<a>` (won't clobber a real markdown link).
 * - Each target links at most once; each text position is consumed once.
 *
 * Returns the rewritten HTML plus the set of targets that were matched, keyed
 * as `"<kind>:<idx>"` so the caller can render a fallback chip for the rest.
 */
export function linkifyCitations(
  html: string,
  targets: CiteTarget[],
): { html: string; matched: Set<string> } {
  const matched = new Set<string>();
  if (!html || targets.length === 0) return { html, matched };

  // Targets still available to match, tracked so each links only once.
  const remaining = targets.slice();

  // Split into tags vs text. Tags are kept verbatim; only text runs are rewritten.
  const tokens = html.split(/(<[^>]+>)/);
  let anchorDepth = 0;

  const out = tokens.map((tok) => {
    if (tok.startsWith('<')) {
      if (OPEN_A.test(tok)) anchorDepth++;
      else if (CLOSE_A.test(tok)) anchorDepth = Math.max(0, anchorDepth - 1);
      return tok;
    }
    if (anchorDepth > 0 || remaining.length === 0 || tok.length === 0) return tok;
    return rewriteTextRun(tok, remaining, matched);
  });

  return { html: out.join(''), matched };
}

/**
 * Within a single text run, repeatedly place the earliest available citation
 * match, splicing an anchor element around the matched text and continuing on
 * the tail so several distinct sources in one sentence each get linked.
 */
function rewriteTextRun(text: string, remaining: CiteTarget[], matched: Set<string>): string {
  let result = '';
  let rest = text;

  for (;;) {
    if (remaining.length === 0) break;

    // Find the earliest match across all remaining targets/anchors in `rest`.
    let best: { at: number; len: number; targetIdx: number } | null = null;
    for (let t = 0; t < remaining.length; t++) {
      for (const anchor of remaining[t].anchors) {
        const at = findBounded(rest, anchor);
        if (at < 0) continue;
        // Earliest wins; on a tie the longer anchor wins (more specific).
        if (!best || at < best.at || (at === best.at && anchor.length > best.len)) {
          best = { at, len: anchor.length, targetIdx: t };
        }
      }
    }
    if (!best) break;

    const target = remaining[best.targetIdx];
    const matchText = rest.slice(best.at, best.at + best.len);
    result += rest.slice(0, best.at);
    result +=
      `<a class="cite-link" role="button" tabindex="0"` +
      ` data-cite-kind="${target.kind}" data-cite-idx="${target.idx}">${matchText}</a>`;
    rest = rest.slice(best.at + best.len);
    matched.add(`${target.kind}:${target.idx}`);
    remaining.splice(best.targetIdx, 1);
  }

  return result + rest;
}
