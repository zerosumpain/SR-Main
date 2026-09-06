import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { composeThreadMemory } from '$lib/jkai/memory/thread.server';
import { reviewConversation } from '$lib/workflows/chat/memory-review';

// The thread inspector's Memory mode. Owner-gated by hooks, like the rest of
// /api/jkai. Memory ACTIONS (pin, correct, forget) go to /api/jkai/memory,
// which the memory page also uses — one write path, not two.
export const GET: RequestHandler = async ({ params }) => {
  const payload = await composeThreadMemory(params.id);
  if (!payload) return json({ error: 'Conversation not found' }, { status: 404 });
  return json(payload, { headers: { 'cache-control': 'private, no-store' } });
};

// `review` runs the background extraction pass on THIS thread now, instead of
// waiting for it to go idle for half an hour. One LLM call, owner-initiated.
export const POST: RequestHandler = async ({ params, request }) => {
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  if (body.action !== 'review') return json({ error: 'Unknown action' }, { status: 400 });
  try {
    const saved = await reviewConversation(params.id, { strict: true });
    return json({ ok: true, saved });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Review failed' }, { status: 500 });
  }
};
