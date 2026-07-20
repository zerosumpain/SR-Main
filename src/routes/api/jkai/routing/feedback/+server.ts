// Owner-gated (hooks.server.ts). Record whether the routed model got the query
// right first time. Feeds the nightly success bias.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordOutcome } from '$lib/routing/events';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';
  const vote = body?.vote;
  if (!conversationId) throw error(400, 'conversationId required');
  if (vote !== 'up' && vote !== 'down') throw error(400, "vote must be 'up' or 'down'");
  await recordOutcome(conversationId, vote === 'up', vote === 'up' ? 'vote_up' : 'vote_down');
  return json({ ok: true });
};
