import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { composeContextPanel } from '$lib/jkai/context-panel/compose.server';
import { requireChatOwner } from '$lib/jkai/chat-access.server';

// Owner-only: the rail reads the owner's health, places, research and memory.
export const GET: RequestHandler = async (event) => {
  const { params, url } = event;
  await requireChatOwner(event);
  const panel = await composeContextPanel(params.id, url.searchParams.get('lens'));
  if (!panel) return json({ error: 'Conversation not found' }, { status: 404 });
  return json(panel, { headers: { 'cache-control': 'private, no-store' } });
};
