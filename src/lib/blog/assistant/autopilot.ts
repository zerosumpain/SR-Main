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
 * So autopilot rides the mechanism that is already proven instead: rewrites
 * addressed by INDEX, resolved back to exact text server-side, surfaced as
 * ordinary proposals in the margin, accepted or rejected one at a time. Nothing
 * is saved and nothing is published; the pass only proposes.
 *
 * THE UNIT IS THE PARAGRAPH (changed 2026-09-04). It used to be the sentence,
 * and that made every suggestion small by construction: the model could tighten
 * a clause but could not say "this paragraph makes its point twice", "you open
 * on the setup and the thing that happened arrives three paragraphs later", or
 * "these two want to be one". Those are the edits that change how a piece
 * reads, and the addressing scheme was the only thing preventing them.
 *
 * So `sentenceIdx` is now OPTIONAL. Null means the rewrite replaces the whole
 * paragraph at `paragraphIdx`; a number still addresses one sentence inside it,
 * because sometimes one sentence really is the problem. Both resolve through
 * the same index-to-text lookup and both land as the same proposal shape, so
 * the accept path, the anchor search and the taste signal are all unchanged.
 *
 * The safety property is unchanged too, and it is the load-bearing one: a
 * paragraph holding a link or an embedded image is still UNAVAILABLE, because a
 * plain-text replacement of it deletes the markup. Widening the unit widens what
 * is at stake in getting that wrong, not what is allowed.
 *
 * Everything here is pure. The route does the I/O.
 */

import { BLOCK_END_RE, getParagraph, getSentence, segmentBody, type Segmented } from './segment';
import { stripReferences } from '$lib/blog/references';

export type AutopilotMode = 'flow' | 'readability' | 'context' | 'voice';

/** `flow` leads because it is the pass that answers the question the others
 *  cannot: does this piece arrive in the right order. */
