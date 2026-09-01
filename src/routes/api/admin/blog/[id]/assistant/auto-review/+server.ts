import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveBlogModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';
import { getLLMClient } from '$lib/llm/client';
import { runAssistant } from '$lib/blog/assistant/runner';
import { loadHistory } from '$lib/blog/assistant/messages';
import type { Proposal } from '$lib/blog/assistant/proposal';

/**
 * Always-on background pass. The page calls this on a debounced idle timer
 * (~12s after the user stops typing). It runs the same tool loop as the
 * interactive endpoint but with `autoReview` flagged so the prompt asks for
 * at most two unobtrusive proposals and zero chat output. We don't persist
 * a chat-thread message for the implicit prompt — only proposals are
 * persisted (so they show up in the History pane normally).
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) throw error(400, 'invalid id');

  // Optional: client passes a list of currently-pending suggestion summaries
  // so we can avoid duplicates. We don't strictly need it for correctness,
  // but it keeps the prompt focused. Errors here are non-fatal.
  const body = await request.json().catch(() => ({}));
  const pendingHints = Array.isArray(body?.pending) ? (body.pending as string[]).slice(0, 6) : [];

  const ctx = await resolveBlogModel();
  const { client, model } = await getLLMClient(ctx);
  const history = await loadHistory(postId);

  const trigger = pendingHints.length
    ? `Background scan. Skip anything overlapping these pending suggestions: ${pendingHints.map((s) => `"${s.slice(0, 60)}"`).join(', ')}. Propose at most TWO new high-impact small fixes.`
    : 'Background scan. Propose at most TWO new high-impact small fixes — accessibility, broken grammar, an embellishment opportunity. If nothing stands out, return zero suggestions and stay silent.';

  const proposals: Proposal[] = [];
  let errorMsg: string | null = null;

  try {
    await withActivity('blog', async () => {
      for await (const ev of runAssistant({
        postId,
        userMessage: trigger,
        history,
        client,
        model,
        autoReview: true,
      })) {
        if (ev.type === 'proposal') proposals.push(ev.proposal);
        else if (ev.type === 'error') errorMsg = ev.message;
      }
    });
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : 'unknown error';
  }

  // Persist proposals so they appear in chat history and the post's
  // resolved-revision pipeline. We deliberately DO NOT persist the
  // synthetic trigger as a 'user' message — the user didn't type it.
  if (proposals.length > 0) {
    const { appendMessage } = await import('$lib/blog/assistant/messages');
    for (const p of proposals) {
      await appendMessage(postId, 'proposal', JSON.stringify(p)).catch(() => undefined);
    }
  }

  return json({ proposals, error: errorMsg });
};
