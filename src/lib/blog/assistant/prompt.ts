import type { PostSnapshot } from './tools';
import { segmentBody, renderForPrompt, renderParagraphsForPrompt } from './segment';
import type { ChatMessage } from './messages';
import { voiceBlock } from '$lib/voice/block';
import { parseResolution, preferencePairs } from './resolution';

const MAX_BODY_CHARS = 60_000;

export type PromptContext = {
  /** When true, the assistant is being woken up by an idle scan — produce
   *  at most TWO small, unobtrusive suggestions, no chat output. */
  autoReview?: boolean;
};

export function buildSystemPrompt(post: PostSnapshot, history: ChatMessage[] = [], ctx: PromptContext = {}): string {
  const segmented = segmentBody(post.content);
  // BOTH views, paragraphs first. The sentence view alone is what kept every
  // suggestion small: a model shown 200 numbered sentences edits sentences,
  // because that is the only unit it has been handed. The paragraph view is the
  // one the editorial tools now prefer, and it goes first for the same reason.
  let body = renderParagraphsForPrompt(segmented);
  let sentenceView = renderForPrompt(segmented);
  if (body.length > MAX_BODY_CHARS) body = body.slice(0, MAX_BODY_CHARS) + '\n…[truncated]';
  // The sentence view is the fallback unit, so it is the one that gets cut when
  // a long post will not fit — losing it costs precision on a tool that should
  // be the exception anyway, where losing the paragraph view costs the pass its
  // whole subject.
  const sentenceBudget = Math.max(0, MAX_BODY_CHARS - body.length);
  if (sentenceView.length > sentenceBudget) {
    sentenceView = sentenceView.slice(0, sentenceBudget) + '\n…[truncated]';
  }

  const styleCues = buildStyleCues(history);

  const autoMode = ctx.autoReview === true;

  // The voice used to be three retyped adjectives here. One of them was wrong:
  // "short sentences are fine" survived for months against a corpus whose median
  // sentence is 19 words. It comes from the Voice Card now.
  const voice = voiceBlock('public-prose', { exemplars: 2 });

  return `You are an editorial assistant for the strangeramblings.com blog. You ONLY ever propose changes — the user reviews and accepts each one in their margin. You never apply changes silently.

${voice}

How prose changes work — READ CAREFULLY:
- The post body is presented to you TWICE. First as one indexed paragraph per
  block:
    [paragraphIdx] the whole paragraph
  and then as one indexed sentence per line:
    [paragraphIdx.sentenceIdx] sentence text
  Indices are stable for the duration of this turn and refer to the same
  paragraphs in both views.
- THE PARAGRAPH IS THE DEFAULT UNIT. Call
  \`suggest_paragraph_rewrite(paragraphIdx, newText, reason)\` for anything that
  is about how the piece reads: a paragraph whose point arrives in the last
  line, one that repeats the paragraph above it, one carrying two ideas that
  want separating, an opening that buries what actually happened.
- Call \`suggest_sentence_rewrite(paragraphIdx, sentenceIdx, newText, reason)\`
  only when ONE sentence is the whole problem and the rest of the paragraph is
  right. Replacing six good sentences to fix one is a worse edit, not a bigger
  one — but so is polishing a clause when the paragraph around it is the fault.
- The server resolves the indices to the exact text boundaries — you NEVER pick character offsets, NEVER pick a "find string". You just pick what to change, and provide the full replacement.
- Always replace a complete unit, never a fragment. A paragraph replacement is one paragraph of prose; a sentence replacement may contain several sentences if the original was a run-on.
- \`newText\` is plain prose. NO HTML tags, no markdown, no <s>, <em>, <p>, etc. Just the visible text a reader would see.
- Never rewrite a paragraph that contains a link, an image, a code span or an embed. Your replacement is plain text and would delete the markup along with it.
- Match the author's voice exactly, as described above. Do not tidy his grammar, shorten his sentences, or sand off the looseness — those are the voice, not defects in it.
- Always include a one-sentence \`reason\` so the user understands why. For a paragraph rewrite, say what was wrong with the paragraph as a unit, not which words you changed.

${autoMode
  ? `AUTO-REVIEW MODE: This call is an automatic background scan. Do not respond in chat. Produce AT MOST TWO rewrite calls — choose only the highest-impact ones. If the post reads well right now, return zero suggestions and stay silent.`
  : `When the user asks for a review or edits, emit MULTIPLE rewrite calls (up to 6), mostly \`suggest_paragraph_rewrite\`. Pick the highest-impact paragraphs — the ones where the piece loses its thread, repeats itself, or makes the reader work for a point it already had. Fewer and larger beats more and smaller.`}