export const AUTOPILOT_MODES: { key: AutopilotMode; label: string; blurb: string }[] = [
  {
    key: 'flow',
    label: 'Flow & structure',
    blurb: 'Where the story loses its thread — order, repetition, the paragraph that buries the point.',
  },
  {
    key: 'readability',
    label: 'Readability',
    blurb: 'Untangle the paragraphs that fight the reader — without shortening his voice.',
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

/**
 * One proposed rewrite.
 *
 * `sentenceIdx: null` means the whole paragraph at `paragraphIdx` — the default
 * unit. A number addresses one sentence inside it, kept because a single
 * mis-built sentence in an otherwise good paragraph is a real case and
 * replacing six good sentences to fix it is a worse edit, not a bigger one.
 *
 * Named `Rewrite`, not `SentenceRewrite`, because the sentence is now the
 * exception rather than the unit.
 */
export type Rewrite = {
  paragraphIdx: number;
  sentenceIdx: number | null;
  suggested: string;
  reason: string;
};

/** What a rewrite replaces, for messages and for the length rules. */
export function rewriteScope(r: Rewrite): 'paragraph' | 'sentence' {
  return r.sentenceIdx === null ? 'paragraph' : 'sentence';
}

/** How a rewrite is addressed in a status line: `[3]` or `[3.1]`. */
export function rewriteAddress(r: Rewrite): string {
  return r.sentenceIdx === null ? `${r.paragraphIdx}` : `${r.paragraphIdx}.${r.sentenceIdx}`;
}

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
  // `segmentBody` strips the sources block before it splits, so this must too
  // — otherwise a post with references indexes its paragraphs one way here and
  // another way there, and the exclusion protects the wrong paragraph while
  // still looking like it worked.
  const chunks = stripReferences(html).replace(BLOCK_END_RE, '\n').split('\n');
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
  flow: `GOAL: flow and structure. You are reading this as a piece of storytelling, not as a set of sentences. Ask the questions only a whole-post reader can:
- Does it start in the right place? A post that opens on three paragraphs of setup before the thing that actually happened is the commonest fault here.
- Does any paragraph make its point twice, or make a point an earlier one already made?
- Is there a paragraph doing two jobs that wants to be two paragraphs, or two that want to be one?
- Does a paragraph land its point, or trail off into a qualification?
- Is anything introduced without the reader having what they need to follow it, or explained twice because the order is wrong?
Rewrite the PARAGRAPHS where the answer is a problem you can fix in place — a stronger opening paragraph, a merged pair, a paragraph reordered inside itself so its point arrives first.
When the fault is that two paragraphs are in the wrong ORDER relative to each other, you cannot fix that by rewriting one. Say so in the \`reason\` of the paragraph you would move, and propose the rewrite that makes it work where it is — the author moves it or not.`,
  readability: `GOAL: readability. Find the paragraphs a reader has to go back and re-read — a buried subject, three clauses of qualification before the point, a pronoun whose referent is four sentences away, a paragraph whose first sentence promises something the rest does not deliver. Fix those, rewriting the whole paragraph so the fix lands in the shape of the paragraph rather than in one clause of it.
DO NOT shorten his sentences as a goal in itself. His median sentence is nineteen words and his long comma-spliced sentences are the voice, not a defect in it. A rewrite that is merely SHORTER is not an improvement and must not be proposed.`,
  context: `GOAL: context. Find the places where the author knows something the reader does not — an unexplained name, an acronym, a decision whose reasoning is assumed, a number with no baseline. Rewrite the paragraph so the missing detail arrives where the reader needs it, rather than bolting an explanatory sentence onto the end.
You may ONLY add context you can derive from the post itself. If the missing detail is not present anywhere in the text, do NOT invent it — skip that paragraph. An invented specific is worse than a gap, because the author will not catch it.`,
  voice: `GOAL: tighten. Cut hedging ("I think perhaps", "it could be argued"), throat-clearing openers, and words doing no work. Keep every contraction, every fragment and every aside — those are his register.
Work paragraph by paragraph: the padding in a piece is usually a whole sentence of throat-clearing at the top of a paragraph, not a spare adjective. This is subtraction, not rephrasing. If a paragraph has nothing to cut, skip it.`,
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

HOW TO ADDRESS A REWRITE
The post is given to you as one indexed PARAGRAPH per block:
    [paragraphIdx] the whole paragraph
To replace a paragraph, return its index with "sentenceIdx": null and the full
replacement paragraph. You never pick character offsets and you never supply a
find-string — the server resolves the index back to the exact text.

Where a paragraph is broken down further you will also see its sentences:
    [paragraphIdx.sentenceIdx] sentence text
Address one of those ONLY when a single sentence is the whole problem and the
rest of the paragraph is right. Replacing six good sentences to fix one is a
worse edit, not a bigger one.

WORK AT THE SCALE OF THE ARGUMENT
Prefer whole-paragraph rewrites. A pass that returns six polished clauses has
not read the piece; a pass that returns three paragraphs which now land their
points in the right order has. If the post's problem is its shape rather than
its sentences, say so in the reasons and propose the paragraph rewrites that
change the shape.

HARD RULES
- \`suggested\` is PLAIN PROSE. No HTML, no markdown, no quotes around it. A
  paragraph replacement is one paragraph of prose — do not include a blank line
  or try to split it into two.
- Some paragraphs are marked UNAVAILABLE. Never propose a rewrite in one. They
  contain links or embedded media that a plain-text replacement would delete.
- Propose AT MOST 6 rewrites, and fewer is better. Choose the ones that change
  the reading experience most. A pass that proposes nothing is a valid and
  useful answer when the post is already good — say so and return an empty list.
- Every rewrite carries a \`reason\` written for the author, not for a marking
  scheme. For a paragraph rewrite the reason should say what was wrong with the
  paragraph as a unit — "this makes the same point as the one above it", "the
  point arrives in the last line and the reader needs it in the first" — not
  what words you changed.

Return ONLY JSON of this exact shape. "sentenceIdx" is null for a paragraph
rewrite and a number for a single-sentence one:
{"rewrites":[{"paragraphIdx":0,"sentenceIdx":null,"suggested":"…","reason":"…"}]}`;
}

/**
 * Render the body for the prompt, marking the paragraphs that are off-limits.
 *
 * The paragraph is shown FIRST and whole, then its sentences underneath. That
 * ordering is the prompt doing the same job the mode instructions do: the model
 * reads the unit it is meant to work in before it reads the unit it may fall
 * back to. When the sentence list came first, every pass addressed sentences.
 *
 * A one-sentence paragraph gets no sentence list — `[3]` and `[3.0]` would name
 * the same text, and offering both invites a duplicate proposal against one
 * piece of prose.
 */
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
    lines.push(`[${p}] ${para.text}`);
    if (para.sentences.length > 1) {
      for (let sn = 0; sn < para.sentences.length; sn++) {
        lines.push(`    [${p}.${sn}] ${para.sentences[sn]}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function parseRewrites(raw: string, max = 6): Rewrite[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (parsed as { rewrites?: unknown })?.rewrites;
  if (!Array.isArray(list)) return [];

  const out: Rewrite[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const paragraphIdx = Number(r.paragraphIdx);
    const suggested = typeof r.suggested === 'string' ? r.suggested.trim() : '';
    const reason = typeof r.reason === 'string' ? r.reason.trim() : '';
    if (!Number.isInteger(paragraphIdx) || paragraphIdx < 0) continue;
    if (!suggested) continue;

    // A paragraph rewrite is the default, so ANYTHING that is not a usable
    // sentence index becomes one: null, undefined, an omitted key, a string.
    // The alternative — dropping the rewrite — would silently discard the
    // model's most valuable output whenever it expressed "whole paragraph" in
    // a slightly different way than asked.
    const rawSentence = r.sentenceIdx;
    const sentenceNum = Number(rawSentence);
    const sentenceIdx =
      rawSentence === null || rawSentence === undefined || !Number.isInteger(sentenceNum) || sentenceNum < 0
        ? null
        : sentenceNum;

    out.push({ paragraphIdx, sentenceIdx, suggested, reason: reason || 'Autopilot suggestion.' });
    if (out.length >= max) break;
  }
  return out;
}

export type FilterResult = {
  kept: Rewrite[];
  dropped: { rewrite: Rewrite; why: string }[];
};

/**
 * A paragraph rewrite that comes back far shorter than the paragraph it
 * replaces has usually dropped a clause the author cared about rather than
 * tightened anything — the model summarised. Tighten mode legitimately cuts, so
 * the floor is generous; it is here to catch "replaced six sentences with one",
 * not to police an edit that removed a hedge.
 *
 * Sentence rewrites get no floor. Cutting a sentence in half is often the whole
 * point of one.
 */
const PARAGRAPH_MIN_RATIO = 0.45;

/**
 * Drop everything unsafe or pointless BEFORE it reaches the author.
 *
 * A pass that surfaces eight suggestions of which three are no-ops and one
 * deletes a link is worse than one that surfaces four good ones — the author
 * stops reading them. Each rejection is recorded with a reason so the run can
 * report honestly on what it discarded rather than silently shrinking.
 */
export function filterRewrites(
  rewrites: Rewrite[],
  html: string,
  risky: Set<number>,
): FilterResult {
  const seg = segmentBody(html);
  const kept: Rewrite[] = [];
  const dropped: { rewrite: Rewrite; why: string }[] = [];
  const seen = new Set<string>();
  // A paragraph rewrite and a sentence rewrite inside that same paragraph
  // overlap: accepting both applies one on top of the other and the second
  // anchor no longer exists. The paragraph wins, because it is the unit this
  // pass is for, and the sentence is reported as dropped rather than vanishing.
  const paragraphScoped = new Set(
    rewrites.filter((r) => r.sentenceIdx === null).map((r) => r.paragraphIdx),
  );

  for (const r of rewrites) {
    const key = rewriteAddress(r);
    if (seen.has(key)) {
      dropped.push({ rewrite: r, why: 'duplicate index' });
      continue;
    }
    seen.add(key);

    if (risky.has(r.paragraphIdx)) {
      dropped.push({ rewrite: r, why: 'paragraph contains a link or embedded media' });
      continue;
    }

    if (r.sentenceIdx !== null && paragraphScoped.has(r.paragraphIdx)) {
      dropped.push({ rewrite: r, why: 'the whole paragraph is already being rewritten' });
      continue;
    }

    const original =
      r.sentenceIdx === null
        ? getParagraph(seg, r.paragraphIdx)
        : getSentence(seg, r.paragraphIdx, r.sentenceIdx);
    if (!original) {
      dropped.push({
        rewrite: r,
        why: r.sentenceIdx === null ? 'no paragraph at that index' : 'no sentence at that index',
      });
      continue;
    }

    // The model returned the text unchanged, or changed only whitespace.
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

    // A "rewrite" several times the length of the original is not an edit, it
    // is the model writing its own passage. The ceiling is tighter for a
    // paragraph than a sentence: tripling a sentence is a legitimate split,
    // tripling a paragraph is a new section.
    const ceiling =
      r.sentenceIdx === null
        ? Math.max(600, original.length * 1.8)
        : Math.max(400, original.length * 3);
    if (r.suggested.length > ceiling) {
      dropped.push({ rewrite: r, why: 'far longer than the original' });
      continue;
    }

    if (r.sentenceIdx === null && r.suggested.length < original.length * PARAGRAPH_MIN_RATIO) {
      dropped.push({ rewrite: r, why: 'far shorter than the paragraph — looks like a summary' });
      continue;
    }

    kept.push(r);
  }

  return { kept, dropped };
}
