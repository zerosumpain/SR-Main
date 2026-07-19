import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordVote } from '$lib/briefing/feedback';

// 👍/👎 a briefing (optionally a named topic within it). Owner-gated by hooks.
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const briefingId = typeof body.briefingId === 'string' ? body.briefingId : '';
  const vote = body.vote === 'up' || body.vote === 'down' ? body.vote : null;
  const what = typeof body.what === 'string' ? body.what : '';
  if (!briefingId || !vote) return json({ error: 'briefingId and vote (up|down) required' }, { status: 400 });
  try {
    await recordVote(briefingId, vote, what);
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'vote failed' }, { status: 500 });
  }
};
