import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { composeContextPanel } from '$lib/jkai/context-panel/compose.server';

export const GET: RequestHandler = async ({ params, url }) => {
  const panel = await composeContextPanel(params.id, url.searchParams.get('lens'));
  if (!panel) return json({ error: 'Conversation not found' }, { status: 404 });
  return json(panel, { headers: { 'cache-control': 'private, no-store' } });
};