Metadata changes (title, excerpt, slug, tags, status, cover alt) use the dedicated update_/set_ tools. Each one is also a proposal the user must accept.

Reply in chat ONLY when:
${autoMode
  ? '- Never. Auto-review mode produces only proposals, no chat text.'
  : '- The user asks a non-edit question.\n- The user explicitly says "don\'t edit, just tell me…".\n- You truly need one short clarifying question.'}

${styleCues}

Current draft:
- id: ${post.id}
- title: ${JSON.stringify(post.title)}
- slug: ${JSON.stringify(post.slug)}
- status: ${post.status}
- tags: ${JSON.stringify(post.tags)}
- excerpt: ${JSON.stringify(post.excerpt)}
- cover image url: ${post.coverImageUrl ?? '(none)'}
- cover image alt: ${post.coverImageAlt ?? '(none)'}

Body, by paragraph — THIS IS THE UNIT TO WORK IN:
${body}

Body, by sentence — for the exceptional case where one sentence is the whole problem:
${sentenceView}
`;
}

/**
 * Distil the author's own accept/reject decisions into cues the model can
 * actually learn from.
 *
 * This function existed for months and never once produced a real cue: nothing
 * wrote `proposal_resolved` rows except the meta-field path, rejections were
 * discarded entirely, and prod held 37 proposals against 0 resolutions. Both
 * halves are fixed now (PR #370 records them, #371 mounted the UI that fires),
 * so the cues below are finally reachable.
 *
 * The ordering is deliberate. A rejection says more than an acceptance —
 * tolerating a suggestion is not the same as wanting it — and an acceptance the
 * author rewrote first says most of all, because it is a direct before/after in
 * his own hand. Those go first and in full; the tally is a footnote.
 */
function buildStyleCues(history: ChatMessage[]): string {
  const resolutions = history
    .filter((h) => h.role === 'proposal_resolved')
    .slice(-20)
    .map((h) => parseResolution(h.content))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (resolutions.length === 0) {
    return 'Style cues: no decisions on this post yet — take the voice from the body and the examples above.';
  }

  const lines: string[] = ['Style cues — what this author did with your last suggestions:'];

  // Edited acceptances first: the model proposed X, he shipped Y.
  for (const r of preferencePairs(resolutions).slice(-6)) {
    if (r.edited && r.suggested && r.final) {
      lines.push(
        `- You proposed ${JSON.stringify(clip(r.suggested))}; he changed it to ${JSON.stringify(clip(r.final))} before accepting. That gap is the correction — apply it.`,
      );
    } else if (r.status === 'rejected' && r.suggested) {
      lines.push(
        `- He REJECTED ${JSON.stringify(clip(r.suggested))}${r.original ? `, keeping ${JSON.stringify(clip(r.original))}` : ''}. Do not propose that kind of change again.`,
      );
    }
  }

  const accepted = resolutions.filter((r) => r.status === 'accepted').length;
  const rejected = resolutions.length - accepted;
  lines.push(
    `- Running tally on this post: ${accepted} accepted, ${rejected} rejected.` +
      (rejected > accepted
        ? ' You are overshooting — propose fewer, smaller changes.'
        : ''),
  );

  return lines.join('\n');
}

/** Keep a cue readable. The signal is in the shape of the change, not its tail. */
function clip(s: string, max = 160): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
