/**
 * Autopilot — a whole-post editing pass in John's own voice, without a chat turn.
 *
 * WHAT THIS IS NOT, and why. The obvious build is "send the model the document
 * and take back a rewritten document". That is the one shape this codebase
 * cannot safely use: `segmentBody` strips every tag before the model sees
 * anything, so a document-level rewrite generated from that view silently
 * deletes every link, image, code block and footnote in the post. The author
 * would accept a fluent-looking rewrite and lose their references.
 *
 * So autopilot rides the mechanism that is already proven instead: per-sentence
 * rewrites addressed by `[paragraphIdx.sentenceIdx]`, resolved back to exact
 * text server-side, surfaced as ordinary proposals in the margin, accepted or
 * rejected one at a time. Nothing is saved and nothing is published; the pass
 * only proposes. What is new is that it runs over the WHOLE post in one go and
 * has an intent, rather than waiting to be asked in chat.
 *
 * Everything here is pure. The route does the I/O.
 */

import { BLOCK_END_RE, getSentence, segmentBody, type Segmented } from './segment';

export type AutopilotMode = 'readability' | 'context' | 'voice';

export const AUTOPILOT_MODES: { key: AutopilotMode; label: string; blurb: string }[] = [
  {
    key: 'readability',
    label: 'Readability',
    blurb: 'Untangle the sentences that fight the reader — without shortening his voice.',
  },
  {
    key: 'context',
    label: 'Add context',
    blurb: 'Fill in the detail a reader who was not there would need.',
  },
  {
    key: 'voice',
    label: 'Tighten',
    blurb: 'Cut padding and hedging. Keeps the looseness, drops the filler.',
  },
];

export type SentenceRewrite = {
  paragraphIdx: number;
  sentenceIdx: number;
  suggested: string;
  reason: string;
};

/**
 * Paragraph indices whose source contains markup a plain-text rewrite would
 * destroy.
 *
 * `segmentBody` splits on block-closing tags and then strips everything else,
 * so a paragraph's INLINE markup — a link, an inline image, a code span — is
 * invisible downstream. Replacing that paragraph's sentence with plain text
 * therefore removes the anchor tag along with it. The rewrite still *reads*
 * correctly, which is exactly what makes it dangerous: nothing looks wrong
 * until a reader clicks a citation that is no longer a link.
 *
 * Emphasis (`<em>`, `<strong>`, `<b>`, `<i>`) is deliberately NOT risky. It is
 * decoration rather than information, losing it costs the reader nothing, and
 * treating it as risky would exclude most of a well-written post.
 *
 * The split here MUST mirror `segmentBody`'s, or the indices refer to different
 * paragraphs and the exclusion protects the wrong ones.
 */
// Imported, never re-declared — see the note on the export.
// (removed local copy)
// `table`, `aside` and `details` join the list because their STRUCTURE is the
// content: a rewrite that flattens a table into a sentence reads fine and
// destroys the thing.
const RISKY_MARKUP_RE = /<\s*(a|img|code|iframe|video|sup|sub|figure|table|aside|details)\b/i;

