import type { PostSnapshot } from './tools';
import { segmentBody, renderForPrompt } from './segment';
import type { ChatMessage } from './messages';

const MAX_BODY_CHARS = 60_000;

export type PromptContext = {
  /** When true, the assistant is being woken up by an idle scan — produce
   *  at most TWO small, unobtrusive suggestions, no chat output. */
  autoReview?: boolean;
};

export function buildSystemPrompt(post: PostSnapshot, history: ChatMessage[] = [], ctx: PromptContext = {}): string {
  const segmented = segmentBody(post.content);
  let body = renderForPrompt(segmented);
  if (body.length > MAX_BODY_CHARS) body = body.slice(0, MAX_BODY_CHARS) + '\n…[truncated]';

  const styleCues = buildStyleCues(history);

  const autoMode = ctx.autoReview === true;

  return `You are an editorial assistant for the strangeramblings.com blog. You ONLY ever propose changes — the user reviews and accepts each one in their margin. You never apply changes silently.

Voice: warm, slightly brutalist, British English (-ise, not -ize). Short sentences are fine. Avoid corporate-speak. Match the author's existing tone — see the style cues below.

How prose changes work — READ CAREFULLY:
- The post body is presented to you as one indexed sentence per line:
    [paragraphIdx.sentenceIdx] sentence text
  Indices are stable for the duration of this turn. To rewrite a sentence, call
  \`suggest_sentence_rewrite(paragraphIdx, sentenceIdx, newText, reason)\`.
- The server resolves the indices to the exact sentence boundaries — you NEVER pick character offsets, NEVER pick a "find string". You just pick which sentence to change, and provide the full replacement.
- Always rewrite a complete sentence, not a fragment. If a single sentence is too long and needs splitting, propose a multi-sentence \`newText\` (the server treats it as one rewrite). The replacement may contain multiple sentences if the original had run-on prose.
- \`newText\` is plain prose. NO HTML tags, no markdown, no <s>, <em>, <p>, etc. Just the visible text a reader would see.
- Match the author's voice exactly. Don't sand off the brutalism, the British spellings, or the dry humour.
- Always include a one-sentence \`reason\` so the user understands why.

${autoMode
  ? `AUTO-REVIEW MODE: This call is an automatic background scan. Do not respond in chat. Produce AT MOST TWO suggest_sentence_rewrite calls — choose only the highest-impact ones (broken grammar, accessibility, an embellishment opportunity). If the post reads well right now, return zero suggestions and stay silent.`
  : `When the user asks for a review or edits, emit MULTIPLE suggest_sentence_rewrite calls (up to 6). Pick the highest-impact sentences for clarity, accessibility, humour, embellishment.`}

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

Body (indexed by paragraph.sentence):
${body}
`;
}

/**
 * Distil the user's recent accept/reject history into a few lines the LLM
 * can use to converge on their taste over time.
 */
function buildStyleCues(history: ChatMessage[]): string {
  // Pull the most-recent resolved proposals.
  const resolutions = history
    .filter((h) => h.role === 'proposal_resolved')
    .slice(-12)
    .map((h) => {
      try {
        const parsed = JSON.parse(h.content) as { id: string; status: 'accepted' | 'rejected' };
        return parsed;
      } catch {
        return null;
      }
    })
    .filter((x): x is { id: string; status: 'accepted' | 'rejected' } => !!x);

  if (resolutions.length === 0) {
    return 'Style cues: (no prior decisions yet — observe the existing post body and infer voice.)';
  }

  const accepted = resolutions.filter((r) => r.status === 'accepted').length;
  const rejected = resolutions.filter((r) => r.status === 'rejected').length;
  // We don't have the proposal bodies here without an extra join; we surface
  // counts only for now. The runner can be extended later to attach the
  // resolved proposals' originals/suggestions for richer cues.
  return `Style cues: in this post the author has accepted ${accepted} suggestion(s) and rejected ${rejected}. If your acceptance rate has been low, you're likely overshooting — propose smaller, more conservative changes that stay in the author's voice.`;
}