export function riskyParagraphs(html: string): Set<number> {
  const risky = new Set<number>();
  // Mirrors segmentBody EXACTLY: block ends become newlines, split on newline,
  // skip chunks that strip to nothing. Any divergence here -- a different
  // separator, a different emptiness test -- shifts the index, and the
  // exclusion then protects the WRONG paragraph. That is worse than no
  // exclusion at all, because it reads as if it worked.
  const chunks = html.replace(BLOCK_END_RE, '\n').split('\n');
  let idx = 0;
  for (const chunk of chunks) {
    const text = chunk.replace(/<\/?[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (RISKY_MARKUP_RE.test(chunk)) risky.add(idx);
    idx += 1;
  }
  return risky;
}

const MODE_INSTRUCTIONS: Record<AutopilotMode, string> = {
  readability: `GOAL: readability. Find the sentences a reader has to go back and re-read — buried subjects, three clauses of qualification before the point, a pronoun whose referent is four sentences away. Fix those.
DO NOT shorten his sentences as a goal in itself. His median sentence is nineteen words and his long comma-spliced sentences are the voice, not a defect in it. A rewrite that is merely SHORTER is not an improvement and must not be proposed.`,
  context: `GOAL: context. Find the places where the author knows something the reader does not — an unexplained name, an acronym, a decision whose reasoning is assumed, a number with no baseline. Propose the sentence that fills that gap.
You may ONLY add context you can derive from the post itself. If the missing detail is not present anywhere in the text, do NOT invent it — skip that sentence. An invented specific is worse than a gap, because the author will not catch it.`,
  voice: `GOAL: tighten. Cut hedging ("I think perhaps", "it could be argued"), throat-clearing openers, and words doing no work. Keep every contraction, every fragment and every aside — those are his register.
This is subtraction, not rephrasing. If a sentence has nothing to cut, skip it.`,
};

/**
 * Built as a function, never a module-level constant.
 *
 * `voiceBlock()` reads the Voice Card off disk. A module-level template literal
 * would run that read at import time and freeze the card until the process
 * restarted, so a regenerated card would never reach a running server. Three
 * other prompt builders in this repo carry the same note for the same reason.
 */
export function autopilotSystemPrompt(mode: AutopilotMode, voiceBlockText: string): string {
  return `You are running an editorial pass over one blog post for strangeramblings.com. You ONLY propose changes; the author accepts or rejects each one in the margin. Nothing you return is applied automatically and nothing is published.

${voiceBlockText}

${MODE_INSTRUCTIONS[mode]}

HOW TO ADDRESS A SENTENCE
The post is given to you as one indexed sentence per line:
    [paragraphIdx.sentenceIdx] sentence text
To rewrite one, return its two indices and the full replacement. You never pick
character offsets and you never supply a find-string — the server resolves the
indices back to the exact sentence.

HARD RULES
- \`suggested\` is PLAIN PROSE. No HTML, no markdown, no quotes around it.
- Rewrite a COMPLETE sentence. The replacement may itself be more than one
  sentence if the original was a run-on.
- Some paragraphs are marked UNAVAILABLE. Never propose a rewrite in one. They
  contain links or embedded media that a plain-text replacement would delete.
- Propose AT MOST 8 rewrites, and fewer is better. Choose the ones that change
  the reading experience most. A pass that proposes nothing is a valid and
  useful answer when the post is already good — say so and return an empty list.
- Every rewrite carries a one-sentence \`reason\` written for the author, not for
  a marking scheme.

Return ONLY JSON of this exact shape:
{"rewrites":[{"paragraphIdx":0,"sentenceIdx":1,"suggested":"…","reason":"…"}]}`;
}

/** Render the body for the prompt, marking the paragraphs that are off-limits. */
export function renderForAutopilot(seg: Segmented, risky: Set<number>): string {
  const lines: string[] = [];
  for (let p = 0; p < seg.paragraphs.length; p++) {
    const para = seg.paragraphs[p];
    if (!para.sentences.length) continue;
    if (risky.has(p)) {
      lines.push(`[${p}] UNAVAILABLE (contains a link or embedded media): ${para.text}`);
      lines.push('');
      continue;
    }
    for (let s = 0; s < para.sentences.length; s++) {
      lines.push(`[${p}.${s}] ${para.sentences[s]}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function parseRewrites(raw: string, max = 8): SentenceRewrite[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (parsed as { rewrites?: unknown })?.rewrites;
  if (!Array.isArray(list)) return [];

  const out: SentenceRewrite[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const paragraphIdx = Number(r.paragraphIdx);
    const sentenceIdx = Number(r.sentenceIdx);
    const suggested = typeof r.suggested === 'string' ? r.suggested.trim() : '';
    const reason = typeof r.reason === 'string' ? r.reason.trim() : '';
    if (!Number.isInteger(paragraphIdx) || paragraphIdx < 0) continue;
    if (!Number.isInteger(sentenceIdx) || sentenceIdx < 0) continue;
    if (!suggested) continue;
    out.push({ paragraphIdx, sentenceIdx, suggested, reason: reason || 'Autopilot suggestion.' });
    if (out.length >= max) break;
  }
  return out;
}

export type FilterResult = {
  kept: SentenceRewrite[];
  dropped: { rewrite: SentenceRewrite; why: string }[];
};

/**
 * Drop everything unsafe or pointless BEFORE it reaches the author.
 *
 * A pass that surfaces eight suggestions of which three are no-ops and one
 * deletes a link is worse than one that surfaces four good ones — the author
 * stops reading them. Each rejection is recorded with a reason so the run can
 * report honestly on what it discarded rather than silently shrinking.
 */
export function filterRewrites(
  rewrites: SentenceRewrite[],
  html: string,
  risky: Set<number>,
): FilterResult {
  const seg = segmentBody(html);
  const kept: SentenceRewrite[] = [];
  const dropped: { rewrite: SentenceRewrite; why: string }[] = [];
  const seen = new Set<string>();

  for (const r of rewrites) {
    const key = `${r.paragraphIdx}.${r.sentenceIdx}`;
    if (seen.has(key)) {
      dropped.push({ rewrite: r, why: 'duplicate index' });
      continue;
    }
    seen.add(key);

    if (risky.has(r.paragraphIdx)) {
      dropped.push({ rewrite: r, why: 'paragraph contains a link or embedded media' });
      continue;
    }

    const original = getSentence(seg, r.paragraphIdx, r.sentenceIdx);
    if (!original) {
      dropped.push({ rewrite: r, why: 'no sentence at that index' });
      continue;
    }

    // The model returned the sentence unchanged, or changed only whitespace.
    if (original.replace(/\s+/g, ' ').trim() === r.suggested.replace(/\s+/g, ' ').trim()) {
      dropped.push({ rewrite: r, why: 'identical to the original' });
      continue;
    }

    // Markup leaking into a plain-prose field. The apply path strips tags
    // anyway, but a rewrite the model wrapped in <p> is a sign it misread the
    // brief, and the stripped result is usually wrong too.
    if (/<[a-z/][^>]*>/i.test(r.suggested)) {
      dropped.push({ rewrite: r, why: 'contains markup' });
      continue;
    }

    // A "rewrite" three times the length of the original is not an edit, it is
    // the model writing its own paragraph. Context mode is allowed more room
    // than the others, but not unbounded.
    if (r.suggested.length > Math.max(400, original.length * 3)) {
      dropped.push({ rewrite: r, why: 'far longer than the original' });
      continue;
    }

    kept.push(r);
  }

  return { kept, dropped };
}
